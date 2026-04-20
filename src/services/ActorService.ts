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
import { validateAndConvertActorId } from "../utils/solanaUtils.js";

/**
 * Submit a new actor to Solana
 */
export const submitActorToSolana = async (actorData: any): Promise<string> => {
    const {
        actor_id,
        user_id,
        name,
        roles,
        organization,
        is_active,
        province,
        city,
        balance,
        address,
        farm_id,
        farmer_id,
        assigned_tps,
        farmer_signature_key,
    } = actorData;

    const actorIdBN = validateAndConvertActorId(actor_id, "creation");

    let rolesString: string;
    if (typeof roles === "string") {
        try {
            const parsed = JSON.parse(roles);
            rolesString = Array.isArray(parsed) ? parsed.join(",") : roles;
        } catch {
            rolesString = roles;
        }
    } else if (Array.isArray(roles)) {
        rolesString = roles.join(",");
    } else {
        rolesString = "";
    }

    const actorTypeU8 = 0;
    const isActiveU8 = is_active ? 1 : 0;
    const balanceStr = String(balance || 0);
    const balanceNum = parseFloat(balanceStr);
    const balanceInSmallestUnit = Math.floor(balanceNum * 100);

    let actorPDA: PublicKey;
    let bump: number;

    try {
        [actorPDA, bump] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("actor"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(actorIdBN.toArray("le", 8)),
            ],
            CORE_PROGRAM_ID,
        );

        const accountInfo = await connection.getAccountInfo(actorPDA);
        if (accountInfo !== null) {
            throw new Error(
                `Actor account already exists on Solana. Actor ID: ${actorIdBN.toString()}`,
            );
        }
    } catch (pdaErr: any) {
        if (pdaErr.message?.includes("already exists")) throw pdaErr;
        throw new Error(
            `Failed to derive PDA for actor_id ${actorIdBN.toString()}: ${pdaErr.message}`,
        );
    }

    try {
        const txSig = await (coreProgram.methods as any)
            .createActor(
                actorIdBN,
                new BN(String(user_id), 10),
                name || "",
                actorTypeU8,
                rolesString || "",
                organization || null,
                isActiveU8,
                province || "",
                city || "",
                new BN(String(balanceInSmallestUnit), 10),
                address || "",
                farm_id || "",
                new BN(String(farmer_id), 10),
                new BN(String(assigned_tps), 10),
                farmer_signature_key || "",
            )
            .accounts({
                actor: actorPDA,
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
 * Check if an actor account exists on Solana
 */
export const checkActorExistsOnSolana = async (
    actorId: number | string,
): Promise<boolean> => {
    try {
        const actorIdBN = validateAndConvertActorId(actorId, "check existence");

        const [actorPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("actor"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(actorIdBN.toArray("le", 8)),
            ],
            CORE_PROGRAM_ID,
        );

        const accountInfo = await connection.getAccountInfo(actorPDA);
        if (accountInfo === null) return false;
        return accountInfo.owner.equals(CORE_PROGRAM_ID);
    } catch (err: any) {
        throw new Error(`Failed to check actor existence: ${err.message}`);
    }
};

/**
 * Get actor account details from Solana
 */
export const getActorFromSolana = async (
    actorId: number | string,
): Promise<any | null> => {
    try {
        const actorIdBN = validateAndConvertActorId(actorId, "fetch");

        const [actorPDA] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("actor"),
                feePayer.publicKey.toBuffer(),
                Buffer.from(actorIdBN.toArray("le", 8)),
            ],
            CORE_PROGRAM_ID,
        );

        try {
            const actorAccount = await (
                coreProgram.account as any
            ).actorAccount.fetch(actorPDA);

            return {
                actor_id: actorAccount.actorId.toString(),
                user_id: actorAccount.userId.toString(),
                name: Buffer.from(
                    actorAccount.name.slice(0, actorAccount.nameLen),
                ).toString("utf8"),
                actor_type: actorAccount.actorType,
                roles: Buffer.from(
                    actorAccount.roles.slice(0, actorAccount.rolesLen),
                ).toString("utf8"),
                organization:
                    actorAccount.organizationLen > 0
                        ? Buffer.from(
                              actorAccount.organization.slice(
                                  0,
                                  actorAccount.organizationLen,
                              ),
                          ).toString("utf8")
                        : null,
                is_active: actorAccount.isActive === 1,
                province: Buffer.from(
                    actorAccount.province.slice(0, actorAccount.provinceLen),
                ).toString("utf8"),
                city: Buffer.from(
                    actorAccount.city.slice(0, actorAccount.cityLen),
                ).toString("utf8"),
                balance: actorAccount.balance.toString(),
                pin_hash: Buffer.from(actorAccount.pinHash).toString("hex"),
                address: Buffer.from(
                    actorAccount.address.slice(0, actorAccount.addressLen),
                ).toString("utf8"),
                farm_id: Buffer.from(
                    actorAccount.farmId.slice(0, actorAccount.farmIdLen),
                ).toString("utf8"),
                farmer_id: actorAccount.farmerId.toString(),
                assigned_tps: actorAccount.assignedTps.toString(),
                timestamp: actorAccount.timestamp.toString(),
                pda: actorPDA.toBase58(),
            };
        } catch (fetchErr) {
            return null;
        }
    } catch (err: any) {
        throw new Error(`Failed to fetch actor: ${err.message}`);
    }
};

/**
 * Update an existing actor on Solana
 */
export const updateActorOnSolana = async (actorData: any): Promise<string> => {
    const {
        actor_id,
        name,
        roles,
        organization,
        is_active,
        province,
        city,
        balance,
        address,
        assigned_tps,
    } = actorData;

    let rolesString: string | null = null;
    if (roles !== undefined && roles !== null) {
        if (typeof roles === "string") {
            try {
                const parsed = JSON.parse(roles);
                rolesString = Array.isArray(parsed) ? parsed.join(",") : roles;
            } catch {
                rolesString = roles;
            }
        } else if (Array.isArray(roles)) {
            rolesString = roles.join(",");
        }
    }

    let isActiveU8: number | null = null;
    if (is_active !== undefined && is_active !== null) {
        isActiveU8 = is_active ? 1 : 0;
    }

    let balanceInSmallestUnit: BN | null = null;
    if (balance !== undefined && balance !== null) {
        const balanceNum = parseFloat(String(balance));
        balanceInSmallestUnit = new BN(
            String(Math.floor(balanceNum * 100)),
            10,
        );
    }

    const actorIdBN = validateAndConvertActorId(actor_id, "update");

    const [actorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(actorIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    try {
        const accountInfo = await connection.getAccountInfo(actorPDA);
        if (accountInfo === null)
            throw new Error(`Actor ${actor_id} does not exist.`);

        const params = [
            actorIdBN,
            name !== undefined ? name : null,
            rolesString !== null ? rolesString : null,
            organization !== undefined && organization !== null
                ? organization
                : null,
            isActiveU8 !== null ? isActiveU8 : null,
            province !== undefined ? province : null,
            city !== undefined ? city : null,
            balanceInSmallestUnit !== null ? balanceInSmallestUnit : null,
            address !== undefined ? address : null,
            assigned_tps !== undefined
                ? new BN(String(assigned_tps), 10)
                : null,
        ];

        const txSig = await (coreProgram.methods as any)
            .updateActor(...params)
            .accounts({
                actor: actorPDA,
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
 * Delete an actor on Solana
 */
export const deleteActorOnSolana = async (actorData: any): Promise<string> => {
    const { actor_id } = actorData;
    const actorIdBN = validateAndConvertActorId(actor_id, "deletion");

    const [actorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(actorIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    try {
        const accountInfo = await connection.getAccountInfo(actorPDA);
        if (accountInfo === null)
            throw new Error(`Actor ${actor_id} does not exist.`);

        const txSig = await (coreProgram.methods as any)
            .deleteActor(actorIdBN)
            .accounts({
                actor: actorPDA,
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
 * Close an actor account permanently
 */
export const closeActorOnSolana = async (actorData: any): Promise<string> => {
    const { actor_id } = actorData;
    const actorIdBN = validateAndConvertActorId(actor_id, "close");

    const [actorPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("actor"),
            feePayer.publicKey.toBuffer(),
            Buffer.from(actorIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );

    try {
        const txSig = await (coreProgram.methods as any)
            .closeActor(actorIdBN)
            .accounts({
                actor: actorPDA,
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
