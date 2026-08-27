import { buildAnchorMemo, parseAnchorMemoIdentity } from "../src/worker/memo.js";
import type { OutboundItem } from "../src/worker/types.js";

const item: OutboundItem = {
    id: 41,
    domain: "buyback.settlement",
    subject_id: 72,
    version: 3,
    previous_hash: "b".repeat(64),
    payload_hash: "a".repeat(64),
    payload_uri: "https://api.example.test/api/outbound/blockchain/payload/41",
    recovery_only: false,
    created_at: null,
};

describe("buildAnchorMemo", () => {
    it("produces deterministic hash-only contents", () => {
        expect(buildAnchorMemo(item)).toBe(
            `digisaka:v1|id=41|d=buyback.settlement|s=72|v=3|h=${"a".repeat(64)}|p=${"b".repeat(64)}`,
        );
        expect(buildAnchorMemo({ ...item })).toBe(buildAnchorMemo(item));
    });

    it("represents a missing previous hash without adding payload data", () => {
        const memo = buildAnchorMemo({ ...item, previous_hash: null });
        expect(memo).toContain("|p=-");
        expect(memo).not.toContain("payload_uri");
    });

    it("rejects malformed hashes and domains", () => {
        expect(() => buildAnchorMemo({ ...item, payload_hash: "not-a-hash" })).toThrow(
            "Payload hash",
        );
        expect(() => buildAnchorMemo({ ...item, domain: "buyback/unsafe" })).toThrow("Domain");
    });

    it("parses only a complete canonical memo for callback recovery", () => {
        const memo = buildAnchorMemo(item);
        expect(parseAnchorMemoIdentity(memo)).toEqual({
            outboundId: 41,
            payloadHash: "a".repeat(64),
        });
        expect(parseAnchorMemoIdentity(`${memo}|extra=1`)).toBeNull();
        expect(parseAnchorMemoIdentity("digisaka:v1|id=unsafe")).toBeNull();
    });
});
