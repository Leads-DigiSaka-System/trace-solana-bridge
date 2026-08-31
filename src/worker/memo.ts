import type { OutboundItem } from "./types.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DOMAIN_PATTERN = /^[a-z0-9._-]{1,80}$/;

/**
 * Build the complete on-chain payload. Only the opaque payload digest is
 * published: database ids, domain names, versions, and chain links remain in
 * Laravel so observers cannot infer a farmer's BUYBACK lifecycle from Memo.
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

    let memo: string;
    if (item.memo_format === "v1") {
        if (item.memo_hash !== null) throw new Error("Legacy Memo rows cannot include memo_hash");
        memo = [
            "digisaka:v1",
            `id=${item.id}`,
            `d=${item.domain}`,
            `s=${item.subject_id}`,
            `v=${item.version}`,
            `h=${payloadHash}`,
            `p=${previousHash}`,
        ].join("|");
    } else if (item.memo_format === "v2") {
        const memoHash = item.memo_hash?.toLowerCase() ?? "";
        if (!HASH_PATTERN.test(memoHash)) {
            throw new Error("Memo hash must be 64 lowercase hexadecimal characters");
        }
        memo = `digisaka:v2|h=${memoHash}`;
    } else {
        throw new Error("Unsupported Memo format");
    }

    // The current Memo program accepts a much larger payload, but keeping a
    // strict bound prevents an accidental future expansion into business data.
    if (Buffer.byteLength(memo, "utf8") > 300) {
        throw new Error("Anchor memo exceeds the 300-byte safety limit");
    }

    return memo;
}

export interface AnchorMemoIdentity {
    outboundId: number | null;
    payloadHash: string;
}

/**
 * Parse the public digest and, for legacy v1 journal entries only, the old id.
 * New v2 entries obtain their callback id from private journal metadata.
 */
export function parseAnchorMemoIdentity(memo: string): AnchorMemoIdentity | null {
    const current = memo.match(/^digisaka:v2\|h=([a-f0-9]{64})$/);
    if (current) return { outboundId: null, payloadHash: current[1] as string };

    const legacy = memo.match(
        /^digisaka:v1\|id=([1-9]\d*)\|d=[a-z0-9._-]{1,80}\|s=[1-9]\d*\|v=[1-9]\d*\|h=([a-f0-9]{64})\|p=(?:-|[a-f0-9]{64})$/,
    );
    if (!legacy) return null;

    const outboundId = Number(legacy[1]);
    if (!Number.isSafeInteger(outboundId) || outboundId <= 0) return null;
    return { outboundId, payloadHash: legacy[2] as string };
}
