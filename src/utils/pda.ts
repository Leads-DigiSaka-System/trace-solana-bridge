import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { CORE_PROGRAM_ID, wallet } from "../config/solanaConfig.js";

/** Bridge wallet — all Core org PDAs use this authority (see Core create_organization seeds). */
export function bridgeAuthorityPubkey(): PublicKey {
    return wallet.publicKey;
}

/**
 * Core OrganizationAccount PDA: [b"organization", authority, org_id_le_u64]
 * Must match digisaka_core + distribution validate_org* helpers.
 */
export function deriveOrganizationPda(
    orgId: BN | number | string,
    authority: PublicKey = bridgeAuthorityPubkey(),
): [PublicKey, number] {
    const orgIdBN =
        orgId instanceof BN ? orgId : new BN(String(orgId), 10);

    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("organization"),
            authority.toBuffer(),
            Buffer.from(orgIdBN.toArray("le", 8)),
        ],
        CORE_PROGRAM_ID,
    );
}
