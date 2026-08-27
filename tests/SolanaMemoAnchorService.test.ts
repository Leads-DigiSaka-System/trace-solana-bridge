import { jest } from "@jest/globals";
import { Keypair, type Connection } from "@solana/web3.js";
import {
    MEMO_PROGRAM_ID,
    SolanaMemoAnchorService,
} from "../src/services/SolanaMemoAnchorService.js";
import type { PreparedAnchor } from "../src/worker/types.js";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

function service(
    connection: object,
    feePayer = Keypair.generate(),
    options: {
        reconcileLookback?: number;
        reconcileTimeoutMs?: number;
        rpcTimeoutMs?: number;
    } = {},
): SolanaMemoAnchorService {
    return new SolanaMemoAnchorService({
        connection: connection as Connection,
        feePayer,
        network: "devnet",
        rpcTimeoutMs: options.rpcTimeoutMs ?? 1_000,
        confirmTimeoutMs: 10_000,
        sendMaxRetries: 1,
        reconcileLookback: options.reconcileLookback ?? 100,
        reconcileTimeoutMs: options.reconcileTimeoutMs ?? 2_000,
    });
}

function parsedMemo(feePayer: Keypair, memo: string, signature: string, slot = 987) {
    return {
        slot,
        meta: { err: null },
        transaction: {
            message: {
                accountKeys: [{ pubkey: feePayer.publicKey, signer: true, writable: true }],
                instructions: [{ program: "spl-memo", programId: MEMO_PROGRAM_ID, parsed: memo }],
            },
            signatures: [signature],
        },
    };
}

