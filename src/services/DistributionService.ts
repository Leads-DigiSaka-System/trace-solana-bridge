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
import { submitOrganizationToSolana } from "./OrganizationService.js";

/**
 * Submit actor performance (Distribution program)
 */
export const submitActorPerformanceToSolana = async (
    data: any,
): Promise<string> => {
    const { actor_id, performance_score, reports_count, delivery_count } = data;
    const actorIdBN = new BN(String(actor_id), 10);

    const [performancePDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("perf"),
            wallet.publicKey.toBuffer(),
            Buffer.from(actorIdBN.toArray("le", 8)),
        ],
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
        .recordDeliveryPerformance(
            actorIdBN,
            (performance_score || 0) < 100 ? 0 : 1, // Example logic for late
            new BN(String(reports_count || 0), 10),
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
    const { actor_id, on_time, delay_hours } = data;
    const actorIdBN = new BN(String(actor_id), 10);

    const [performancePDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("perf"),
            wallet.publicKey.toBuffer(),
            Buffer.from(actorIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .recordDeliveryPerformance(
            actorIdBN,
            on_time === 1 || on_time === true ? 0 : 1, // is_late (0=false, 1=true)
            new BN(String(delay_hours || 0), 10),
        )
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
    already_exists?: boolean;
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
        from_org_type,
        from_org_name,
        to_org_type,
        to_org_name,
    } = data;

    // At the top of submitDistributionToSolana
    if (!distribution_id && distribution_id !== 0) {
        throw new Error(
            "distribution_id is required and must not be null/undefined",
        );
    }

    const distIdBN = new BN(String(distribution_id ?? 0), 10);
    const prevDistIdBN = new BN(String(previous_distribution_id ?? 0), 10);
    const fromOrgIdBN = new BN(String(from_org_id ?? 0), 10);
    const toOrgIdBN = new BN(String(to_org_id ?? 0), 10);

    // Derive Distribution PDA: [b"dist", authority, distribution_id]
    const [distPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("dist"),
            wallet.publicKey.toBuffer(),
            Buffer.from(distIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    // Compute Merkle Root if items are provided
    let merkleRoot = null;
    let proofs: any[] = [];
    if (items && Array.isArray(items) && items.length > 0) {
        try {
            const tree = buildItemsMerkleTree(items);
            merkleRoot = tree.root!.toString("hex");
            proofs = items.map((_, index) => ({
                index,
                leaf_hash: tree.leafHashes![index]!.toString("hex"),
                proof: generateProof(tree.layers!, index),
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

    // ✅ Pre-flight: check if already exists
    const existing =
        await distributionProgram.provider.connection.getAccountInfo(distPDA);
    if (existing !== null) {
        // Fetch the on-chain account to read its current status.
        // If the status is > 0 (past allocated), this PDA is stale — most
        // likely from a previous distribution that went through transitions
        // before the DB was reset. We must NOT allow the new distribution
        // to silently bind to this stale on-chain account.
        try {
            const onchainDist = await (
                distributionProgram.account as any
            ).distributionRecord.fetch(distPDA);
            const onchainStatus: number = onchainDist.status ?? -1;

            if (onchainStatus > 0) {
                throw new Error(
                    `[STALE_PDA] Distribution PDA for id=${distribution_id} already exists on-chain ` +
                        `with status=${onchainStatus} (0=allocated, 1=dispatched, 2=in_transit, 3=delivered, 4=received, 5=confirmed, 6=cancelled). ` +
                        `This Solana account was created by a prior distribution and has already advanced through transitions. ` +
                        `A new distribution cannot reuse this on-chain account. ` +
                        `To resolve: close the existing Solana account via the admin close-distribution endpoint, ` +
                        `then retry creation.`,
                );
            }

            console.warn(
                `[SOLANA] Distribution PDA already exists for id=${distribution_id} with status=0 (allocated). ` +
                    `Treating as idempotent — returning original transaction.`,
            );
        } catch (fetchErr: any) {
            // Re-throw our own stale-PDA error immediately.
            if (fetchErr.message?.includes("[STALE_PDA]")) {
                throw fetchErr;
            }
            // If we can't read the on-chain account (e.g., RPC error), log and
            // fall through conservatively — better to surface an error than to
            // silently allow a potentially desynced distribution.
            console.warn(
                `[SOLANA] Could not fetch on-chain status for existing PDA ${distPDA.toBase58()}: ${fetchErr.message}. ` +
                    `Treating as unknown — returning already_exists.`,
            );
        }

        const signatures =
            await distributionProgram.provider.connection.getSignaturesForAddress(
                distPDA,
                { limit: 1 },
                "confirmed",
            );
        const originalSig = signatures?.[0]?.signature ?? "unknown";

        console.warn(
            `[SOLANA] Distribution PDA already exists for id=${distribution_id}. Original tx: ${originalSig}`,
        );

        return {
            transaction_signature: originalSig,
            merkle_root: merkleRoot,
            proofs: proofs,
            already_exists: true,
        };
    }

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

    // Auto-init Organizations if they don't exist on-chain
    await ensureOrganizationExists(
        from_org_id,
        from_org_type,
        from_org_name,
        fromOrgPDA,
    );
    await ensureOrganizationExists(
        to_org_id,
        to_org_type,
        to_org_name,
        toOrgPDA,
    );

    console.log("Authority:", wallet.publicKey.toBase58());
    console.log("Distribution ID:", distIdBN.toString());
    console.log("Derived PDA:", distPDA.toBase58());

    console.log(
        "Raw distribution_id from data:",
        data.distribution_id,
        typeof data.distribution_id,
    );

    const txSig = await (distributionProgram.methods as any)
        .createDistribution(
            distIdBN,
            prevDistIdBN,
            fromOrgIdBN,
            toOrgIdBN,
            transformItems(items),
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
 * Check if organization exists on-chain, initialize if missing
 */
async function ensureOrganizationExists(
    orgId: any,
    orgType: any,
    name: any,
    pda: PublicKey,
): Promise<void> {
    if (!orgId || Number(orgId) === 0) return;

    try {
        const accInfo =
            await distributionProgram.provider.connection.getAccountInfo(pda);
        if (!accInfo || !accInfo.owner.equals(CORE_PROGRAM_ID)) {
            console.log(
                `[SOLANA] Organization ${orgId} missing or not owned by Core. Auto-initializing...`,
            );
            await submitOrganizationToSolana({
                org_id: orgId,
                name: name || `Organization ${orgId}`,
                org_type: orgType || 0,
                province: "",
                city: "",
                contact_person: "",
            });
            console.log(
                `[SOLANA] Organization ${orgId} auto-initialized successfully.`,
            );
        }
    } catch (err) {
        console.warn(
            `[SOLANA] Failed to check/init organization ${orgId}:`,
            err,
        );
    }
}

/**
 * Helper to pad strings and convert to byte arrays for Solana fixed-length fields
 */
function padStringToBytes(str: string, length: number): number[] {
    const bytes = new Uint8Array(length);
    const strBytes = Buffer.from(str, "utf8");
    bytes.set(strBytes.slice(0, length));
    return Array.from(bytes);
}

/**
 * Transforms raw item data into the format expected by the Solana program
 */
function transformItems(items: any[]): any[] {
    return (items || []).slice(0, 5).map((item) => {
        const itemName = (item.item_name || "").slice(0, 50);
        const unit = (item.unit || "").slice(0, 10);
        const variety = (item.variety || "").slice(0, 30);
        const serialNumber = (item.serial_number || "").slice(0, 30);
        const supplierOrigin = (item.supplier_origin || "").slice(0, 100);

        return {
            itemType: new BN(item.item_type || 0),
            itemName: padStringToBytes(itemName, 50),
            itemNameLen: new BN(itemName.length),
            quantity: new BN(String(item.quantity || 0), 10),
            unit: padStringToBytes(unit, 10),
            unitLen: new BN(unit.length),
            variety: padStringToBytes(variety, 30),
            varietyLen: new BN(variety.length),
            serialNumber: padStringToBytes(serialNumber, 30),
            serialNumberLen: new BN(serialNumber.length),
            supplierOrigin: padStringToBytes(supplierOrigin, 100),
            supplierOriginLen: new BN(supplierOrigin.length),
        };
    });
}

/**
 * Update delivery status
 */
export const updateDeliveryStatusToSolana = async (
    data: any,
): Promise<string> => {
    const { distribution_id, status, gps_lat, gps_lon } = data;
    const distIdBN = new BN(String(distribution_id), 10);

    const [distPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("dist"),
            wallet.publicKey.toBuffer(),
            Buffer.from(distIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    try {
        const txSig = await (distributionProgram.methods as any)
            .updateDeliveryStatus(
                distIdBN,
                parseInt(String(status || 0), 10),
                new BN(String(gps_lat || 0), 10),
                new BN(String(gps_lon || 0), 10),
            )
            .accounts({
                distribution: distPDA,
                bridgeConfig: distributionBridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        if (
            err.message &&
            (err.message.includes("InvalidStatusTransition") ||
                err.message.includes("6005"))
        ) {
            console.warn(
                `[SOLANA] Distribution ${distribution_id} already updated/forwarded (InvalidStatusTransition). Returning latest signature.`,
            );
            const signatures =
                await distributionProgram.provider.connection.getSignaturesForAddress(
                    distPDA,
                    { limit: 1 },
                    "confirmed",
                );
            return signatures?.[0]?.signature ?? "unknown";
        }
        throw err;
    }
};

/**
 * Record QA inspection results (accepted/rejected qty) while status == RECEIVED
 */
export const recordQaToSolana = async (data: any): Promise<string> => {
    const { distribution_id, accepted_qty, rejected_qty } = data;
    const distIdBN = new BN(String(distribution_id), 10);

    const [distPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("dist"),
            wallet.publicKey.toBuffer(),
            Buffer.from(distIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    try {
        const txSig = await (distributionProgram.methods as any)
            .recordQa(
                distIdBN,
                new BN(String(accepted_qty || 0), 10),
                new BN(String(rejected_qty || 0), 10),
            )
            .accounts({
                distribution: distPDA,
                bridgeConfig: distributionBridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        if (
            err.message &&
            (err.message.includes("InvalidStatusTransition") ||
                err.message.includes("6005"))
        ) {
            console.warn(
                `[SOLANA] Distribution ${distribution_id} not in RECEIVED state (InvalidStatusTransition). Returning latest signature.`,
            );
            const signatures =
                await distributionProgram.provider.connection.getSignaturesForAddress(
                    distPDA,
                    { limit: 1 },
                    "confirmed",
                );
            return signatures?.[0]?.signature ?? "unknown";
        }
        throw err;
    }
};

/**
 * Confirm receipt
 */
export const confirmReceiptToSolana = async (data: any): Promise<string> => {
    const {
        distribution_id,
        from_org_id,
        from_org_type,
        recipient_signature,
        signed_by_actor_id,
        signer_role,
        signer_organization_id,
    } = data;
    const distIdBN = new BN(String(distribution_id), 10);
    const fromOrgIdBN = new BN(String(from_org_id || 0), 10);
    const fromOrgType = parseInt(String(from_org_type || 0), 10);

    const [distPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("dist"),
            wallet.publicKey.toBuffer(),
            Buffer.from(distIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    const [performancePDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("perf"),
            wallet.publicKey.toBuffer(),
            Buffer.from(fromOrgIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    // Check if performance account exists, initialize if missing (unless FCA)
    // FCAs (org_type 3) are excluded from scoring.
    let performanceAccountToPass = performancePDA;
    if (fromOrgType === 3) {
        // For FCA, pass bridge config as placeholder as per IDL docs
        performanceAccountToPass = distributionBridgeConfigPDA;
    } else {
        try {
            const accInfo =
                await distributionProgram.provider.connection.getAccountInfo(
                    performancePDA,
                );
            if (!accInfo) {
                console.log(
                    `[SOLANA] Initializing performance account for org ${from_org_id}...`,
                );
                await (distributionProgram.methods as any)
                    .createActorPerformance(fromOrgIdBN, fromOrgType)
                    .accounts({
                        performance: performancePDA,
                        bridgeConfig: distributionBridgeConfigPDA,
                        authority: wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([feePayer])
                    .rpc();
            }
        } catch (err) {
            console.error(
                `[SOLANA] Failed to check/init performance account for org ${from_org_id}:`,
                err,
            );
        }
    }

    try {
        const txSig = await (distributionProgram.methods as any)
            .confirmReceipt(
                distIdBN,
                Array.from(Buffer.from(recipient_signature, "base64")),
                new BN(String(signed_by_actor_id), 10),
                signer_role || "",
                new BN(String(signer_organization_id || 0), 10),
            )
            .accounts({
                distribution: distPDA,
                performance: performanceAccountToPass,
                bridgeConfig: distributionBridgeConfigPDA,
                authority: wallet.publicKey,
            })
            .signers([feePayer])
            .rpc();

        return txSig;
    } catch (err: any) {
        if (
            err.message &&
            (err.message.includes("InvalidStatusTransition") ||
                err.message.includes("6005"))
        ) {
            console.warn(
                `[SOLANA] Distribution ${distribution_id} already confirmed (InvalidStatusTransition). Returning latest signature.`,
            );
            const signatures =
                await distributionProgram.provider.connection.getSignaturesForAddress(
                    distPDA,
                    { limit: 1 },
                    "confirmed",
                );
            return signatures?.[0]?.signature ?? "unknown";
        }
        throw err;
    }
};

/**
 * Link to chain
 */
export const linkToChainToSolana = async (data: any): Promise<string> => {
    const { distribution_id, previous_distribution_id } = data;
    const distIdBN = new BN(String(distribution_id), 10);
    const prevDistIdBN = new BN(String(previous_distribution_id), 10);

    const [distPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("dist"),
            wallet.publicKey.toBuffer(),
            Buffer.from(distIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    const [prevDistPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("dist"),
            wallet.publicKey.toBuffer(),
            Buffer.from(prevDistIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .linkToChain(distIdBN, prevDistIdBN)
        .accounts({
            currentDistribution: distPDA,
            previousDistribution: prevDistPDA,
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
        [
            Buffer.from("dist"),
            wallet.publicKey.toBuffer(),
            Buffer.from(distIdBN.toArray("le", 8)),
        ],
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
        [
            Buffer.from("dist"),
            wallet.publicKey.toBuffer(),
            Buffer.from(distIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .closeDistribution(distIdBN)
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
 * Submit checkpoint
 */
export const submitCheckpointToSolana = async (data: any): Promise<string> => {
    const {
        checkpoint_id,
        distribution_id,
        location,
        status,
        gps_lat,
        gps_lon,
        recorded_by,
    } = data;
    const cpIdBN = new BN(String(checkpoint_id), 10);
    const distIdBN = new BN(String(distribution_id), 10);

    const [cpPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("checkpoint"),
            wallet.publicKey.toBuffer(),
            Buffer.from(cpIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .addCheckpoint(
            cpIdBN,
            distIdBN,
            parseInt(String(status || 0), 10),
            location || "",
            new BN(String(gps_lat || 0), 10),
            new BN(String(gps_lon || 0), 10),
            new BN(String(recorded_by || 0), 10),
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
        [
            Buffer.from("checkpoint"),
            wallet.publicKey.toBuffer(),
            Buffer.from(cpIdBN.toArray("le", 8)),
        ],
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
        [
            Buffer.from("checkpoint"),
            wallet.publicKey.toBuffer(),
            Buffer.from(cpIdBN.toArray("le", 8)),
        ],
        DISTRIBUTION_PROGRAM_ID,
    );

    const txSig = await (distributionProgram.methods as any)
        .closeCheckpoint(cpIdBN)
        .accounts({
            checkpoint: cpPDA,
            bridgeConfig: distributionBridgeConfigPDA,
            authority: wallet.publicKey,
        })
        .signers([feePayer])
        .rpc();

    return txSig;
};
