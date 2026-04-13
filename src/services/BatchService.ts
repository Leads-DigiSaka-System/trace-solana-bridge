import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import {
    connection,
    feePayer,
    wallet,
    coreProgram,
    bridgeConfigPDA,
    CORE_PROGRAM_ID,
} from "../config/solanaConfig.js";
import { validateAndConvertBatchId } from "../utils/solanaUtils.js";

/**
 * Submit a new batch to Solana
 */
export const submitBatchToSolana = async (batchData: any): Promise<string> => {
    const {
        batch_id,
        farmer_id,
        farm_id,
        tps_id,
        weight,
        rice_type,
        moisture_content,
        impurity_content,
        price_per_kg,
        total_price,
        status,
        village,
        sub_district,
        district,
    } = batchData;

    const batchIdBN = validateAndConvertBatchId(batch_id, "creation");

    let batchPDA: PublicKey;
    try {
        [batchPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("batch"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(batchIdBN.toArray("le", 8)),
            ],
            CORE_PROGRAM_ID,
        );

        const accountInfo = await connection.getAccountInfo(batchPDA);
        if (accountInfo !== null) {
            throw new Error(
                `Batch account already exists on Solana. Batch ID: ${batchIdBN.toString()}`,
            );
        }
    } catch (pdaErr: any) {
        if (pdaErr.message?.includes("already exists")) throw pdaErr;
        throw new Error(
            `Failed to derive PDA for batch_id ${batchIdBN.toString()}: ${pdaErr.message}`,
        );
    }

    try {
        const txSig = await (coreProgram.methods as any)
            .createBatch(
                batchIdBN,
                new BN(String(farmer_id), 10),
                farm_id || "",
                new BN(String(tps_id), 10),
                new BN(String(weight), 10),
                rice_type || "",
                new BN(String(moisture_content), 10),
                new BN(String(impurity_content), 10),
                new BN(String(price_per_kg), 10),
                new BN(String(total_price), 10),
                status || "Initial",
                village || "",
                sub_district || "",
                district || "",
            )
            .accounts({
                batch: batchPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(`Failed to execute Anchor instruction: ${err.message}`);
    }
};

/**
 * Check if a batch account exists on Solana
 */
export const checkBatchExistsOnSolana = async (
    batchId: number | string,
): Promise<boolean> => {
    try {
        const batchIdBN = validateAndConvertBatchId(batchId, "check existence");

        const [batchPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("batch"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(batchIdBN.toArray("le", 8)),
            ],
            CORE_PROGRAM_ID,
        );

        const accountInfo = await connection.getAccountInfo(batchPDA);
        if (accountInfo === null) return false;
        return accountInfo.owner.equals(CORE_PROGRAM_ID);
    } catch (err: any) {
        throw new Error(`Failed to check batch existence: ${err.message}`);
    }
};

/**
 * Get batch account details from Solana
 */
export const getBatchFromSolana = async (
    batchId: number | string,
): Promise<any | null> => {
    try {
        const batchIdBN = validateAndConvertBatchId(batchId, "fetch");

        const [batchPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("batch"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(batchIdBN.toArray("le", 8)),
            ],
            CORE_PROGRAM_ID,
        );

        try {
            const batchAccount = await (
                coreProgram.account as any
            ).batchAccount.fetch(batchPDA);

            return {
                batch_id: batchAccount.batchId.toString(),
                farmer_id: batchAccount.farmerId.toString(),
                farm_id: Buffer.from(
                    batchAccount.farmId.slice(0, batchAccount.farmIdLen),
                ).toString("utf8"),
                tps_id: batchAccount.tpsId.toString(),
                weight: batchAccount.weight.toString(),
                rice_type: Buffer.from(
                    batchAccount.riceType.slice(0, batchAccount.riceTypeLen),
                ).toString("utf8"),
                moisture_content: batchAccount.moistureContent.toString(),
                impurity_content: batchAccount.impurityContent.toString(),
                price_per_kg: batchAccount.pricePerKg.toString(),
                total_price: batchAccount.totalPrice.toString(),
                status: Buffer.from(
                    batchAccount.status.slice(0, batchAccount.statusLen),
                ).toString("utf8"),
                is_active: batchAccount.isActive === 1,
                village: Buffer.from(
                    batchAccount.village.slice(0, batchAccount.villageLen),
                ).toString("utf8"),
                sub_district: Buffer.from(
                    batchAccount.subDistrict.slice(
                        0,
                        batchAccount.subDistrictLen,
                    ),
                ).toString("utf8"),
                district: Buffer.from(
                    batchAccount.district.slice(0, batchAccount.districtLen),
                ).toString("utf8"),
                timestamp: batchAccount.timestamp.toString(),
                pda: batchPDA.toBase58(),
            };
        } catch (fetchErr) {
            return null;
        }
    } catch (err: any) {
        throw new Error(`Failed to fetch batch: ${err.message}`);
    }
};

/**
 * Update an existing batch on Solana
 */
export const updateBatchOnSolana = async (batchData: any): Promise<string> => {
    const {
        batch_id,
        status,
        weight,
        moisture_content,
        impurity_content,
        price_per_kg,
        total_price,
    } = batchData;

    const batchIdBN = validateAndConvertBatchId(batch_id, "update");

    const [batchPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("batch"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(batchIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    try {
        const accountInfo = await connection.getAccountInfo(batchPDA);
        if (accountInfo === null)
            throw new Error(`Batch ${batch_id} does not exist.`);

        const params = [
            batchIdBN,
            status !== undefined ? status : null,
            weight !== undefined ? new BN(String(weight), 10) : null,
            moisture_content !== undefined
                ? new BN(String(moisture_content), 10)
                : null,
            impurity_content !== undefined
                ? new BN(String(impurity_content), 10)
                : null,
            price_per_kg !== undefined
                ? new BN(String(price_per_kg), 10)
                : null,
            total_price !== undefined ? new BN(String(total_price), 10) : null,
        ];

        const txSig = await (coreProgram.methods as any)
            .updateBatch(...params)
            .accounts({
                batch: batchPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(
            `Failed to execute Anchor update instruction: ${err.message}`,
        );
    }
};

/**
 * Delete a batch on Solana
 */
export const deleteBatchOnSolana = async (batchData: any): Promise<string> => {
    const { batch_id } = batchData;
    const batchIdBN = validateAndConvertBatchId(batch_id, "deletion");

    const [batchPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("batch"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(batchIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    try {
        const accountInfo = await connection.getAccountInfo(batchPDA);
        if (accountInfo === null)
            throw new Error(`Batch ${batch_id} does not exist.`);

        const txSig = await (coreProgram.methods as any)
            .deleteBatch(batchIdBN)
            .accounts({
                batch: batchPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(
            `Failed to execute Anchor delete instruction: ${err.message}`,
        );
    }
};

/**
 * Close a batch account permanently
 */
export const closeBatchOnSolana = async (batchData: any): Promise<string> => {
    const { batch_id } = batchData;
    const batchIdBN = validateAndConvertBatchId(batch_id, "close");

    const [batchPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("batch"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(batchIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    try {
        const txSig = await (coreProgram.methods as any)
            .closeBatch(batchIdBN)
            .accounts({
                batch: batchPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(
            `Failed to execute Anchor close instruction: ${err.message}`,
        );
    }
};
