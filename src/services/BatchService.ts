import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import {
    connection,
    feePayer,
    wallet,
    tracingProgram,
    bridgeConfigPDA,
    TRACING_PROGRAM_ID,
} from "../config/solanaConfig.js";
import { validateAndConvertBatchId } from "../utils/solanaUtils.js";

/**
 * Submit a new batch to Solana (Tracing program)
 */
export const submitBatchToSolana = async (batchData: any): Promise<string> => {
    const {
        batch_id,
        qr_code,
        season_id,
        current_holder_id,
        milling_id,
        drying_id,
        validator,
        batch_weight_kg,
        moisture_content,
        price_per_kg,
        status,
    } = batchData;

    const batchIdBN = validateAndConvertBatchId(batch_id, "creation");

    let batchPDA: PublicKey;
    try {
        [batchPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("batch"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(batchIdBN.toArray("le", 4)),
            ],
            TRACING_PROGRAM_ID,
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
        const txSig = await (tracingProgram.methods as any)
            .createBatch(
                batchIdBN,
                qr_code || "",
                new BN(String(season_id || 0), 10),
                new BN(String(current_holder_id || 0), 10),
                milling_id !== undefined
                    ? new BN(String(milling_id), 10)
                    : null,
                drying_id !== undefined ? new BN(String(drying_id), 10) : null,
                validator !== undefined ? new BN(String(validator), 10) : null,
                new BN(String(batch_weight_kg || 0), 10),
                new BN(String(moisture_content || 0), 10),
                new BN(String(price_per_kg || 0), 10),
                new BN(String(status || 0), 10).toNumber(),
            )
            .accounts({
                batch: batchPDA,
                bridgeConfig: bridgeConfigPDA,
                currentHolderActor: PublicKey.default, // Placeholder, should be derived if needed for validation
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
                Buffer.from(batchIdBN.toArray("le", 4)),
            ],
            TRACING_PROGRAM_ID,
        );

        const accountInfo = await connection.getAccountInfo(batchPDA);
        if (accountInfo === null) return false;
        return accountInfo.owner.equals(TRACING_PROGRAM_ID);
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
                Buffer.from(batchIdBN.toArray("le", 4)),
            ],
            TRACING_PROGRAM_ID,
        );

        try {
            const batchAccount = await (
                tracingProgram.account as any
            ).batchAccount.fetch(batchPDA);

            return {
                batch_id: batchAccount.batchId.toString(),
                qr_code: Buffer.from(
                    batchAccount.qrCode.slice(0, batchAccount.qrCodeLen),
                ).toString("utf8"),
                season_id: batchAccount.seasonId.toString(),
                current_holder_id: batchAccount.currentHolderId.toString(),
                milling_id: batchAccount.millingId.toString(),
                drying_id: batchAccount.dryingId.toString(),
                validator: batchAccount.validator.toString(),
                batch_weight_kg: batchAccount.batchWeightKg.toString(),
                moisture_content: batchAccount.moistureContent.toString(),
                price_per_kg: batchAccount.pricePerKg.toString(),
                status: batchAccount.status,
                is_active: batchAccount.isActive === 1,
                timestamp: batchAccount.timestamp.toString(),
                seed_distribution_id:
                    batchAccount.seedDistributionId.toString(),
                fertilizer_distribution_ids:
                    batchAccount.fertilizerDistributionIds.map((id: any) =>
                        id.toString(),
                    ),
                other_provision_distribution_ids:
                    batchAccount.otherProvisionDistributionIds.map((id: any) =>
                        id.toString(),
                    ),
                carbon_certified: batchAccount.carbonCertified === 1,
                farm_gps_lat: batchAccount.farmGpsLat,
                farm_gps_lon: batchAccount.farmGpsLon,
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
        current_holder_id,
        milling_id,
        drying_id,
        validator,
        batch_weight_kg,
        moisture_content,
    } = batchData;

    const batchIdBN = validateAndConvertBatchId(batch_id, "update");

    const [batchPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("batch"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(batchIdBN.toArray("le", 4)),
        ],
        TRACING_PROGRAM_ID,
    );

    try {
        const accountInfo = await connection.getAccountInfo(batchPDA);
        if (accountInfo === null)
            throw new Error(`Batch ${batch_id} does not exist.`);

        const txSig = await (tracingProgram.methods as any)
            .updateBatch(
                batchIdBN,
                current_holder_id !== undefined
                    ? new BN(String(current_holder_id), 10)
                    : null,
                milling_id !== undefined
                    ? new BN(String(milling_id), 10)
                    : null,
                drying_id !== undefined ? new BN(String(drying_id), 10) : null,
                validator !== undefined ? new BN(String(validator), 10) : null,
                batch_weight_kg !== undefined
                    ? new BN(String(batch_weight_kg), 10)
                    : null,
                moisture_content !== undefined
                    ? new BN(String(moisture_content), 10)
                    : null,
            )
            .accounts({
                batch: batchPDA,
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
            Buffer.from(batchIdBN.toArray("le", 4)),
        ],
        TRACING_PROGRAM_ID,
    );

    try {
        const accountInfo = await connection.getAccountInfo(batchPDA);
        if (accountInfo === null)
            throw new Error(`Batch ${batch_id} does not exist.`);

        const txSig = await (tracingProgram.methods as any)
            .deleteBatch(batchIdBN)
            .accounts({
                batch: batchPDA,
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
            Buffer.from(batchIdBN.toArray("le", 4)),
        ],
        TRACING_PROGRAM_ID,
    );

    try {
        const txSig = await (tracingProgram.methods as any)
            .closeBatch(batchIdBN)
            .accounts({
                batch: batchPDA,
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
