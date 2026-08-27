import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AnchorJournal } from "../src/services/AnchorJournal.js";

describe("AnchorJournal", () => {
    it("durably deletes a confirmed memo", async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), "digisaka-anchor-journal-"));
        const journalPath = path.join(directory, "journal.json");
        const journal = new AnchorJournal(journalPath);
        try {
            await journal.acquireOwnership();
            await journal.set({
                network: "devnet",
                memo: "memo-to-delete",
                signature: "signature",
                slot: 123,
                finalized_at: "2026-08-27T00:00:00.000Z",
            });

            await expect(journal.delete("memo-to-delete")).resolves.toBe(true);
            expect(journal.get("memo-to-delete")).toBeUndefined();
            expect(JSON.parse(await readFile(journalPath, "utf8"))).toEqual({
                version: 1,
                records: {},
            });
        } finally {
            await journal.releaseOwnership();
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("fails closed when another live instance owns the same journal", async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), "digisaka-anchor-lock-"));
        const journalPath = path.join(directory, "journal.json");
        const first = new AnchorJournal(journalPath);
        const second = new AnchorJournal(journalPath);
        try {
            await first.acquireOwnership();
            await expect(second.acquireOwnership()).rejects.toThrow("already owned");
        } finally {
            await first.releaseOwnership();
            await second.releaseOwnership();
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("recovers a stale same-host PID lock and keeps the stable journal path", async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), "digisaka-anchor-stale-"));
        const journalPath = path.join(directory, "journal.json");
        const lockPath = `${journalPath}.lock`;
        const first = new AnchorJournal(journalPath);
        const restarted = new AnchorJournal(journalPath);
        try {
            await writeFile(
                lockPath,
                `${JSON.stringify({
                    version: 1,
                    token: "stale-token",
                    hostname: os.hostname(),
                    pid: 2_147_483_647,
                    started_at: "2026-08-27T00:00:00.000Z",
                })}\n`,
                "utf8",
            );
            await first.acquireOwnership();
            await first.set({
                network: "devnet",
                memo: "restart-memo",
                signature: "signature",
                slot: 456,
                finalized_at: "2026-08-27T00:00:00.000Z",
            });
            await first.releaseOwnership();

            await restarted.acquireOwnership();
            await restarted.load();
            expect(restarted.get("restart-memo")).toEqual(
                expect.objectContaining({ signature: "signature", slot: 456 }),
            );
        } finally {
            await first.releaseOwnership();
            await restarted.releaseOwnership();
            await rm(directory, { recursive: true, force: true });
        }
    });
});
