import { jest } from "@jest/globals";
import { Keypair } from "@solana/web3.js";
import {
    assertFreshSubmissionAllowed,
    confirmAndCleanupJournal,
    persistFinalizedAndConfirm,
    prepareOutboundWorkerStartup,
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
                memo_format: "v2",
                memo_hash: "c".repeat(64),
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
                memo_format: "v2",
                memo_hash: "c".repeat(64),
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

    it("persists and confirms with one identical anchored timestamp", async () => {
        const laravel = { confirm: jest.fn(async () => undefined) };
        const journal = {
            set: jest.fn(async () => undefined),
            delete: jest.fn(async () => true),
        };
        const record = {
            network: "devnet" as const,
            memo: "memo",
            signature: "signature",
            slot: 123,
            finalized_at: null,
            anchor_address: "fee-payer",
        };

        const anchoredAt = await persistFinalizedAndConfirm(
            laravel,
            journal,
            record.memo,
            record,
            {
                id: 1,
                workerId: "worker-1",
                payloadHash: "a".repeat(64),
                signature: record.signature,
                slot: record.slot,
                anchorAddress: record.anchor_address,
            },
        );

        expect(journal.set).toHaveBeenCalledWith(
            expect.objectContaining({ finalized_at: anchoredAt }),
        );
        expect(laravel.confirm).toHaveBeenCalledWith(
            expect.objectContaining({ anchoredAt }),
            undefined,
        );
    });

    it("reuses an already persisted anchored timestamp", async () => {
        const anchoredAt = "2026-08-27T00:00:00.000Z";
        const laravel = { confirm: jest.fn(async () => undefined) };
        const journal = {
            set: jest.fn(async () => undefined),
            delete: jest.fn(async () => true),
        };

        await expect(
            persistFinalizedAndConfirm(
                laravel,
                journal,
                "memo",
                {
                    network: "devnet",
                    memo: "memo",
                    signature: "signature",
                    slot: 123,
                    finalized_at: anchoredAt,
                    anchor_address: "fee-payer",
                },
                {
                    id: 1,
                    workerId: "worker-1",
                    payloadHash: "a".repeat(64),
                    signature: "signature",
                    slot: 123,
                    anchorAddress: "fee-payer",
                },
            ),
        ).resolves.toBe(anchoredAt);
        expect(laravel.confirm).toHaveBeenCalledWith(
            expect.objectContaining({ anchoredAt }),
            undefined,
        );
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

    it("recovers finalized callbacks before failing closed on fee-payer funding", async () => {
        const order: string[] = [];
        const memo = `digisaka:v1|id=17|d=buyback.settlement.saved|s=19|v=1|h=${"f".repeat(64)}|p=-`;
        const anchorAddress = Keypair.generate().publicKey.toBase58();
        const solana = {
            assertClusterHealthy: jest.fn(async () => {
                order.push("cluster");
                return { genesisHash: "devnet-genesis" };
            }),
            assertFunded: jest.fn(async () => {
                order.push("funding");
                throw new Error("fee payer is not funded");
            }),
        };
        const laravel = {
            confirm: jest.fn(async () => {
                order.push("callback");
            }),
        };
        const journal = {
            entries: jest.fn(() => [
                {
                    network: "devnet" as const,
                    memo,
                    signature: "signature-17",
                    slot: 1717,
                    finalized_at: "2026-08-27T00:00:00.000Z",
                    anchor_address: anchorAddress,
                },
            ]),
            delete: jest.fn(async () => true),
        };

        await expect(
            prepareOutboundWorkerStartup(
                solana,
                laravel,
                journal,
                "worker-new",
                "devnet",
            ),
        ).rejects.toThrow("fee payer is not funded");
        expect(order).toEqual(["cluster", "callback", "funding"]);
        expect(journal.delete).toHaveBeenCalledWith(memo);
    });

    it("does not replay callbacks when cluster validation fails", async () => {
        const solana = {
            assertClusterHealthy: jest.fn(async () => {
                throw new Error("wrong cluster");
            }),
            assertFunded: jest.fn(async () => ({ balanceLamports: 100_000 })),
        };
        const laravel = { confirm: jest.fn(async () => undefined) };
        const journal = {
            entries: jest.fn(() => []),
            delete: jest.fn(async () => true),
        };

        await expect(
            prepareOutboundWorkerStartup(
                solana,
                laravel,
                journal,
                "worker-new",
                "devnet",
            ),
        ).rejects.toThrow("wrong cluster");
        expect(journal.entries).not.toHaveBeenCalled();
        expect(laravel.confirm).not.toHaveBeenCalled();
        expect(solana.assertFunded).not.toHaveBeenCalled();
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
