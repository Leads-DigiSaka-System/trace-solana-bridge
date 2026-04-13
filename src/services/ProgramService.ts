import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import {
    connection,
    feePayer,
    wallet,
    coreProgram,
    bridgeConfigPDA,
    CORE_PROGRAM_ID,
} from "../config/solanaConfig.js";

/**
 * Check if the program is initialized on Solana
 */
export const checkProgramInitialization = async (): Promise<boolean> => {
    try {
        const acc = await connection.getAccountInfo(CORE_PROGRAM_ID);
        if (acc === null) return false;
        return true;
    } catch (err) {
        console.error("Error during program initialization check:", err);
        throw new Error("Failed to communicate with Solana RPC");
    }
};

/**
 * Initialize the program on Solana
 */
export const initializeProgramOnSolana = async (): Promise<string> => {
    try {
        const txSig = await (coreProgram.methods as any)
            .initializeBridgeConfig(feePayer.publicKey)
            .accounts({
                bridgeConfig: bridgeConfigPDA,
                payer: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();
        return txSig;
    } catch (err: any) {
        throw new Error(`Failed to initialize program: ${err.message}`);
    }
};

/**
 * Get program configuration
 */
export const getProgramConfig = async (): Promise<any> => {
    try {
        const accountInfo = await connection.getAccountInfo(bridgeConfigPDA);
        if (accountInfo === null) {
            return {
                isInitialized: false,
                superAdmin: null,
                initializedAt: null,
                configPda: bridgeConfigPDA.toBase58(),
            };
        }

        const configAccount = await (
            coreProgram.account as any
        ).bridgeConfig.fetch(bridgeConfigPDA);

        return {
            isInitialized: configAccount.isInitialized,
            superAdmin: configAccount.bridgeAuthority.toBase58(),
            initializedAt: configAccount.initializedAt.toNumber(),
            configPda: bridgeConfigPDA.toBase58(),
        };
    } catch (err: any) {
        throw new Error(`Failed to fetch program config: ${err.message}`);
    }
};

/**
 * Close program configuration account
 */
export const closeConfigOnSolana = async (): Promise<string> => {
    throw new Error(
        "close_config instruction is not supported in the current program version.",
    );
};

/**
 * Get fee payer public key
 */
export const getFeePayerPublicKey = (): string => {
    return feePayer.publicKey.toBase58();
};
