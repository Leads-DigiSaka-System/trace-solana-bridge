import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import {
    feePayer,
    wallet,
    coreProgram,
    bridgeConfigPDA,
    CORE_PROGRAM_ID,
} from "../config/solanaConfig.js";

export type SubmitClusterResult = {
    transaction_signature: string;
    already_exists?: boolean;
};

/**
 * Submit a new cluster to Solana
 */
export const submitClusterToSolana = async (
    clusterData: any,
): Promise<SubmitClusterResult> => {
    const { cluster_id, name, province, city } = clusterData;

    if (cluster_id === undefined || cluster_id === null) {
        throw new Error(
            "cluster_id is required and must not be null/undefined",
        );
    }

    const clusterIdBN = new BN(String(cluster_id), 10);

    const [clusterPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("cluster"),
            wallet.publicKey.toBuffer(),
            Buffer.from(clusterIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    const existing =
        await coreProgram.provider.connection.getAccountInfo(clusterPDA);
    if (existing !== null) {
        try {
            await (coreProgram.account as any).clusterAccount.fetch(
                clusterPDA,
            );

            throw new Error(
                `[STALE_PDA] Cluster PDA for id=${cluster_id} already exists on-chain. ` +
                    `This Solana account was created by a prior cluster record. ` +
                    `A new cluster cannot reuse this on-chain account. ` +
                    `To resolve: close the existing Solana cluster account, then retry creation.`,
            );
        } catch (fetchErr: any) {
            if (fetchErr.message?.includes("[STALE_PDA]")) {
                throw fetchErr;
            }

            console.warn(
                `[SOLANA] Could not fetch on-chain cluster for existing PDA ${clusterPDA.toBase58()}: ${fetchErr.message}. ` +
                    `Treating as unknown — returning already_exists.`,
            );
        }

        const signatures =
            await coreProgram.provider.connection.getSignaturesForAddress(
                clusterPDA,
                { limit: 1 },
                "confirmed",
            );
        const originalSig = signatures?.[0]?.signature ?? "unknown";

        console.warn(
            `[SOLANA] Cluster PDA already exists for id=${cluster_id}. Original tx: ${originalSig}`,
        );

        return {
            transaction_signature: originalSig,
            already_exists: true,
        };
    }

    try {
        const txSig = await (coreProgram.methods as any)
            .createCluster(clusterIdBN, name || "", province || "", city || "")
            .accounts({
                cluster: clusterPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        return { transaction_signature: txSig };
    } catch (err: any) {
        throw new Error(
            `Failed to execute Anchor createCluster: ${err.message}`,
        );
    }
};

/**
 * Add a farmer to a cluster on Solana
 */
export const addFarmerToClusterOnSolana = async (
    data: any,
): Promise<string> => {
    const { cluster_id, farmer_actor_id } = data;

    const clusterIdBN = new BN(String(cluster_id), 10);
    const farmerIdBN = new BN(String(farmer_actor_id), 10);

    const [clusterPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("cluster"),
            wallet.publicKey.toBuffer(),
            Buffer.from(clusterIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    const [linkPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("farmer_cluster"),
            clusterIdBN.toArray("le", 8) as any,
            farmerIdBN.toArray("le", 8) as any,
        ],
        CORE_PROGRAM_ID,
    );

    try {
        const txSig = await (coreProgram.methods as any)
            .addFarmerToCluster(clusterIdBN, farmerIdBN)
            .accounts({
                link: linkPDA,
                cluster: clusterPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(
            `Failed to execute Anchor addFarmerToCluster: ${err.message}`,
        );
    }
};
