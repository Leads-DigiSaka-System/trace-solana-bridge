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
 * Register a new validator on Solana
 */
export const registerValidatorOnSolana = async (
    validatorData: any,
): Promise<string> => {
    const { validator_id, name, assigned_province, assigned_city } =
        validatorData;

    const validatorIdBN = new BN(String(validator_id), 10);

    const [validatorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("validator"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(validatorIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    try {
        const txSig = await (coreProgram.methods as any)
            .registerValidator(
                validatorIdBN,
                name || "",
                assigned_province || "",
                assigned_city || "",
            )
            .accounts({
                validator: validatorPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(
            `Failed to execute Anchor registerValidator: ${err.message}`,
        );
    }
};

/**
 * Update a validator on Solana
 */
export const updateValidatorOnSolana = async (
    validatorData: any,
): Promise<string> => {
    const { validator_id, name, assigned_province, assigned_city, is_active } =
        validatorData;

    const validatorIdBN = new BN(String(validator_id), 10);

    const [validatorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("validator"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(validatorIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    try {
        const txSig = await (coreProgram.methods as any)
            .updateValidator(
                validatorIdBN,
                name || null,
                assigned_province || null,
                assigned_city || null,
                is_active !== undefined
                    ? new BN(String(is_active), 10).toNumber()
                    : null,
            )
            .accounts({
                validator: validatorPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(
            `Failed to execute Anchor updateValidator: ${err.message}`,
        );
    }
};

/**
 * Deactivate a validator on Solana
 */
export const deactivateValidatorOnSolana = async (
    validator_id: number | string,
): Promise<string> => {
    const validatorIdBN = new BN(String(validator_id), 10);

    const [validatorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("validator"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(validatorIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    try {
        const txSig = await (coreProgram.methods as any)
            .deactivateValidator(validatorIdBN)
            .accounts({
                validator: validatorPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(
            `Failed to execute Anchor deactivateValidator: ${err.message}`,
        );
    }
};
