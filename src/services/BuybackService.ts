import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import {
    connection,
    feePayer,
    wallet,
    buybackProgram,
    buybackBridgeConfigPDA,
    BUYBACK_PROGRAM_ID,
    CORE_PROGRAM_ID,
} from "../config/solanaConfig.js";
import {
    encrypt,
    generateDataHash,
    padBuffer,
} from "../utils/encryptionUtils.js";

// -----------------------------------------------------------------------
// Max byte size for each encrypted field on-chain (IV 16 + ciphertext ≤ 80)
// AES-256-CBC with PKCS7 pads up to the next 16-byte block.
// Longest field we anticipate is ~64 chars → encrypted ≤ 80 bytes → 96 OK
// -----------------------------------------------------------------------
const ENCRYPTED_FIELD_SIZE = 96;

/**
 * Encrypt a string and pad to ENCRYPTED_FIELD_SIZE.
 * Returns a zero-padded Buffer ready for on-chain storage.
 */
const encryptField = (value: string, keyHex: string): Buffer => {
    if (!value) return Buffer.alloc(ENCRYPTED_FIELD_SIZE);
    const encrypted = encrypt(value, keyHex);
    if (encrypted.length > ENCRYPTED_FIELD_SIZE) {
        throw new Error(
            `Encrypted value too large: ${encrypted.length} bytes (max ${ENCRYPTED_FIELD_SIZE})`,
        );
    }
    return padBuffer(encrypted, ENCRYPTED_FIELD_SIZE);
};

/**
 * Validate and convert buyback ID to BN
 */
const validateBuybackId = (buybackId: string | number): BN => {
    const id = typeof buybackId === "string" ? buybackId : String(buybackId);
    if (!id || isNaN(Number(id))) {
        throw new Error(`Invalid buyback ID: ${buybackId}`);
    }
    return new BN(id, 10);
};

/**
 * Submit a new buyback to Solana with encrypted PII fields.
 *
 * Encrypted fields (AES-256-CBC, encrypted by bridge using key from backend):
 *   - farmer_name
 *   - bank_account
 *   - bank_name
 *   - exact_farm_gps
 *
 * The data_hash (SHA-256) is computed over these plaintext values for
 * third-party verification without decryption.
 */
