import * as anchor from "@coral-xyz/anchor";
import {
    ComputeBudgetProgram,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
    connection,
    feePayer,
    wallet,
    buybackProgram,
    buybackBridgeConfigPDA,
    BUYBACK_PROGRAM_ID,
    CORE_PROGRAM_ID,
    coreProgram,
    bridgeConfigPDA,
} from "../config/solanaConfig.js";
import {
    encrypt,
    generateDataHash,
    padBuffer,
} from "../utils/encryptionUtils.js";

const ENCRYPTED_FIELD_SIZE = 96;

const encryptField = (value: string, keyHex: string): Buffer => {
    if (!value) return Buffer.alloc(ENCRYPTED_FIELD_SIZE);
    const encrypted = encrypt(value, keyHex);
    if (encrypted.length > ENCRYPTED_FIELD_SIZE) {
        throw new Error(
            `Encrypted value too large: ${encrypted.length} bytes (max ${ENCRYPTED_FIELD_SIZE})`,
        );
    }
    // Ensure padBuffer returns a true Buffer
    const padded = padBuffer(encrypted, ENCRYPTED_FIELD_SIZE);
    return Buffer.isBuffer(padded) ? padded : Buffer.from(padded);
};

const validateBuybackId = (buybackId: string | number): BN => {
    const id = typeof buybackId === "string" ? buybackId : String(buybackId);
    if (!id || isNaN(Number(id))) {
        throw new Error(`Invalid buyback ID: ${buybackId}`);
    }
    return new BN(id, 10);
};

const toI64BN = (value: string | number | undefined, fallback = 0): BN => {
    if (value === undefined || value === null || value === "") {
        return new BN(fallback);
    }
    return new BN(String(value), 10);
};

const toTimestampBN = (value: string | number | undefined): BN => {
    if (!value) return new BN(0);
    if (typeof value === "number") return new BN(value);
    if (typeof value === "string" && value.includes("-")) {
        const ts = Math.floor(new Date(value).getTime() / 1000);
        if (isNaN(ts)) throw new Error(`Invalid date string: ${value}`);
        return new BN(ts);
    }
    return new BN(value, 10);
};

/**
 * For [u8; N] fixed-size Rust arrays — Anchor serializes WITHOUT a length prefix.
 * Only use this for data_hash ([u8; 32]) and similar fixed arrays.
 */
const toFixedArray = (buf: Buffer, size: number): number[] => {
    const out = Buffer.alloc(size);
    buf.copy(out, 0, 0, Math.min(buf.length, size));
    return Array.from(out);
};

/**
 * For Vec<u8> Rust fields — Anchor serializes WITH a 4-byte LE length prefix.
 * Use Array.from() directly; Anchor's TypeScript client adds the prefix automatically
 * when it sees a plain number[].
 * The buffer must be exactly ENCRYPTED_FIELD_SIZE bytes (already padded by encryptField).
 */
const toBytesArray = (buf: Buffer): number[] => {
    return Array.from(buf);
};

/**
 * Ensure the provider is registered as an actor on-chain.
 * The Rust program's validate_provider_core_account requires the provider PDA
 * to be owned by the Core program.  We register a minimal actor account for
 * the provider using just its numeric ID and the bridge fee-payer as authority.
 * If the account already exists the call is a no-op.
 */