describe("SolanaMemoAnchorService", () => {
    it("checks the cluster, executable Memo program, and fee balance", async () => {
        const connection = {
            getGenesisHash: jest.fn().mockResolvedValue(DEVNET_GENESIS),
            getAccountInfo: jest.fn().mockResolvedValue({ executable: true }),
            getBalance: jest.fn().mockResolvedValue(100_000),
        };
        await expect(service(connection).assertHealthy()).resolves.toEqual({
            genesisHash: DEVNET_GENESIS,
            balanceLamports: 100_000,
        });
    });

    it("rejects an RPC connected to a different cluster", async () => {
        const connection = {
            getGenesisHash: jest.fn().mockResolvedValue("unexpected-genesis"),
            getAccountInfo: jest.fn().mockResolvedValue({ executable: true }),
            getBalance: jest.fn().mockResolvedValue(100_000),
        };
        await expect(service(connection).assertHealthy()).rejects.toMatchObject({
            code: "network_mismatch",
            retryable: false,
        });
    });

    it("reconciles only an exact finalized memo signed by the fee payer", async () => {
        const feePayer = Keypair.generate();
        const memo = `digisaka:v1|id=1|d=buyback.application|s=2|v=1|h=${"a".repeat(64)}|p=-`;
        const connection = {
            getSignaturesForAddress: jest.fn().mockResolvedValue([
                {
                    signature: "existing-signature",
                    slot: 987,
                    err: null,
                    memo: `[memo] ${memo}`,
                    confirmationStatus: "finalized",
                },
            ]),
            getParsedTransactions: jest
                .fn()
                .mockResolvedValue([parsedMemo(feePayer, memo, "existing-signature")]),
        };
        await expect(service(connection, feePayer).findFinalizedByMemo(memo)).resolves.toEqual({
            signature: "existing-signature",
            slot: 987,
            source: "reconciled",
        });
    });

    it("caps history and parses it in bounded batches", async () => {
        const feePayer = Keypair.generate();
        const memo = `digisaka:v1|id=2|d=buyback.application|s=2|v=1|h=${"b".repeat(64)}|p=-`;
        const entries = Array.from({ length: 300 }, (_, index) => ({
            signature: `signature-${index}`,
            slot: index + 1,
            err: null,
            memo: null,
            confirmationStatus: "finalized",
        }));
        const getParsedTransactions = jest.fn(async (signatures: string[]) =>
            signatures.map(() => null),
        );
        const connection = {
            getSignaturesForAddress: jest.fn().mockResolvedValue(entries),
            getParsedTransactions,
        };

        await expect(
            service(connection, feePayer, { reconcileLookback: 100 }).findFinalizedByMemo(memo),
        ).resolves.toBeNull();
        expect(connection.getSignaturesForAddress).toHaveBeenCalledWith(
            feePayer.publicKey,
            { limit: 100 },
            "finalized",
        );
        expect(getParsedTransactions).toHaveBeenCalledTimes(4);
        for (const call of getParsedTransactions.mock.calls) {
            expect((call[0] as string[]).length).toBeLessThanOrEqual(25);
        }
    });

    it("does not submit over a likely transaction while RPC parsing is unavailable", async () => {
        const feePayer = Keypair.generate();
        const memo = `digisaka:v1|id=8|d=buyback.settlement.saved|s=4|v=1|h=${"d".repeat(64)}|p=-`;
        const connection = {
            getSignaturesForAddress: jest.fn().mockResolvedValue([
                {
                    signature: "likely-existing-signature",
                    slot: 100,
                    err: null,
                    memo: `[memo] ${memo}`,
                    confirmationStatus: "finalized",
                },
            ]),
            getParsedTransactions: jest.fn().mockResolvedValue([null]),
        };

        await expect(service(connection, feePayer).findFinalizedByMemo(memo)).rejects.toMatchObject({
            code: "reconciliation_transaction_unavailable",
            retryable: true,
        });
    });

    it("treats null execution metadata as retryable and never as verified", async () => {
        const feePayer = Keypair.generate();
        const memo = `digisaka:v1|id=11|d=buyback.application|s=4|v=1|h=${"1".repeat(64)}|p=-`;
        const connection = {
            getParsedTransaction: jest.fn().mockResolvedValue({
                ...parsedMemo(feePayer, memo, "metadata-missing"),
                meta: null,
            }),
        };

        await expect(
            service(connection, feePayer).verifyFinalizedSignature("metadata-missing", memo),
        ).rejects.toMatchObject({
            code: "transaction_metadata_unavailable",
            retryable: true,
        });
    });

    it("does not accept null metadata from batched reconciliation", async () => {
        const feePayer = Keypair.generate();
        const memo = `digisaka:v1|id=12|d=buyback.application|s=4|v=1|h=${"2".repeat(64)}|p=-`;
        const connection = {
            getSignaturesForAddress: jest.fn().mockResolvedValue([
                {
                    signature: "likely-null-metadata",
                    slot: 321,
                    err: null,
                    memo,
                    confirmationStatus: "finalized",
                },
            ]),
            getParsedTransactions: jest.fn().mockResolvedValue([
                {
                    ...parsedMemo(feePayer, memo, "likely-null-metadata", 321),
                    meta: null,
                },
            ]),
        };

        await expect(service(connection, feePayer).findFinalizedByMemo(memo)).rejects.toMatchObject({
            code: "reconciliation_transaction_unavailable",
            retryable: true,
        });
    });

    it("bounds a hung claimed-item RPC before a transaction is prepared", async () => {
        jest.useFakeTimers();
        try {
            const connection = {
                getLatestBlockhash: jest.fn(() => new Promise(() => undefined)),
            };
            const request = service(connection, Keypair.generate(), {
                rpcTimeoutMs: 50,
            }).submitAndFinalize("memo", async () => undefined);
            const expectation = expect(request).rejects.toMatchObject({
                code: "solana_rpc_timeout",
                retryable: true,
            });
            await jest.advanceTimersByTimeAsync(51);
            await expectation;
        } finally {
            jest.useRealTimers();
        }
    });

    it("preserves a prepared transaction when the fee payer drains mid-run", async () => {
        const feePayer = Keypair.generate();
        const memo = `digisaka:v1|id=8|d=buyback.application|s=2|v=1|h=${"8".repeat(64)}|p=-`;
        let prepared: PreparedAnchor | undefined;
        const connection = {
            getLatestBlockhash: jest.fn().mockResolvedValue({
                blockhash: "11111111111111111111111111111111",
                lastValidBlockHeight: 999,
            }),
            sendRawTransaction: jest
                .fn()
                .mockRejectedValue(new Error("Transaction simulation failed: insufficient funds for fee")),
            confirmTransaction: jest.fn(),
        };

        await expect(
            service(connection, feePayer).submitAndFinalize(memo, async (candidate) => {
                prepared = candidate;
            }),
        ).rejects.toMatchObject({
            code: "insufficient_funds",
            retryable: true,
        });
        expect(prepared).toMatchObject({ network: "devnet" });
        expect(connection.sendRawTransaction).toHaveBeenCalledTimes(1);
        expect(connection.confirmTransaction).not.toHaveBeenCalled();
    });

    it("enforces a retryable reconciliation timeout", async () => {
        jest.useFakeTimers();
        try {
            const connection = {
                getSignaturesForAddress: jest.fn(() => new Promise(() => undefined)),
            };
            const request = service(connection, Keypair.generate(), {
                reconcileTimeoutMs: 50,
            }).findFinalizedByMemo("memo");
            const expectation = expect(request).rejects.toMatchObject({
                code: "reconciliation_timeout",
                retryable: true,
            });
            await jest.advanceTimersByTimeAsync(51);
            await expectation;
        } finally {
            jest.useRealTimers();
        }
    });

    it("journals before broadcast and recovers parsing lag with the identical signature", async () => {
        const feePayer = Keypair.generate();
        const memo = `digisaka:v1|id=3|d=buyback.payment.recorded|s=9|v=1|h=${"c".repeat(64)}|p=-`;
        let prepared: PreparedAnchor | undefined;
        const order: string[] = [];
        const getParsedTransaction = jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockImplementationOnce(async () => {
                if (!prepared) throw new Error("prepared anchor missing");
                return parsedMemo(feePayer, memo, prepared.signature, 555);
            });
        const sendRawTransaction = jest.fn(async () => {
            order.push("send");
            if (!prepared) throw new Error("journal callback did not run");
            return prepared.signature;
        });
        const connection = {
            getLatestBlockhash: jest.fn().mockResolvedValue({
                blockhash: "11111111111111111111111111111111",
                lastValidBlockHeight: 999,
            }),
            sendRawTransaction,
            confirmTransaction: jest.fn().mockResolvedValue({
                context: { slot: 555 },
                value: { err: null },
            }),
            getParsedTransaction,
            getSignatureStatuses: jest.fn().mockResolvedValue({
                context: { slot: 500 },
                value: [null],
            }),
            getBlockHeight: jest.fn().mockResolvedValue(500),
        };
        const anchorService = service(connection, feePayer);

        await expect(
            anchorService.submitAndFinalize(memo, async (candidate) => {
                order.push("journal");
                prepared = candidate;
            }),
        ).rejects.toMatchObject({
            code: "finalized_transaction_unavailable",
            retryable: true,
        });
        expect(order.slice(0, 2)).toEqual(["journal", "send"]);
        if (!prepared) throw new Error("prepared anchor missing after submission");
        expect(prepared.network).toBe("devnet");

        const firstRawBytes = sendRawTransaction.mock.calls[0]?.[0] as Buffer;
        await expect(
            anchorService.recoverJournaled(
                {
                    network: "devnet",
                    memo,
                    signature: prepared.signature,
                    slot: null,
                    finalized_at: null,
                    ...prepared,
                },
                memo,
            ),
        ).resolves.toEqual({
            signature: prepared.signature,
            slot: 555,
            source: "journal",
        });
        const retriedRawBytes = sendRawTransaction.mock.calls[1]?.[0] as Buffer;
        expect(retriedRawBytes.equals(firstRawBytes)).toBe(true);
        expect(sendRawTransaction).toHaveBeenCalledTimes(2);
        expect(connection.getSignatureStatuses).toHaveBeenCalledWith(
            [prepared.signature],
            { searchTransactionHistory: true },
        );
        expect(connection.getBlockHeight).toHaveBeenCalledWith("finalized");
    });

    it("allows replacement only when an absent prepared signature is objectively expired", async () => {
        const feePayer = Keypair.generate();
        const memo = `digisaka:v1|id=4|d=buyback.application|s=9|v=1|h=${"e".repeat(64)}|p=-`;
        const sendRawTransaction = jest.fn();
        const connection = {
            getParsedTransaction: jest.fn().mockResolvedValue(null),
            getSignatureStatuses: jest.fn().mockResolvedValue({
                context: { slot: 1_200 },
                value: [null],
            }),
            getBlockHeight: jest.fn().mockResolvedValue(1_200),
            sendRawTransaction,
        };

        await expect(
            service(connection, feePayer).recoverJournaled(
                {
                    network: "devnet",
                    memo,
                    signature: "expired-absent-signature",
                    slot: null,
                    finalized_at: null,
                    submitted_at: "2026-08-27T00:00:00.000Z",
                    raw_transaction_base64: Buffer.from("signed-transaction").toString("base64"),
                    blockhash: "expired-blockhash",
                    last_valid_block_height: 999,
                },
                memo,
            ),
        ).resolves.toBeNull();
        expect(sendRawTransaction).not.toHaveBeenCalled();
    });

    it("never rotates an expired signature that has any recorded status", async () => {
        const feePayer = Keypair.generate();
        const memo = `digisaka:v1|id=5|d=buyback.application|s=9|v=1|h=${"f".repeat(64)}|p=-`;
        const signature = "known-signature";
        const rawBytes = Buffer.from("same-signed-transaction");
        const sendRawTransaction = jest.fn().mockResolvedValue(signature);
        const connection = {
            getParsedTransaction: jest
                .fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(parsedMemo(feePayer, memo, signature, 777)),
            getSignatureStatuses: jest.fn().mockResolvedValue({
                context: { slot: 1_200 },
                value: [
                    {
                        slot: 777,
                        confirmations: 1,
                        err: null,
                        confirmationStatus: "confirmed",
                    },
                ],
            }),
            getBlockHeight: jest.fn().mockResolvedValue(1_200),
            sendRawTransaction,
            confirmTransaction: jest.fn().mockResolvedValue({
                context: { slot: 777 },
                value: { err: null },
            }),
        };

        await expect(
            service(connection, feePayer).recoverJournaled(
                {
                    network: "devnet",
                    memo,
                    signature,
                    slot: null,
                    finalized_at: null,
                    submitted_at: "2026-08-27T00:00:00.000Z",
                    raw_transaction_base64: rawBytes.toString("base64"),
                    blockhash: "expired-blockhash",
                    last_valid_block_height: 999,
                },
                memo,
            ),
        ).resolves.toEqual({ signature, slot: 777, source: "journal" });
        expect(sendRawTransaction).toHaveBeenCalledTimes(1);
        expect((sendRawTransaction.mock.calls[0]?.[0] as Buffer).equals(rawBytes)).toBe(true);
    });

    it("rejects cross-network journal recovery before any RPC or raw replay", async () => {
        const getParsedTransaction = jest.fn();
        const sendRawTransaction = jest.fn();
        const anchorService = service({ getParsedTransaction, sendRawTransaction });

        await expect(
            anchorService.recoverJournaled(
                {
                    network: "mainnet",
                    memo: "memo",
                    signature: "mainnet-signature",
                    slot: null,
                    finalized_at: null,
                    raw_transaction_base64: Buffer.from("mainnet-signed").toString("base64"),
                    blockhash: "mainnet-blockhash",
                    last_valid_block_height: 999,
                },
                "memo",
            ),
        ).rejects.toMatchObject({ code: "journal_network_mismatch", retryable: false });
        expect(getParsedTransaction).not.toHaveBeenCalled();
        expect(sendRawTransaction).not.toHaveBeenCalled();
    });

    it("quarantines legacy journal recovery without network provenance", async () => {
        const getParsedTransaction = jest.fn();
        const sendRawTransaction = jest.fn();
        const anchorService = service({ getParsedTransaction, sendRawTransaction });

        await expect(
            anchorService.recoverJournaled(
                {
                    memo: "memo",
                    signature: "legacy-signature",
                    slot: null,
                    finalized_at: null,
                    raw_transaction_base64: Buffer.from("legacy-signed").toString("base64"),
                    blockhash: "legacy-blockhash",
                    last_valid_block_height: 999,
                },
                "memo",
            ),
        ).rejects.toMatchObject({ code: "journal_network_missing", retryable: false });
        expect(getParsedTransaction).not.toHaveBeenCalled();
        expect(sendRawTransaction).not.toHaveBeenCalled();
    });
});
