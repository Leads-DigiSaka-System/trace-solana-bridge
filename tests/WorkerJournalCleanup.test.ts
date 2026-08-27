import { jest } from "@jest/globals";
import { Keypair } from "@solana/web3.js";
import {
    assertFreshSubmissionAllowed,
    confirmAndCleanupJournal,
    reconcileFinalizedJournalCallbacks,
} from "../src/worker.js";

const confirmation = {
    id: 1,
    workerId: "worker-1",
    payloadHash: "a".repeat(64),
    signature: "signature",
    slot: 123,
    anchorAddress: "fee-payer",
    anchoredAt: "2026-08-27T00:00:00.000Z",
};

describe("worker journal cleanup", () => {
    it("never permits a fresh broadcast for a recovery-only claim", () => {
        expect(() =>
            assertFreshSubmissionAllowed({
                id: 1,
                domain: "buyback.settlement.saved",
                subject_id: 1,
                version: 1,
                previous_hash: null,
                payload_hash: "a".repeat(64),
                payload_uri: "/api/outbound/blockchain/payload/1",
                recovery_only: true,
                created_at: null,
            }),
        ).toThrow("refusing a fresh broadcast");
    });

    it("permits fresh submission for an ordinary claim", () => {
        expect(() =>
            assertFreshSubmissionAllowed({
                id: 1,
                domain: "buyback.settlement.saved",
                subject_id: 1,
                version: 1,
                previous_hash: null,
                payload_hash: "a".repeat(64),
                payload_uri: "/api/outbound/blockchain/payload/1",
                recovery_only: false,
                created_at: null,
            }),
        ).not.toThrow();
    });

    it("deletes the journal entry only after Laravel confirms", async () => {
        const order: string[] = [];
        const laravel = {
            confirm: jest.fn(async () => {
                order.push("confirm");
            }),
        };
        const journal = {
            delete: jest.fn(async () => {
                order.push("delete");
                return true;
            }),
        };

        await confirmAndCleanupJournal(laravel, journal, "memo", confirmation);
        expect(order).toEqual(["confirm", "delete"]);
    });

    it("retains the journal entry when confirmation is ambiguous", async () => {
        const laravel = {
            confirm: jest.fn(async () => {
                throw new Error("callback response lost");
            }),
        };
        const journal = { delete: jest.fn(async () => true) };

        await expect(
            confirmAndCleanupJournal(laravel, journal, "memo", confirmation),
        ).rejects.toThrow("callback response lost");
        expect(laravel.confirm).toHaveBeenCalledTimes(2);
        expect(journal.delete).not.toHaveBeenCalled();
    });

    it("cleans up when the idempotent callback retry observes success", async () => {
        const laravel = {
            confirm: jest
                .fn<() => Promise<void>>()
                .mockRejectedValueOnce(new Error("callback response lost"))
                .mockResolvedValueOnce(undefined),
        };
        const journal = { delete: jest.fn(async () => true) };

        await expect(
            confirmAndCleanupJournal(laravel, journal, "memo", confirmation),
        ).resolves.toBeUndefined();
        expect(laravel.confirm).toHaveBeenCalledTimes(2);
        expect(journal.delete).toHaveBeenCalledWith("memo");
    });

    it("replays finalized callbacks from a retained journal at startup", async () => {
        const memo = `digisaka:v1|id=7|d=buyback.settlement.saved|s=9|v=1|h=${"c".repeat(64)}|p=-`;
        const originalAnchorAddress = Keypair.generate().publicKey.toBase58();
        const laravel = { confirm: jest.fn(async () => undefined) };
        const journal = {
            entries: jest.fn(() => [
                {
                    network: "devnet" as const,
                    memo,
                    signature: "signature-7",
                    slot: 777,
                    finalized_at: "2026-08-27T00:00:00.000Z",
                    anchor_address: originalAnchorAddress,
                },
            ]),
            delete: jest.fn(async () => true),
        };

        await expect(
            reconcileFinalizedJournalCallbacks(
                laravel,
                journal,
                "worker-new",
                "devnet",
            ),
        ).resolves.toEqual({ confirmed: 1, retained: 0 });
        expect(laravel.confirm).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 7,
                payloadHash: "c".repeat(64),
                anchorAddress: originalAnchorAddress,
                slot: 777,
            }),
            undefined,
        );
        expect(journal.delete).toHaveBeenCalledWith(memo);
    });

    it.each([
        ["legacy", undefined],
        ["cross-network", "mainnet"],
    ])("retains %s finalized callbacks without replay", async (_label, network) => {
        const memo = `digisaka:v1|id=8|d=buyback.settlement.saved|s=9|v=1|h=${"d".repeat(64)}|p=-`;
        const laravel = { confirm: jest.fn(async () => undefined) };
        const journal = {
            entries: jest.fn(() => [
                {
                    ...(network ? { network: network as "mainnet" } : {}),
                    memo,
                    signature: "signature-8",
                    slot: 888,
                    finalized_at: "2026-08-27T00:00:00.000Z",
                },
            ]),
            delete: jest.fn(async () => true),
        };

        await expect(
            reconcileFinalizedJournalCallbacks(
                laravel,
                journal,
                "worker-new",
                "devnet",
            ),
        ).resolves.toEqual({ confirmed: 0, retained: 1 });
        expect(laravel.confirm).not.toHaveBeenCalled();
        expect(journal.delete).not.toHaveBeenCalled();
    });

    it("quarantines a current-network finalized record with no original anchor address", async () => {
        const memo = `digisaka:v1|id=9|d=buyback.settlement.saved|s=9|v=1|h=${"e".repeat(64)}|p=-`;
        const laravel = { confirm: jest.fn(async () => undefined) };
        const journal = {
            entries: jest.fn(() => [
                {
                    network: "devnet" as const,
                    memo,
                    signature: "signature-9",
                    slot: 999,
                    finalized_at: "2026-08-27T00:00:00.000Z",
                },
            ]),
            delete: jest.fn(async () => true),
        };

        await expect(
            reconcileFinalizedJournalCallbacks(laravel, journal, "worker-new", "devnet"),
        ).resolves.toEqual({ confirmed: 0, retained: 1 });
        expect(laravel.confirm).not.toHaveBeenCalled();
        expect(journal.delete).not.toHaveBeenCalled();
    });
});