export const submitBuybackToSolana = async (
    buybackData: any,
): Promise<string> => {
    const {
        buyback_id,
        farmer_id,
        rsbsa_number,
        provider_id,
        season_id,
        farm_size_hectares,
        pb_borrowed_price,
        premium_per_kg,
        input_details,
        expected_harvest_kg,
        contract_pdf_key,
        farmer_signature_key,
        staff_signature_key,
        farmer_authority, // Optional, defaults to feePayer
        provider_authority, // Optional, defaults to feePayer
        // PII plaintext fields for encryption:
        farmer_name,
        bank_account,
        bank_name,
        exact_farm_gps,
        // Encryption key (hex, 32 bytes) provided by backend:
        encryption_key,
    } = buybackData;

    // Validate encryption key if PII fields are present
    const hasPii = farmer_name || bank_account || bank_name || exact_farm_gps;
    if (hasPii && !encryption_key) {
        throw new Error(
            "encryption_key is required when PII fields are provided",
        );
    }

    const buybackIdBN = validateBuybackId(buyback_id);
    const farmerIdBN = new BN(String(farmer_id || 0), 10);
    const rsbsaBN = new BN(String(rsbsa_number || 0), 10);
    const providerIdBN = new BN(String(provider_id || 0), 10);
    const seasonIdBN = new BN(String(season_id || 0), 10);
    const farmSizeBN = new BN(String(farm_size_hectares || 0), 10);
    const borrowedPriceBN = new BN(String(pb_borrowed_price || 0), 10);
    const premiumBN = new BN(String(premium_per_kg || 0), 10);
    const expectedHarvestBN = new BN(String(expected_harvest_kg || 0), 10);

    const fAuth = farmer_authority
        ? new PublicKey(farmer_authority)
        : feePayer.publicKey;
    const pAuth = provider_authority
        ? new PublicKey(provider_authority)
        : feePayer.publicKey;

    const [buybackPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("buyback"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(buybackIdBN.toArray("le", 8)),
        ],
        BUYBACK_PROGRAM_ID,
    );

    const [farmerActorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            fAuth.toBuffer(),
            Buffer.from(farmerIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    const [providerAccountPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("organization"),
            pAuth.toBuffer(),
            Buffer.from(providerIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    // Encrypt PII fields with the provided key (empty buffer if no value)
    const encryptedFarmerName = encryption_key
        ? encryptField(farmer_name || "", encryption_key)
        : Buffer.alloc(ENCRYPTED_FIELD_SIZE);

    const encryptedBankAccount = encryption_key
        ? encryptField(bank_account || "", encryption_key)
        : Buffer.alloc(ENCRYPTED_FIELD_SIZE);

    const encryptedBankName = encryption_key
        ? encryptField(bank_name || "", encryption_key)
        : Buffer.alloc(ENCRYPTED_FIELD_SIZE);

    const encryptedExactFarmGps = encryption_key
        ? encryptField(exact_farm_gps || "", encryption_key)
        : Buffer.alloc(ENCRYPTED_FIELD_SIZE);

    // Generate SHA-256 data hash from plaintext PII for on-chain verification
    const dataHash = generateDataHash({
        buyback_id: String(buyback_id),
        farmer_name: farmer_name || "",
        bank_account: bank_account || "",
        bank_name: bank_name || "",
        exact_farm_gps: exact_farm_gps || "",
        rsbsa_number: String(rsbsa_number || ""),
    });

    try {
        const txSig = await (buybackProgram.methods as any)
            .createBuyback(
                buybackIdBN,
                farmerIdBN,
                rsbsaBN,
                providerIdBN,
                seasonIdBN,
                farmSizeBN,
                borrowedPriceBN,
                premiumBN,
                input_details || "",
                expectedHarvestBN,
                contract_pdf_key || "",
                farmer_signature_key || "",
                staff_signature_key || "",
                // Encrypted PII
                Array.from(encryptedFarmerName),
                Array.from(encryptedBankAccount),
                Array.from(encryptedBankName),
                Array.from(encryptedExactFarmGps),
                // Data hash
                Array.from(dataHash),
            )
            .accounts({
                buyback: buybackPDA,
                bridgeConfig: buybackBridgeConfigPDA,
                farmerAuthority: fAuth,
                farmerActor: farmerActorPDA,
                providerAuthority: pAuth,
                providerAccount: providerAccountPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(`Failed to create buyback: ${err.message}`);
    }
};

/**
 * Check if buyback exists
 */
export const checkBuybackExistsOnSolana = async (
    buybackId: string | number,
): Promise<any> => {
    const buybackIdBN = validateBuybackId(buybackId);
    const [buybackPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("buyback"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(buybackIdBN.toArray("le", 8)),
        ],
        BUYBACK_PROGRAM_ID,
    );

    const accountInfo = await connection.getAccountInfo(buybackPDA);
    return {
        exists: accountInfo !== null,
        pda: buybackPDA.toBase58(),
    };
};

/**
 * Get buyback details.
 * Returns encrypted PII fields as hex strings — decryption happens on the
 * frontend (or backend) after fetching the key from the backend API.
 */
export const getBuybackFromSolana = async (
    buybackId: string | number,
): Promise<any> => {
    const buybackIdBN = validateBuybackId(buybackId);
    const [buybackPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("buyback"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(buybackIdBN.toArray("le", 8)),
        ],
        BUYBACK_PROGRAM_ID,
    );

    try {
        const buybackAccount = await (
            buybackProgram.account as any
        ).buybackAccount.fetch(buybackPDA);
        return {
            ...buybackAccount,
            buyback_id: buybackAccount.buybackId.toString(),
            farmer_id: buybackAccount.farmerId.toString(),
            rsbsa_number: buybackAccount.rsbsaNumber.toString(),
            provider_id: buybackAccount.providerId.toString(),
            season_id: buybackAccount.seasonId.toString(),
            farm_size_hectares: buybackAccount.farmSizeHectares.toString(),
            pb_borrowed_price: buybackAccount.pbBorrowedPrice.toString(),
            premium_per_kg: buybackAccount.premiumPerKg.toString(),
            expected_harvest_kg: buybackAccount.expectedHarvestKg.toString(),
            actual_harvest_kg: buybackAccount.actualHarvestKg.toString(),
            total_buyback_price: buybackAccount.totalBuybackPrice.toString(),
            target_payment_amount:
                buybackAccount.targetPaymentAmount.toString(),
            // Encrypted PII — returned as hex for authorized decryption
            encrypted_farmer_name: Buffer.from(
                buybackAccount.encryptedFarmerName,
            ).toString("hex"),
            encrypted_bank_account: Buffer.from(
                buybackAccount.encryptedBankAccount,
            ).toString("hex"),
            encrypted_bank_name: Buffer.from(
                buybackAccount.encryptedBankName,
            ).toString("hex"),
            encrypted_exact_farm_gps: Buffer.from(
                buybackAccount.encryptedExactFarmGps,
            ).toString("hex"),
            data_hash: Buffer.from(buybackAccount.dataHash).toString("hex"),
            pda: buybackPDA.toBase58(),
        };
    } catch (err: any) {
        throw new Error(`Failed to fetch buyback: ${err.message}`);
    }
};

/**
 * Update in-season monitoring
 */
export const updateInSeasonOnSolana = async (data: any): Promise<string> => {
    const { buyback_id, risk_event, forecasted_yield, major_risk_flag } = data;
    const buybackIdBN = validateBuybackId(buyback_id);
    const forecastedYieldBN =
        forecasted_yield !== undefined
            ? new BN(String(forecasted_yield), 10)
            : new BN("-1", 10);

    const [buybackPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("buyback"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(buybackIdBN.toArray("le", 8)),
        ],
        BUYBACK_PROGRAM_ID,
    );

    try {
        const txSig = await (buybackProgram.methods as any)
            .updateInSeason(
                buybackIdBN,
                risk_event || "",
                forecastedYieldBN,
                major_risk_flag !== undefined ? major_risk_flag : 255,
            )
            .accounts({
                buyback: buybackPDA,
                bridgeConfig: buybackBridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();
        return txSig;
    } catch (err: any) {
        throw new Error(`Failed to update in-season: ${err.message}`);
    }
};

/**
 * Settle buyback - accepts an updated data_hash.
 */
export const settleBuybackOnSolana = async (data: any): Promise<string> => {
    const {
        buyback_id,
        actual_harvest_kg,
        pm_market_price,
        check_number,
        check_date,
        new_status,
        target_payment_date,
        total_price_signed,
        contract_pdf_key,
        farmer_signature_key,
        staff_signature_key,
        // Updated data hash (from backend, computed after any settlement PII updates)
        data_hash,
    } = data;

    const buybackIdBN = validateBuybackId(buyback_id);
    const [buybackPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("buyback"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(buybackIdBN.toArray("le", 8)),
        ],
        BUYBACK_PROGRAM_ID,
    );

    // Accept data_hash as hex string or 32-byte array
    let dataHashArray: number[];
    if (data_hash) {
        dataHashArray =
            typeof data_hash === "string"
                ? Array.from(Buffer.from(data_hash, "hex"))
                : Array.from(data_hash);
    } else {
        dataHashArray = Array(32).fill(0);
    }

    try {
        const txSig = await (buybackProgram.methods as any)
            .settleBuyback(
                buybackIdBN,
                new BN(String(actual_harvest_kg), 10),
                new BN(String(pm_market_price), 10),
                check_number || "",
                new BN(String(check_date || 0), 10),
                new_status,
                new BN(String(target_payment_date || 0), 10),
                new BN(String(total_price_signed), 10),
                contract_pdf_key || "",
                farmer_signature_key || "",
                staff_signature_key || "",
                dataHashArray,
            )
            .accounts({
                buyback: buybackPDA,
                bridgeConfig: buybackBridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();
        return txSig;
    } catch (err: any) {
        throw new Error(`Failed to settle buyback: ${err.message}`);
    }
};

/**
 * Confirm payment
 */
export const confirmBuybackPaymentOnSolana = async (
    buybackId: string | number,
): Promise<string> => {
    const buybackIdBN = validateBuybackId(buybackId);
    const [buybackPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("buyback"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(buybackIdBN.toArray("le", 8)),
        ],
        BUYBACK_PROGRAM_ID,
    );

    try {
        const txSig = await (buybackProgram.methods as any)
            .confirmPayment(buybackIdBN)
            .accounts({
                buyback: buybackPDA,
                bridgeConfig: buybackBridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();
        return txSig;
    } catch (err: any) {
        throw new Error(`Failed to confirm payment: ${err.message}`);
    }
};

/**
 * Update payment schedule
 */
export const updatePaymentScheduleOnSolana = async (
    buybackId: string | number,
    targetPaymentDate: number,
): Promise<string> => {
    const buybackIdBN = validateBuybackId(buybackId);
    const [buybackPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("buyback"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(buybackIdBN.toArray("le", 8)),
        ],
        BUYBACK_PROGRAM_ID,
    );

    try {
        const txSig = await (buybackProgram.methods as any)
            .updatePaymentSchedule(
                buybackIdBN,
                new BN(String(targetPaymentDate), 10),
            )
            .accounts({
                buyback: buybackPDA,
                bridgeConfig: buybackBridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();
        return txSig;
    } catch (err: any) {
        throw new Error(`Failed to update payment schedule: ${err.message}`);
    }
};

/**
 * Mark buyback settled
 */
export const markBuybackSettledOnSolana = async (
    buybackId: string | number,
): Promise<string> => {
    const buybackIdBN = validateBuybackId(buybackId);
    const [buybackPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("buyback"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(buybackIdBN.toArray("le", 8)),
        ],
        BUYBACK_PROGRAM_ID,
    );

    try {
        const txSig = await (buybackProgram.methods as any)
            .markBuybackSettled(buybackIdBN)
            .accounts({
                buyback: buybackPDA,
                bridgeConfig: buybackBridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();
        return txSig;
    } catch (err: any) {
        throw new Error(`Failed to mark settled: ${err.message}`);
    }
};

/**
 * Delete buyback
 */
export const deleteBuybackOnSolana = async (
    buybackId: string | number,
): Promise<string> => {
    const buybackIdBN = validateBuybackId(buybackId);
    const [buybackPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("buyback"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(buybackIdBN.toArray("le", 8)),
        ],
        BUYBACK_PROGRAM_ID,
    );

    try {
        const txSig = await (buybackProgram.methods as any)
            .deleteBuyback(buybackIdBN)
            .accounts({
                buyback: buybackPDA,
                bridgeConfig: buybackBridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();
        return txSig;
    } catch (err: any) {
        throw new Error(`Failed to delete buyback: ${err.message}`);
    }
};

/**
 * Close buyback account
 */
export const closeBuybackOnSolana = async (
    buybackId: string | number,
): Promise<string> => {
    const buybackIdBN = validateBuybackId(buybackId);
    const [buybackPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("buyback"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(buybackIdBN.toArray("le", 8)),
        ],
        BUYBACK_PROGRAM_ID,
    );

    try {
        const txSig = await (buybackProgram.methods as any)
            .closeBuyback(buybackIdBN)
            .accounts({
                buyback: buybackPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();
        return txSig;
    } catch (err: any) {
        throw new Error(`Failed to close buyback: ${err.message}`);
    }
};
