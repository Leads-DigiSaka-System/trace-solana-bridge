import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import {
    feePayer,
    wallet,
    coreProgram,
    bridgeConfigPDA,
} from "../config/solanaConfig.js";
import { deriveOrganizationPda } from "../utils/pda.js";

/**
 * Submit a new organization to Solana
 */
export const submitOrganizationToSolana = async (
    orgData: any,
): Promise<string> => {
    const { org_id, name, org_type, province, city, contact_person } = orgData;

    const orgIdBN = new BN(String(org_id), 10);
    const [orgPDA] = deriveOrganizationPda(orgIdBN);

    try {
        const txSig = await (coreProgram.methods as any)
            .createOrganization(
                orgIdBN,
                name || "",
                new BN(String(org_type || 0), 10).toNumber(),
                province || "",
                city || "",
                contact_person || "",
            )
            .accounts({
                organization: orgPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(
            `Failed to execute Anchor createOrganization: ${err.message}`,
        );
    }
};

/**
 * Update an organization on Solana
 */
export const updateOrganizationOnSolana = async (
    orgData: any,
): Promise<string> => {
    const { org_id, name, contact_person, is_active } = orgData;

    const orgIdBN = new BN(String(org_id), 10);
    const [orgPDA] = deriveOrganizationPda(orgIdBN);

    try {
        const txSig = await (coreProgram.methods as any)
            .updateOrganization(
                orgIdBN,
                name || null,
                contact_person || null,
                is_active !== undefined
                    ? new BN(String(is_active), 10).toNumber()
                    : null,
            )
            .accounts({
                organization: orgPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(
            `Failed to execute Anchor updateOrganization: ${err.message}`,
        );
    }
};

/**
 * Delete an organization on Solana
 */
export const deleteOrganizationOnSolana = async (
    org_id: number | string,
): Promise<string> => {
    const orgIdBN = new BN(String(org_id), 10);
    const [orgPDA] = deriveOrganizationPda(orgIdBN);

    try {
        const txSig = await (coreProgram.methods as any)
            .deleteOrganization(orgIdBN)
            .accounts({
                organization: orgPDA,
                bridgeConfig: bridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        throw new Error(
            `Failed to execute Anchor deleteOrganization: ${err.message}`,
        );
    }
};
