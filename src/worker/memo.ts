import type { OutboundItem } from "./types.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DOMAIN_PATTERN = /^[a-z0-9._-]{1,80}$/;

/**
 * Build the complete on-chain payload. It deliberately contains hashes and
 * database identifiers only; the canonical buyback JSON never leaves Laravel.
 */
export function buildAnchorMemo(item: OutboundItem): string {
    if (!Number.isSafeInteger(item.id) || item.id <= 0) {
        throw new Error("Outbound id must be a positive safe integer");
    }
    if (!Number.isSafeInteger(item.subject_id) || item.subject_id <= 0) {
        throw new Error("Subject id must be a positive safe integer");
    }
    if (!Number.isSafeInteger(item.version) || item.version <= 0) {
        throw new Error("Version must be a positive safe integer");
    }
    if (!DOMAIN_PATTERN.test(item.domain)) {
        throw new Error("Domain contains unsupported characters");
    }

    const payloadHash = item.payload_hash.toLowerCase();
    if (!HASH_PATTERN.test(payloadHash)) {
        throw new Error("Payload hash must be 64 lowercase hexadecimal characters");
    }

    let previousHash = "-";
    if (item.previous_hash !== null && item.previous_hash !== "") {
        previousHash = item.previous_hash.toLowerCase();
        if (!HASH_PATTERN.test(previousHash)) {
            throw new Error("Previous hash must be null or 64 hexadecimal characters");
        }
    }

    const memo = [
        "digisaka:v1",
        `id=${item.id}`,
        `d=${item.domain}`,
        `s=${item.subject_id}`,
        `v=${item.version}`,
        `h=${payloadHash}`,
        `p=${previousHash}`,
    ].join("|");

    // The current Memo program accepts a much larger payload, but keeping a
    // strict bound prevents an accidental future expansion into business data.
    if (Buffer.byteLength(memo, "utf8") > 300) {
        throw new Error("Anchor memo exceeds the 300-byte safety limit");
    }

    return memo;
}

export interface AnchorMemoIdentity {
    outboundId: number;
    payloadHash: string;
}

/** Extract only the fields needed to replay an idempotent Laravel callback. */
export function parseAnchorMemoIdentity(memo: string): AnchorMemoIdentity | null {
    const match = memo.match(
        /^digisaka:v1\|id=([1-9]\d*)\|d=[a-z0-9._-]{1,80}\|s=[1-9]\d*\|v=[1-9]\d*\|h=([a-f0-9]{64})\|p=(?:-|[a-f0-9]{64})$/,
    );
    if (!match) return null;

    const outboundId = Number(match[1]);
    if (!Number.isSafeInteger(outboundId) || outboundId <= 0) return null;
    return { outboundId, payloadHash: match[2] as string };
}