const ensureProviderActorExists = async (
    providerIdBN: BN,
    providerActorPDA: PublicKey,
): Promise<void> => {
    const accountInfo = await connection.getAccountInfo(providerActorPDA);
    if (accountInfo !== null) {
        // Already registered — nothing to do.
        return;
    }

    try {
        await (coreProgram.methods as any)
            .createActor(
                providerIdBN,          // actor_id (u64)
                providerIdBN,          // user_id  — use same id as placeholder
                "provider",            // name
                0,                     // actor_type: 0 = farmer/generic
                "provider",            // roles
                null,                  // organization
                1,                     // is_active
                "",                    // province
                "",                    // city
                new BN(0),             // balance
                "",                    // address
                "",                    // farm_id
                new BN(0),             // farmer_id
                new BN(0),             // assigned_tps
                "",                    // farmer_signature_key
            )
            .accounts({
                actor: providerActorPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();
        console.log(
            `[BuybackService] Provider actor registered on-chain: id=${
                providerIdBN.toString()
            } pda=${providerActorPDA.toBase58()}`,
        );
    } catch (err: any) {
        // If it was created concurrently in a race, ignore the duplicate error.
        if (
            err?.message?.includes("already exists") ||
            err?.message?.includes("already in use")
        ) {
            return;
        }
        throw new Error(
            `Failed to auto-register provider actor ${
                providerIdBN.toString()
            }: ${err?.message ?? err}`,
        );
    }
};

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
        expected_harvest_kg,
        contract_pdf_key,
        farmer_signature_key,
        staff_signature_key,
        farmer_authority,
        provider_authority,
        // PII fields — encrypt and store in DB only, not on-chain
        farmer_name,
        bank_account,
        bank_name,
        exact_farm_gps,
        encryption_key,
    } = buybackData;

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

    // The Rust program accepts either an "organization" or "actor" PDA for the
    // provider account.  Try the organization PDA first; if it doesn't exist
    // on-chain, fall back to the actor PDA.
    const [providerOrgPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("organization"),
            pAuth.toBuffer(),
            Buffer.from(providerIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );
    const [providerActorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            pAuth.toBuffer(),
            Buffer.from(providerIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    const orgAccountInfo = await connection.getAccountInfo(providerOrgPDA);
    const actorAccountInfo = orgAccountInfo
        ? orgAccountInfo
        : await connection.getAccountInfo(providerActorPDA);

    // If neither PDA exists on-chain, auto-register the provider as an actor.
    if (!actorAccountInfo) {
        await ensureProviderActorExists(providerIdBN, providerActorPDA);
    }

    // Use whichever provider PDA exists (org takes priority, actor as fallback).
    const providerAccountPDA = orgAccountInfo ? providerOrgPDA : providerActorPDA;

    // Generate data_hash for on-chain integrity verification
    const rawDataHash = generateDataHash({
        buyback_id: String(buyback_id),
        farmer_name: farmer_name || "",
        bank_account: bank_account || "",
        bank_name: bank_name || "",
        exact_farm_gps: exact_farm_gps || "",
        rsbsa_number: String(rsbsa_number || ""),
    });
    const dataHashBuf = Buffer.isBuffer(rawDataHash)
        ? rawDataHash
        : Buffer.from(rawDataHash);

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
                expectedHarvestBN,
                contract_pdf_key || "",
                farmer_signature_key || "",
                staff_signature_key || "",
                dataHashBuf,
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
        const logs = err?.logs ?? [];
        if (logs.length) console.error("Logs:", logs);
        throw new Error(`Failed to create buyback: ${err?.message ?? err}`);
    }
};

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

export const updateInSeasonOnSolana = async (data: any): Promise<string> => {
    const { buyback_id, risk_event, forecasted_yield, major_risk_flag } = data;
    const buybackIdBN = validateBuybackId(buyback_id);

    // u64 cannot be negative — use 0 as sentinel instead of -1
    const forecastedYieldBN =
        forecasted_yield !== undefined && forecasted_yield !== null
            ? new BN(String(forecasted_yield), 10)
            : new BN(0);

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

    // data_hash is [u8; 32] fixed array in Rust → toFixedArray
    let dataHashArray: number[];
    if (data_hash) {
        const buf =
            typeof data_hash === "string"
                ? Buffer.from(data_hash, "hex")
                : Buffer.from(data_hash);
        dataHashArray = toFixedArray(buf, 32);
    } else {
        dataHashArray = Array(32).fill(0);
    }

    try {
        const txSig = await (buybackProgram.methods as any)
            .settleBuyback(
                buybackIdBN,
                new BN(String(actual_harvest_kg || 0), 10),
                new BN(String(pm_market_price || 0), 10),
                check_number || "",
                toTimestampBN(check_date),
                new_status,
                toTimestampBN(target_payment_date),
                toI64BN(total_price_signed),
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

export const updatePaymentScheduleOnSolana = async (
    buybackId: string | number,
    targetPaymentDate: string | number,
): Promise<string> => {
    const buybackIdBN = validateBuybackId(buybackId);
    const targetDateBN = toTimestampBN(targetPaymentDate);

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
            .updatePaymentSchedule(buybackIdBN, targetDateBN)
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
