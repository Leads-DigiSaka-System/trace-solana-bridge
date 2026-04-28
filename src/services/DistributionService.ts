import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import {
    feePayer,
    wallet,
    distributionProgram,
    distributionBridgeConfigPDA,
    DISTRIBUTION_PROGRAM_ID,
    CORE_PROGRAM_ID,
} from "../config/solanaConfig.js";
import { buildItemsMerkleTree, generateProof } from "../utils/merkle.js";

/**
 * Submit actor performance (Distribution program)
 */
export const submitActorPerformanceToSolana = async (
    data: any,
): Promise<string> => {
    const { actor_id, performance_score, reports_count, delivery_count } = data;
    const actorIdBN = new BN(String(actor_id), 10);

    const [performancePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("performance"), Buffer.from(actorIdBN.toArray("le", 8))],
        DISTRIBUTION_PROGRAM_ID,
    );

    const [actorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(actorIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .submitActorPerformance(
            actorIdBN,
            new BN(String(performance_score || 0), 10).toNumber(),
            new BN(String(reports_count || 0), 10).toNumber(),
            new BN(String(delivery_count || 0), 10).toNumber(),
        )
        .accounts({
            performance: performancePDA,
            actor: actorPDA,
            bridgeConfig: distributionBridgeConfigPDA,
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Record delivery performance
 */
export const recordDeliveryPerformanceToSolana = async (
    data: any,
): Promise<string> => {
    const { actor_id, on_time } = data;
    const actorIdBN = new BN(String(actor_id), 10);

    const [performancePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("performance"), Buffer.from(actorIdBN.toArray("le", 8))],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .recordDeliveryPerformance(actorIdBN, on_time === 1)
        .accounts({
            performance: performancePDA,
            bridgeConfig: distributionBridgeConfigPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Create a new distribution record (Distribution program)
 * Aligned with create_distribution instruction in IDL.
 */
export const submitDistributionToSolana = async (
    data: any,
): Promise<{
    transaction_signature: string;
    merkle_root: string | null;
    proofs: any[];
}> => {
    const {
        distribution_id,
        previous_distribution_id,
        from_org_id,
        to_org_id,
        items,
        warehouse_location,
        destination_location,
        gps_lat,
        gps_lon,
        expected_delivery_date,
    } = data;

    const distIdBN = new BN(String(distribution_id || 0), 10);
    const prevDistIdBN = new BN(String(previous_distribution_id || 0), 10);
    const fromOrgIdBN = new BN(String(from_org_id || 0), 10);
    const toOrgIdBN = new BN(String(to_org_id || 0), 10);

    // Derive Distribution PDA: [b"dist", authority, distribution_id]
    const [distPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("dist"),
            wallet.publicKey.toBuffer(),
            Buffer.from(distIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    // Derive Org PDAs: [b"organization", authority, org_id]
    const [fromOrgPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("organization"),
            wallet.publicKey.toBuffer(),
            Buffer.from(fromOrgIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    const [toOrgPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("organization"),
            wallet.publicKey.toBuffer(),
            Buffer.from(toOrgIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    // Compute Merkle Root if items are provided
    let merkleRoot = null;
    let proofs: any[] = [];
    if (items && Array.isArray(items) && items.length > 0) {
        try {
            const tree = buildItemsMerkleTree(items);
            merkleRoot = tree.root.toString("hex");
            proofs = items.map((_, index) => ({
                index,
                leaf_hash: tree.leafHashes[index].toString("hex"),
                proof: generateProof(tree.layers, index),
            }));
            console.log(
                `[MERKLE] Generated root for dist ${distribution_id}: ${merkleRoot}`,
            );
        } catch (err) {
            console.error(
                `[MERKLE] Error generating tree for dist ${distribution_id}:`,
                err,
            );
        }
    }

    const txSig = await (distributionProgram.methods as any)
        .createDistribution(
            distIdBN,
            prevDistIdBN,
            fromOrgIdBN,
            toOrgIdBN,
            items || [],
            warehouse_location || "",
            destination_location || "",
            new BN(String(gps_lat || 0), 10),
            new BN(String(gps_lon || 0), 10),
            new BN(String(expected_delivery_date || 0), 10),
            merkleRoot
                ? Array.from(Buffer.from(merkleRoot, "hex"))
                : new Array(32).fill(0),
        )
        .accounts({
            distribution: distPDA,
            bridgeConfig: distributionBridgeConfigPDA,
            fromOrgAuthority: wallet.publicKey,
            fromOrg: fromOrgPDA,
            toOrgAuthority: wallet.publicKey,
            toOrg: toOrgPDA,
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([feePayer])
        .rpc();

    return {
        transaction_signature: txSig,
        merkle_root: merkleRoot,
        proofs: proofs,
    };
};

/**
 * Update delivery status
 */
export const updateDeliveryStatusToSolana = async (
    data: any,
): Promise<string> => {
    const { distribution_id, status } = data;
    const distIdBN = new BN(String(distribution_id), 10);

    const [distPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("distribution"), Buffer.from(distIdBN.toArray("le", 8))],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .updateDeliveryStatus(distIdBN, parseInt(String(status || 0), 10))
        .accounts({
            distribution: distPDA,
            bridgeConfig: distributionBridgeConfigPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Confirm receipt
 */
export const confirmReceiptToSolana = async (data: any): Promise<string> => {
    const { distribution_id } = data;
    const distIdBN = new BN(String(distribution_id), 10);

    const [distPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("distribution"), Buffer.from(distIdBN.toArray("le", 8))],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .confirmReceipt(distIdBN)
        .accounts({
            distribution: distPDA,
            bridgeConfig: distributionBridgeConfigPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Link to chain
 */
export const linkToChainToSolana = async (data: any): Promise<string> => {
    const { distribution_id, solana_tx_signature } = data;
    const distIdBN = new BN(String(distribution_id), 10);

    const [distPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("distribution"), Buffer.from(distIdBN.toArray("le", 8))],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .linkToChain(distIdBN, solana_tx_signature || "")
        .accounts({
            distribution: distPDA,
            bridgeConfig: distributionBridgeConfigPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Delete distribution
 */
export const deleteDistributionOnSolana = async (
    distribution_id: number | string,
): Promise<string> => {
    const distIdBN = new BN(String(distribution_id), 10);

    const [distPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("distribution"), Buffer.from(distIdBN.toArray("le", 8))],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .deleteDistribution(distIdBN)
        .accounts({
            distribution: distPDA,
            bridgeConfig: distributionBridgeConfigPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Close distribution
 */
export const closeDistributionOnSolana = async (
    distribution_id: number | string,
): Promise<string> => {
    const distIdBN = new BN(String(distribution_id), 10);

    const [distPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("distribution"), Buffer.from(distIdBN.toArray("le", 8))],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .closeDistribution(distIdBN)
        .accounts({
            distribution: distPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Submit checkpoint
 */
export const submitCheckpointToSolana = async (data: any): Promise<string> => {
    const { checkpoint_id, distribution_id, location, status } = data;
    const cpIdBN = new BN(String(checkpoint_id), 10);
    const distIdBN = new BN(String(distribution_id), 10);

    const [cpPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("checkpoint"), Buffer.from(cpIdBN.toArray("le", 8))],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .addCheckpoint(
            cpIdBN,
            distIdBN,
            location || "",
            parseInt(String(status || 0), 10),
        )
        .accounts({
            checkpoint: cpPDA,
            bridgeConfig: distributionBridgeConfigPDA,
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Delete checkpoint
 */
export const deleteCheckpointOnSolana = async (
    checkpoint_id: number | string,
): Promise<string> => {
    const cpIdBN = new BN(String(checkpoint_id), 10);

    const [cpPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("checkpoint"), Buffer.from(cpIdBN.toArray("le", 8))],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .deleteCheckpoint(cpIdBN)
        .accounts({
            checkpoint: cpPDA,
            bridgeConfig: distributionBridgeConfigPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};

/**
 * Close checkpoint
 */
export const closeCheckpointOnSolana = async (
    checkpoint_id: number | string,
): Promise<string> => {
    const cpIdBN = new BN(String(checkpoint_id), 10);

    const [cpPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("checkpoint"), Buffer.from(cpIdBN.toArray("le", 8))],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .closeCheckpoint(cpIdBN)
        .accounts({
            checkpoint: cpPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};
