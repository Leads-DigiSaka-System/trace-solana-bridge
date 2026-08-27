import dotenv from "dotenv";
import { pathToFileURL } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadOutboundWorkerConfig } from "./config/outboundWorkerConfig.js";
import type { SolanaNetwork } from "./config/outboundWorkerConfig.js";
import { AnchorJournal } from "./services/AnchorJournal.js";
import { LaravelOutboundClient } from "./services/LaravelOutboundClient.js";
import {
    SolanaAnchorError,
    SolanaMemoAnchorService,
} from "./services/SolanaMemoAnchorService.js";
import { classifyWorkerError } from "./worker/errors.js";
import { buildAnchorMemo, parseAnchorMemoIdentity } from "./worker/memo.js";
import type { AnchorReceipt, OutboundItem } from "./worker/types.js";
import type { FailureDetails } from "./worker/types.js";

dotenv.config();

function log(level: "info" | "warn" | "error", event: string, fields: object = {}): void {
    const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...fields,
    });
    if (level === "error") console.error(entry);
    else if (level === "warn") console.warn(entry);
    else console.log(entry);
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
        const timeout = setTimeout(done, milliseconds);
        const onAbort = () => done();
        function done(): void {
            clearTimeout(timeout);
            signal.removeEventListener("abort", onAbort);
            resolve();
        }
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

export async function confirmAndCleanupJournal(
    laravel: Pick<LaravelOutboundClient, "confirm">,
    journal: Pick<AnchorJournal, "delete">,
    memo: string,
    input: Parameters<LaravelOutboundClient["confirm"]>[0],
    signal?: AbortSignal,
): Promise<void> {
    // A missing callback response is ambiguous: Laravel may have committed the
    // confirmation. Retry once so a committed-but-response-lost callback can
    // take Laravel's idempotent path before the journal is left for startup.
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            await laravel.confirm(input, signal);
            lastError = undefined;
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError !== undefined) throw lastError;
    try {
        await journal.delete(memo);
    } catch (error) {
        log("warn", "journal_cleanup_failed", {
            message: error instanceof Error ? error.message : "Could not remove journal record",
        });
    }
}

export async function reconcileFinalizedJournalCallbacks(
    laravel: Pick<LaravelOutboundClient, "confirm">,
    journal: Pick<AnchorJournal, "entries" | "delete">,
    workerId: string,
    currentNetwork: SolanaNetwork,
    signal?: AbortSignal,
): Promise<{ confirmed: number; retained: number }> {
    let confirmed = 0;
    let retained = 0;

    for (const record of journal.entries()) {
        if (record.network !== currentNetwork) {
            retained += 1;
            continue;
        }
        const identity = parseAnchorMemoIdentity(record.memo);
        if (
            !identity ||
            !record.finalized_at ||
            !Number.isSafeInteger(record.slot) ||
            Number(record.slot) <= 0 ||
            !isCanonicalSolanaAddress(record.anchor_address)
        ) {
            retained += 1;
            continue;
        }

        try {
            await confirmAndCleanupJournal(
                laravel,
                journal,
                record.memo,
                {
                    id: identity.outboundId,
                    workerId,
                    payloadHash: identity.payloadHash,
                    signature: record.signature,
                    slot: Number(record.slot),
                    anchorAddress: record.anchor_address,
                    anchoredAt: record.finalized_at,
                },
                signal,
            );
            confirmed += 1;
        } catch (error) {
            retained += 1;
            const failure = classifyWorkerError(error);
            log("warn", "finalized_journal_callback_retained", {
                outbound_id: identity.outboundId,
                signature: record.signature,
                error_code: failure.code,
                message: failure.message,
            });
        }
    }

    return { confirmed, retained };
}

function isCanonicalSolanaAddress(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try {
        return new PublicKey(value).toBase58() === value;
    } catch {
        return false;
    }
}

export function assertFreshSubmissionAllowed(item: OutboundItem): void {
    if (!item.recovery_only) return;

    throw new SolanaAnchorError(
        "recovery_proof_not_found",
        "Recovery-only claim has no journaled or finalized Solana transaction; refusing a fresh broadcast",
        false,
    );
}

