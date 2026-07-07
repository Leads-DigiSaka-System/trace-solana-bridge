import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import {
    feePayer,
    wallet,
    coreProgram,
    bridgeConfigPDA,
    CORE_PROGRAM_ID,
} from "../config/solanaConfig.js";

/**
 * Submit a new cluster to Solana
 */
export const submitClusterToSolana = async (
    clusterData: any,
): Promise<string> => {
    const { cluster_id, name, province, city, season } = clusterData;

    const clusterIdBN = new BN(String(cluster_id), 10);

    const [clusterPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("cluster"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(clusterIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    try {
        const txSig = await (coreProgram.methods as any)
            .createCluster(clusterIdBN, name || "", province || "", city || "", parseInt(String(season || 0), 10))
            .accounts({
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
            feePayer.publicKey.toBuffer(),
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
