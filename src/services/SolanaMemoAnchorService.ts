import {
    Connection,
    PublicKey,
    Transaction,
    TransactionInstruction,
    type Keypair,
    type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import type {
    AnchorReceipt,
    JournalRecord,
    PreparedAnchor,
} from "../worker/types.js";
import type { SolanaNetwork } from "../config/outboundWorkerConfig.js";

export const MEMO_PROGRAM_ID = new PublicKey(
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

const GENESIS_HASHES: Readonly<Record<SolanaNetwork, string>> = {
    devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const RECONCILE_BATCH_SIZE = 25;

function encodeBase58(bytes: Uint8Array): string {
    if (bytes.length === 0) return "";
    const digits = [0];
    for (const byte of bytes) {
        let carry = byte;
        for (let index = 0; index < digits.length; index += 1) {
            const value = (digits[index] ?? 0) * 256 + carry;
            digits[index] = value % 58;
            carry = Math.floor(value / 58);
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
        }
    }

    let encoded = "";
    for (let index = 0; index < bytes.length - 1 && bytes[index] === 0; index += 1) {
        encoded += BASE58_ALPHABET[0];
    }
    for (let index = digits.length - 1; index >= 0; index -= 1) {
        encoded += BASE58_ALPHABET[digits[index] ?? 0];
    }
    return encoded;
}

export class SolanaAnchorError extends Error {
    public readonly code: string;
    public readonly retryable: boolean;
    public readonly signature?: string;

    constructor(code: string, message: string, retryable: boolean, signature?: string) {
        super(message);
        this.name = "SolanaAnchorError";
        this.code = code;
        this.retryable = retryable;
        if (signature !== undefined) this.signature = signature;
    }
}

interface ServiceOptions {
    connection: Connection;
    feePayer: Keypair;
    network: SolanaNetwork;
    rpcTimeoutMs: number;
    confirmTimeoutMs: number;
    sendMaxRetries: number;
    reconcileLookback: number;
    reconcileTimeoutMs: number;
}

export class SolanaMemoAnchorService {
    public readonly anchorAddress: string;
    private readonly connection: Connection;
    private readonly feePayer: Keypair;
    private readonly network: SolanaNetwork;
    private readonly rpcTimeoutMs: number;
    private readonly confirmTimeoutMs: number;
    private readonly sendMaxRetries: number;
    private readonly reconcileLookback: number;
    private readonly reconcileTimeoutMs: number;

    constructor(options: ServiceOptions) {
        this.connection = options.connection;
        this.feePayer = options.feePayer;
        this.network = options.network;
        this.rpcTimeoutMs = options.rpcTimeoutMs;
        this.confirmTimeoutMs = options.confirmTimeoutMs;
        this.sendMaxRetries = options.sendMaxRetries;
        this.reconcileLookback = options.reconcileLookback;
        this.reconcileTimeoutMs = options.reconcileTimeoutMs;
        this.anchorAddress = options.feePayer.publicKey.toBase58();
    }

    async assertHealthy(): Promise<{ balanceLamports: number; genesisHash: string }> {
        const [genesisHash, memoAccount, balance] = await this.withRpcTimeout(
            Promise.all([
                this.connection.getGenesisHash(),
                this.connection.getAccountInfo(MEMO_PROGRAM_ID, "finalized"),
                this.connection.getBalance(this.feePayer.publicKey, "finalized"),
            ]),
            "Solana health check",
        );
        if (genesisHash !== GENESIS_HASHES[this.network]) {
            throw new SolanaAnchorError(
                "network_mismatch",
                `RPC genesis hash does not match configured ${this.network}`,
                false,
            );
        }
        if (!memoAccount?.executable) {
            throw new SolanaAnchorError(
                "memo_program_unavailable",
                "Solana Memo program is not executable on the configured RPC",
                true,
            );
        }
        if (balance < 5_000) {
            throw new SolanaAnchorError(
                "insufficient_funds",
                "Fee payer balance is too low to submit an anchor",
                false,
            );
        }
        return { balanceLamports: balance, genesisHash };
    }

    async findFinalizedByMemo(memo: string): Promise<AnchorReceipt | null> {
        return this.withTimeout(
            this.findFinalizedByMemoWithinBound(memo),
            this.reconcileTimeoutMs,
            () =>
                new SolanaAnchorError(
                    "reconciliation_timeout",
                    `Solana reconciliation exceeded ${this.reconcileTimeoutMs}ms`,
                    true,
                ),
        );
    }

    async verifyFinalizedSignature(signature: string, memo: string): Promise<AnchorReceipt | null> {
        const receipt = await this.inspectFinalizedSignature(signature, memo, "journal");
        if (!receipt) {
            throw new SolanaAnchorError(
                "finalized_transaction_unavailable",
                "Finalized transaction details are temporarily unavailable from the RPC",
                true,
                signature,
            );
        }
        return receipt;
    }

    async recoverJournaled(record: JournalRecord, memo: string): Promise<AnchorReceipt | null> {
        if (record.network === undefined) {
            throw new SolanaAnchorError(
                "journal_network_missing",
                "Legacy journal record has no Solana network provenance and cannot be replayed",
                false,
                record.signature,
            );
        }
        if (record.network !== this.network) {
            throw new SolanaAnchorError(
                "journal_network_mismatch",
                `Journal record targets Solana ${record.network}, not configured ${this.network}`,
                false,
                record.signature,
            );
        }

        const receipt = await this.inspectFinalizedSignature(record.signature, memo, "journal");
        if (receipt) return receipt;

        const prepared = this.preparedFromJournal(record);
        if (!prepared) {
            throw new SolanaAnchorError(
                "journal_transaction_unavailable",
                "Journaled signature is not yet readable and has no signed transaction to resend",
                true,
                record.signature,
            );
        }

        const [statusResponse, finalizedBlockHeight] = await this.withRpcTimeout(
            Promise.all([
                this.connection.getSignatureStatuses([record.signature], {
                    searchTransactionHistory: true,
                }),
                this.connection.getBlockHeight("finalized"),
            ]),
            "Solana journal status lookup",
            record.signature,
        );
        const status = statusResponse.value[0];

        // A freshly signed transaction may have been journaled immediately
        // before a crash and never broadcast. Only full-history absence plus
        // objective blockhash expiry proves that those signed bytes can no
        // longer land. The worker will still run bounded memo reconciliation
        // before it prepares a replacement transaction.
        if (status === null && finalizedBlockHeight > prepared.last_valid_block_height) {
            return null;
        }

        // Any observed status, or an unexpired blockhash, retains the original
        // deterministic signature. Resending identical bytes is idempotent.
        return this.finalizePrepared(prepared, memo, "journal");
    }

    async submitAndFinalize(
        memo: string,
        onPrepared: (prepared: PreparedAnchor) => Promise<void>,
    ): Promise<AnchorReceipt> {
        const latest = await this.withRpcTimeout(
            this.connection.getLatestBlockhash("finalized"),
            "Solana latest blockhash lookup",
        );
        const transaction = new Transaction({
            feePayer: this.feePayer.publicKey,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
        }).add(
            new TransactionInstruction({
                programId: MEMO_PROGRAM_ID,
                keys: [],
                data: Buffer.from(memo, "utf8"),
            }),
        );
        transaction.sign(this.feePayer);
        const signatureBytes = transaction.signatures.find((candidate) =>
            candidate.publicKey.equals(this.feePayer.publicKey),
        )?.signature;
        if (!signatureBytes) {
            throw new SolanaAnchorError(
                "transaction_signing_failed",
                "Signed transaction did not contain the fee-payer signature",
                false,
            );
        }
        const prepared: PreparedAnchor = {
            network: this.network,
            signature: encodeBase58(signatureBytes),
            raw_transaction_base64: transaction.serialize().toString("base64"),
            blockhash: latest.blockhash,
            last_valid_block_height: latest.lastValidBlockHeight,
            submitted_at: new Date().toISOString(),
        };

        // Persistence happens before the first broadcast. A retry can only
        // resend these identical signed bytes and therefore cannot create a
        // second transaction signature for the same outbound memo.
        await onPrepared(prepared);
        return this.finalizePrepared(prepared, memo, "submitted");
    }

    private async findFinalizedByMemoWithinBound(memo: string): Promise<AnchorReceipt | null> {
        const entries = (
            await this.connection.getSignaturesForAddress(
                this.feePayer.publicKey,
                { limit: this.reconcileLookback },
                "finalized",
            )
        )
            .slice(0, this.reconcileLookback)
            .filter((entry) => entry.err === null);

        // Summary memos are only a prioritization hint. Exact verification is
        // performed on parsed transactions in bounded batches, including rows
        // from providers that omit or decorate the summary memo.
        const likely = entries.filter((entry) => entry.memo?.includes(memo));
        const likelySignatures = new Set(likely.map((entry) => entry.signature));
        const candidates = [
            ...likely,
            ...entries.filter((entry) => !likelySignatures.has(entry.signature)),
        ];
        let likelyTransactionUnavailable = false;

        for (let offset = 0; offset < candidates.length; offset += RECONCILE_BATCH_SIZE) {
            const batch = candidates.slice(offset, offset + RECONCILE_BATCH_SIZE);
            const transactions = await this.connection.getParsedTransactions(
                batch.map((entry) => entry.signature),
                { commitment: "finalized", maxSupportedTransactionVersion: 0 },
            );
            for (let index = 0; index < batch.length; index += 1) {
                const entry = batch[index];
                const transaction = transactions[index];
                if (!entry) continue;
                if (!transaction) {
                    if (likelySignatures.has(entry.signature)) {
                        likelyTransactionUnavailable = true;
                    }
                    continue;
                }
                if (
                    transaction.meta !== null &&
                    transaction.meta.err === null &&
                    this.isSignedMemo(transaction, memo)
                ) {
                    return {
                        signature: entry.signature,
                        slot: transaction.slot,
                        source: "reconciled",
                    };
                } else if (transaction.meta === null && likelySignatures.has(entry.signature)) {
                    likelyTransactionUnavailable = true;
                }
            }
        }

        if (likelyTransactionUnavailable) {
            throw new SolanaAnchorError(
                "reconciliation_transaction_unavailable",
                "A likely existing memo transaction is temporarily unavailable from the RPC",
                true,
            );
        }
        return null;
    }

    private async inspectFinalizedSignature(
        signature: string,
        memo: string,
        source: AnchorReceipt["source"],
    ): Promise<AnchorReceipt | null> {
        const transaction = await this.withRpcTimeout(
            this.connection.getParsedTransaction(signature, {
                commitment: "finalized",
                maxSupportedTransactionVersion: 0,
            }),
            "Solana parsed transaction lookup",
            signature,
        );
        if (!transaction) return null;
        if (transaction.meta === null) {
            throw new SolanaAnchorError(
                "transaction_metadata_unavailable",
                "Solana transaction execution metadata is temporarily unavailable",
                true,
                signature,
            );
        }
        if (transaction.meta.err !== null) {
            throw new SolanaAnchorError(
                "transaction_failed",
                "Journaled Solana transaction failed",
                false,
                signature,
            );
        }
        if (!this.isSignedMemo(transaction, memo)) {
            throw new SolanaAnchorError(
                "finalized_transaction_mismatch",
                "Finalized transaction did not contain the expected fee-payer-signed memo",
                false,
                signature,
            );
        }
        return { signature, slot: transaction.slot, source };
    }

    private preparedFromJournal(record: JournalRecord): PreparedAnchor | null {
        if (
            !record.raw_transaction_base64 ||
            !record.blockhash ||
            !Number.isSafeInteger(record.last_valid_block_height) ||
            Number(record.last_valid_block_height) <= 0
        ) {
            return null;
        }
        return {
            network: record.network as SolanaNetwork,
            signature: record.signature,
            raw_transaction_base64: record.raw_transaction_base64,
            blockhash: record.blockhash,
            last_valid_block_height: Number(record.last_valid_block_height),
            submitted_at: record.submitted_at ?? new Date().toISOString(),
        };
    }

    private async finalizePrepared(
        prepared: PreparedAnchor,
        memo: string,
        source: AnchorReceipt["source"],
    ): Promise<AnchorReceipt> {
        if (prepared.network !== this.network) {
            throw new SolanaAnchorError(
                "journal_network_mismatch",
                `Prepared transaction targets Solana ${prepared.network}, not configured ${this.network}`,
                false,
                prepared.signature,
            );
        }
        let ambiguousSendError: unknown;

        try {
            try {
                const returnedSignature = await this.withTimeout(
                    this.connection.sendRawTransaction(
                        Buffer.from(prepared.raw_transaction_base64, "base64"),
                        {
                            maxRetries: this.sendMaxRetries,
                            preflightCommitment: "finalized",
                            skipPreflight: false,
                        },
                    ),
                    this.rpcTimeoutMs,
                    () => new Error(`Solana send RPC exceeded ${this.rpcTimeoutMs}ms`),
                );
                if (returnedSignature !== prepared.signature) {
                    throw new SolanaAnchorError(
                        "transaction_signature_mismatch",
                        "RPC returned a signature different from the prepared transaction",
                        false,
                        prepared.signature,
                    );
                }
            } catch (error) {
                if (error instanceof SolanaAnchorError) throw error;
                const message = error instanceof Error ? error.message : "Solana send failed";
                if (message.toLowerCase().includes("insufficient funds")) {
                    throw new SolanaAnchorError(
                        "insufficient_funds",
                        "Fee payer has insufficient funds",
                        true,
                        prepared.signature,
                    );
                }
                // A transport failure can occur after the RPC accepted the
                // transaction, so confirmation of the known signature remains
                // authoritative and safe.
                ambiguousSendError = error;
            }

            const confirmation = await this.withTimeout(
                this.connection.confirmTransaction(
                    {
                        signature: prepared.signature,
                        blockhash: prepared.blockhash,
                        lastValidBlockHeight: prepared.last_valid_block_height,
                    },
                    "finalized",
                ),
                this.confirmTimeoutMs,
                () =>
                    new SolanaAnchorError(
                        "confirmation_timeout",
                        "Timed out waiting for finalized confirmation",
                        true,
                        prepared.signature,
                    ),
            );
            if (confirmation.value.err) {
                throw new SolanaAnchorError(
                    "transaction_failed",
                    "Solana rejected the memo transaction",
                    false,
                    prepared.signature,
                );
            }
            const verified = await this.inspectFinalizedSignature(
                prepared.signature,
                memo,
                source,
            );
            if (!verified) {
                throw new SolanaAnchorError(
                    "finalized_transaction_unavailable",
                    "Transaction finalized, but parsed details are temporarily unavailable from the RPC",
                    true,
                    prepared.signature,
                );
            }
            return verified;
        } catch (error) {
            if (error instanceof SolanaAnchorError) throw error;
            const effectiveError = ambiguousSendError ?? error;
            const message =
                effectiveError instanceof Error ? effectiveError.message : "Solana request failed";
            const normalized = message.toLowerCase();
            const insufficientFunds = normalized.includes("insufficient funds");
            const timedOut = normalized.includes("timed out");
            throw new SolanaAnchorError(
                insufficientFunds ? "insufficient_funds" : timedOut ? "confirmation_timeout" : "solana_rpc_error",
                insufficientFunds
                    ? "Fee payer has insufficient funds"
                    : timedOut
                      ? "Timed out waiting for finalized confirmation"
                      : message.slice(0, 500),
                true,
                prepared.signature,
            );
        }
    }

    private isSignedMemo(transaction: ParsedTransactionWithMeta, memo: string): boolean {
        const feePayerIsSigner = transaction.transaction.message.accountKeys.some(
            (key) => key.signer && key.pubkey.equals(this.feePayer.publicKey),
        );
        if (!feePayerIsSigner) return false;

        return transaction.transaction.message.instructions.some((instruction) => {
            if (!("parsed" in instruction) || !instruction.programId.equals(MEMO_PROGRAM_ID)) {
                return false;
            }
            return instruction.parsed === memo;
        });
    }

    private async withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
        timeoutError: () => Error,
    ): Promise<T> {
        let timeout: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise<T>((_resolve, reject) => {
                    timeout = setTimeout(
                        () => reject(timeoutError()),
                        timeoutMs,
                    );
                }),
            ]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    private withRpcTimeout<T>(
        promise: Promise<T>,
        operation: string,
        signature?: string,
    ): Promise<T> {
        return this.withTimeout(
            promise,
            this.rpcTimeoutMs,
            () =>
                new SolanaAnchorError(
                    "solana_rpc_timeout",
                    `${operation} exceeded ${this.rpcTimeoutMs}ms`,
                    true,
                    signature,
                ),
        );
    }
}