export function tripFundingCircuitIfNeeded(failure: FailureDetails): void {
    if (failure.code !== "insufficient_funds") return;

    throw new SolanaAnchorError(
        "fee_payer_funding_circuit_open",
        "Fee payer funding circuit opened; stopping before any additional claims",
        false,
    );
}

export async function runOutboundWorker(): Promise<void> {
    const config = loadOutboundWorkerConfig();
    const shutdown = new AbortController();
    let stopRequested = false;
    const requestStop = (signal: string) => {
        if (stopRequested) return;
        stopRequested = true;
        log("info", "shutdown_requested", { signal });
        shutdown.abort(new Error(`received ${signal}`));
    };
    process.once("SIGINT", () => requestStop("SIGINT"));
    process.once("SIGTERM", () => requestStop("SIGTERM"));

    const laravel = new LaravelOutboundClient({
        baseUrl: config.laravelBaseUrl,
        payloadOrigins: config.laravelPayloadOrigins,
        token: config.laravelApiToken,
        timeoutMs: config.requestTimeoutMs,
        claimTtlMs: config.claimTtlMs,
        expectedNetwork: config.solanaNetwork,
    });
    const solana = new SolanaMemoAnchorService({
        connection: new Connection(config.solanaRpcUrl, {
            commitment: "finalized",
            confirmTransactionInitialTimeout: config.confirmTimeoutMs,
            disableRetryOnRateLimit: false,
        }),
        feePayer: config.feePayer,
        network: config.solanaNetwork,
        rpcTimeoutMs: config.rpcTimeoutMs,
        confirmTimeoutMs: config.confirmTimeoutMs,
        sendMaxRetries: config.sendMaxRetries,
        reconcileLookback: config.reconcileLookback,
        reconcileTimeoutMs: config.reconcileTimeoutMs,
    });
    const journal = new AnchorJournal(config.journalPath);
    await journal.acquireOwnership();
    try {
        await journal.load();

    const health = await solana.assertHealthy();
    const callbackRecovery = await reconcileFinalizedJournalCallbacks(
        laravel,
        journal,
        config.workerId,
        config.solanaNetwork,
        shutdown.signal,
    );
    log("info", "worker_started", {
        worker_id: config.workerId,
        network: config.solanaNetwork,
        fee_payer: solana.anchorAddress,
        balance_lamports: health.balanceLamports,
        batch_size: config.batchSize,
        poll_interval_ms: config.pollIntervalMs,
        finalized_callbacks_recovered: callbackRecovery.confirmed,
        journal_records_retained: callbackRecovery.retained,
    });

    while (!stopRequested) {
        try {
            const batch = await laravel.pending(config.batchSize, shutdown.signal);
            for (const rejected of batch.rejected) {
                log("warn", "pending_item_rejected", {
                    outbound_id: rejected.id,
                    item_index: rejected.index,
                    message: rejected.message,
                    retry: rejected.retryable,
                });
                if (rejected.id === null || stopRequested) continue;
                try {
                    const claimed = await laravel.claimRejected(
                        rejected.id,
                        config.workerId,
                        shutdown.signal,
                    );
                    if (!claimed) continue;
                    await laravel.fail(
                        {
                            id: rejected.id,
                            workerId: config.workerId,
                            code: "invalid_outbound_item",
                            message: rejected.message,
                            retry: rejected.retryable,
                        },
                        shutdown.signal,
                    );
                } catch (error) {
                    const failure = classifyWorkerError(error);
                    log("error", "pending_item_rejection_failed", {
                        outbound_id: rejected.id,
                        error_code: failure.code,
                        message: failure.message,
                        retry: failure.retry,
                    });
                    if (!failure.retry) throw error;
                }
            }
            for (const item of batch.items) {
                if (stopRequested) break;
                let claimed: OutboundItem | null;
                try {
                    claimed = await laravel.claim(item, config.workerId, shutdown.signal);
                } catch (error) {
                    const failure = classifyWorkerError(error);
                    log("error", "item_claim_failed", {
                        outbound_id: item.id,
                        error_code: failure.code,
                        message: failure.message,
                        retry: failure.retry,
                    });
                    if (!failure.retry) throw error;
                    continue;
                }
                if (!claimed) continue;
                await processItem(claimed);
            }
            if (!stopRequested) await abortableDelay(config.pollIntervalMs, shutdown.signal);
        } catch (error) {
            if (stopRequested) break;
            const failure = classifyWorkerError(error);
            log("error", "poll_failed", {
                error_code: failure.code,
                message: failure.message,
                retry: failure.retry,
            });
            if (!failure.retry) throw error;
            await abortableDelay(config.pollIntervalMs, shutdown.signal);
        }
    }

    log("info", "worker_stopped", { worker_id: config.workerId });

    async function processItem(item: OutboundItem): Promise<void> {
        let receipt: AnchorReceipt | null = null;
        try {
            await laravel.fetchAndVerifyPayload(item, shutdown.signal);
            const memo = buildAnchorMemo(item);

            const journalRecord = journal.get(memo);
            if (journalRecord) {
                receipt = await solana.recoverJournaled(journalRecord, memo);
            }
            if (!receipt) receipt = await solana.findFinalizedByMemo(memo);
            if (!receipt) assertFreshSubmissionAllowed(item);
            if (!receipt) {
                receipt = await solana.submitAndFinalize(memo, async (prepared) => {
                    await journal.set({
                        ...prepared,
                        memo,
                        slot: null,
                        finalized_at: null,
                    });
                });
            }

            const persisted = journal.get(memo);
            await journal.set({
                ...(persisted ?? {}),
                network: config.solanaNetwork,
                memo,
                signature: receipt.signature,
                slot: receipt.slot,
                finalized_at: new Date().toISOString(),
                anchor_address: solana.anchorAddress,
            });
            await confirmAndCleanupJournal(
                laravel,
                journal,
                memo,
                {
                    id: item.id,
                    workerId: config.workerId,
                    payloadHash: item.payload_hash,
                    signature: receipt.signature,
                    slot: receipt.slot,
                    anchorAddress: solana.anchorAddress,
                    anchoredAt: new Date().toISOString(),
                },
                shutdown.signal,
            );
            log("info", "anchor_confirmed", {
                outbound_id: item.id,
                domain: item.domain,
                signature: receipt.signature,
                slot: receipt.slot,
                source: receipt.source,
            });
        } catch (error) {
            if (stopRequested) return;
            const failure = classifyWorkerError(error);
            if (receipt) {
                failure.code = "confirmation_callback_failed";
                failure.message = `Finalized Solana anchor ${receipt.signature} awaits Laravel confirmation`;
                failure.retry = true;
            }
            log("error", "anchor_failed", {
                outbound_id: item.id,
                domain: item.domain,
                error_code: failure.code,
                message: failure.message,
                retry: failure.retry,
                signature: receipt?.signature,
            });
            try {
                await laravel.fail(
                    {
                        id: item.id,
                        workerId: config.workerId,
                        code: failure.code,
                        message: failure.message,
                        retry: failure.retry,
                    },
                    shutdown.signal,
                );
            } catch (callbackError) {
                const callbackFailure = classifyWorkerError(callbackError);
                log("error", "failure_callback_failed", {
                    outbound_id: item.id,
                    error_code: callbackFailure.code,
                    message: callbackFailure.message,
                });
            }
            // The current row has been reported retryable (or the callback was
            // attempted). Stop the whole worker before the surrounding batch
            // can claim another row; restart health will block until funded.
            tripFundingCircuitIfNeeded(failure);
        }
    }
    } finally {
        try {
            await journal.releaseOwnership();
        } catch (error) {
            log("error", "journal_ownership_release_failed", {
                message: error instanceof Error ? error.message : "Could not release journal lock",
            });
        }
    }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
    runOutboundWorker().catch((error) => {
        const failure = classifyWorkerError(error);
        log("error", "worker_fatal", {
            error_code: failure.code,
            message: failure.message,
        });
        process.exitCode = 1;
    });
}
