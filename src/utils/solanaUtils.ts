import BN from "bn.js";
import { createHash } from "crypto";

/**
 * Convert a hex string to a Uint8Array (32 bytes for SHA-256)
 * If input is not a valid 64-char hex string, generate SHA-256 of input
 */
export function hexToBytes(hex: string): number[] {
    // If it's a valid 64-char hex string (SHA-256 hash), convert directly
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
        const bytes: number[] = [];
        for (let i = 0; i < hex.length; i += 2) {
            bytes.push(parseInt(hex.substring(i, i + 2), 16));
        }
        return bytes;
    }
    // Otherwise, hash the input to get a consistent 32-byte value
    const hash = createHash("sha256")
        .update(hex || "000000")
        .digest();
    return Array.from(hash);
}

/**
 * Generate SHA-256 hash of a PIN and return as 32-byte array
 */
export function hashPinToBytes(pin: string): number[] {
    const hash = createHash("sha256")
        .update(pin || "000000")
        .digest();
    return Array.from(hash);
}

/**
 * Validate and convert actor_id to BN
 *
 * @param actor_id The actor ID (can be number, string, or undefined/null)
 * @param operationName Optional name of the operation for error messages
 * @returns BN instance representing the validated actor_id
 * @throws Error if actor_id is invalid, missing, out of range, or zero
 */
export function validateAndConvertActorId(
    actor_id: any,
    operationName: string = "operation",
): BN {
    if (actor_id === undefined || actor_id === null) {
        throw new Error(`actor_id is required for ${operationName}`);
    }

    const actorIdString = String(actor_id);

    if (!/^\d+$/.test(actorIdString)) {
        throw new Error(
            `Invalid actor_id format: ${actor_id}. Must be a valid u64 (numeric string)`,
        );
    }

    let actorIdBN: BN;
    try {
        actorIdBN = new BN(actorIdString, 10);
    } catch (err) {
        throw new Error(
            `Invalid actor_id format: ${actor_id}. Must be a valid u64 (number or numeric string)`,
        );
    }

    const MAX_U64 = new BN("18446744073709551615");
    if (actorIdBN.lt(new BN(0)) || actorIdBN.gt(MAX_U64)) {
        throw new Error(
            `actor_id out of range: ${actor_id}. Must be between 0 and 18446744073709551615`,
        );
    }

    if (actorIdBN.eq(new BN(0))) {
        throw new Error(`actor_id cannot be 0. Invalid actor ID.`);
    }

    return actorIdBN;
}

/**
 * Validate and convert batch_id to BN
 */
export function validateAndConvertBatchId(
    batch_id: any,
    operationName: string = "operation",
): BN {
    if (batch_id === undefined || batch_id === null) {
        throw new Error(`batch_id is required for ${operationName}`);
    }

    const batchIdString = String(batch_id);

    if (!/^\d+$/.test(batchIdString)) {
        throw new Error(
            `Invalid batch_id format: ${batch_id}. Must be a valid u64 (numeric string)`,
        );
    }

    let batchIdBN: BN;
    try {
        batchIdBN = new BN(batchIdString, 10);
    } catch (err) {
        throw new Error(
            `Invalid batch_id format: ${batch_id}. Must be a valid u64 (number or numeric string)`,
        );
    }

    const MAX_U64 = new BN("18446744073709551615");
    if (batchIdBN.lt(new BN(0)) || batchIdBN.gt(MAX_U64)) {
        throw new Error(
            `batch_id out of range: ${batch_id}. Must be between 0 and 18446744073709551615`,
        );
    }

    if (batchIdBN.eq(new BN(0))) {
        throw new Error(`batch_id cannot be 0. Invalid batch ID.`);
    }

    return batchIdBN;
}
