import crypto from "node:crypto";
import type { SolanaNetwork } from "../config/outboundWorkerConfig.js";
import type { OutboundItem, PendingBatch } from "../worker/types.js";

export class LaravelApiError extends Error {
    public readonly status: number;
    public readonly retryable: boolean;

    constructor(message: string, status: number, retryable: boolean) {
        super(message);
        this.name = "LaravelApiError";
        this.status = status;
        this.retryable = retryable;
    }
}

interface ClientOptions {
    baseUrl: URL;
    payloadOrigins: ReadonlySet<string>;
    token: string;
    timeoutMs: number;
    claimTtlMs: number;
    expectedNetwork: SolanaNetwork;
    fetchImpl?: typeof fetch;
}

interface ConfirmInput {
    id: number;
    workerId: string;
    payloadHash: string;
    signature: string;
    slot: number;
    anchorAddress: string;
    anchoredAt: string;
}

interface FailInput {
    id: number;
    workerId: string;
    code: string;
    message: string;
    retry: boolean;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRetryableStatus(status: number): boolean {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function apiMessage(body: unknown, fallback: string): string {
    if (isObject(body) && typeof body.message === "string" && body.message.trim()) {
        return body.message.trim().slice(0, 300);
    }
    return fallback;
}

function normalizeNetwork(value: unknown): unknown {
    return value === "mainnet-beta" ? "mainnet" : value;
}

const JSON_BODY_LIMIT = 1024 * 1024;
const CANONICAL_PAYLOAD_LIMIT = 2 * 1024 * 1024;

export class LaravelOutboundClient {
    private readonly baseUrl: URL;
    private readonly payloadOrigins: ReadonlySet<string>;
    private readonly token: string;
    private readonly timeoutMs: number;
    private readonly claimTtlMs: number;
    private readonly expectedNetwork: SolanaNetwork;
    private readonly fetchImpl: typeof fetch;

    constructor(options: ClientOptions) {
        this.baseUrl = options.baseUrl;
        this.payloadOrigins = options.payloadOrigins;
        this.token = options.token;
        this.timeoutMs = options.timeoutMs;
        this.claimTtlMs = options.claimTtlMs;
        this.expectedNetwork = options.expectedNetwork;
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    async pending(limit: number, signal?: AbortSignal): Promise<PendingBatch> {
        const url = this.endpoint("outbound/blockchain/pending");
        url.searchParams.set("limit", String(limit));
        url.searchParams.set("after_id", "0");
        url.searchParams.set("domain", "buyback.*");
        const body = await this.requestJson(
            url,
            { method: "GET", headers: this.headers() },
            signal,
        );
        const data = this.unwrapData(body);
        if (!isObject(data) || !Array.isArray(data.items)) {
            throw new LaravelApiError("Pending response did not contain data.items", 502, true);
        }
        const reportedNetwork = normalizeNetwork(data.network);
        if (reportedNetwork !== this.expectedNetwork) {
            throw new LaravelApiError(
                `Laravel expects Solana ${String(data.network || "unknown")}, but this worker is configured for ${this.expectedNetwork}`,
                409,
                false,
            );
        }
        this.assertClaimTtl(data, "Pending");
        const batch: PendingBatch = { items: [], rejected: [] };
        data.items.forEach((item, index) => {
            try {
                batch.items.push(this.parseOutboundItem(item, index));
            } catch (error) {
                const failure =
                    error instanceof LaravelApiError
                        ? error
                        : new LaravelApiError(
                              error instanceof Error ? error.message : "Malformed pending item",
                              502,
                              true,
                          );
                const id =
                    isObject(item) && Number.isSafeInteger(item.id) && Number(item.id) > 0
                        ? Number(item.id)
                        : null;
                batch.rejected.push({
                    id,
                    index,
                    message: failure.message.slice(0, 1_000),
                    retryable: failure.retryable,
                });
            }
        });
        return batch;
    }

    async claim(
        pendingItem: OutboundItem,
        workerId: string,
        signal?: AbortSignal,
    ): Promise<OutboundItem | null> {
        const rawClaimed = await this.claimRaw(pendingItem.id, workerId, signal);
        if (!rawClaimed) return null;

        let claimed: OutboundItem;
        try {
            claimed = this.parseOutboundItem(rawClaimed, 0);
        } catch (error) {
            throw new LaravelApiError(
                `Claim response item is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
                502,
                false,
            );
        }

        const immutableKeys = [
            "id",
            "domain",
            "subject_id",
            "version",
            "previous_hash",
            "payload_hash",
            "payload_uri",
            "created_at",
        ] as const;
        for (const key of immutableKeys) {
            if (claimed[key] !== pendingItem[key]) {
                throw new LaravelApiError(
                    `Claimed item ${pendingItem.id} changed immutable field ${key}`,
                    409,
                    false,
                );
            }
        }
        return claimed;
    }

    async claimRejected(id: number, workerId: string, signal?: AbortSignal): Promise<boolean> {
        return (await this.claimRaw(id, workerId, signal)) !== null;
    }

    private async claimRaw(
        id: number,
        workerId: string,
        signal?: AbortSignal,
    ): Promise<JsonObject | null> {
        const body = await this.requestJson(
            this.endpoint("outbound/blockchain/claim"),
            this.jsonRequest({ ids: [id], worker_id: workerId }),
            signal,
        );
        const data = this.unwrapData(body);
        if (
            !isObject(data) ||
            !Number.isSafeInteger(data.claimed_count) ||
            !Array.isArray(data.claimed)
        ) {
            throw new LaravelApiError(
                "Claim response did not contain a valid claimed_count and claimed array",
                502,
                false,
            );
        }
        this.assertClaimTtl(data, "Claim");
        const count = Number(data.claimed_count);
        if (count === 0 && data.claimed.length === 0) return null;
        if (count !== 1 || data.claimed.length !== 1) {
            throw new LaravelApiError("Claim response cardinality is inconsistent", 502, false);
        }
        const claimed = data.claimed[0];
        if (!isObject(claimed) || !Number.isSafeInteger(claimed.id) || Number(claimed.id) !== id) {
            throw new LaravelApiError(
                `Claim response did not return requested item ${id}`,
                409,
                false,
            );
        }
        return claimed;
    }

    async fetchAndVerifyPayload(item: OutboundItem, signal?: AbortSignal): Promise<void> {
        const url = this.validatedPayloadUrl(item);
        await this.withRequestDeadline(
            url,
            {
                method: "GET",
                headers: this.headers(),
            },
            async (response, requestSignal) => {
                if (!response.ok) {
                    void response.body?.cancel().catch(() => undefined);
                    throw new LaravelApiError(
                        `Payload request failed with HTTP ${response.status}`,
                        response.status,
                        isRetryableStatus(response.status),
                    );
                }
                const bytes = await this.readBoundedBody(
                    response,
                    CANONICAL_PAYLOAD_LIMIT,
                    requestSignal,
                    () =>
                        new LaravelApiError(
                            "Canonical payload exceeds the 2 MiB safety limit",
                            422,
                            false,
                        ),
                );

                const computed = crypto.createHash("sha256").update(bytes).digest("hex");
                if (!crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(item.payload_hash, "hex"))) {
                    throw new LaravelApiError("Canonical payload SHA-256 does not match payload_hash", 422, false);
                }
                const headerHash = response.headers.get("x-payload-hash")?.toLowerCase();
                if (!headerHash || headerHash !== item.payload_hash.toLowerCase()) {
                    throw new LaravelApiError("Payload response X-Payload-Hash is missing or inconsistent", 422, false);
                }
                const headerDomain = response.headers.get("x-domain");
                const headerVersion = response.headers.get("x-version");
                if (headerDomain !== item.domain || headerVersion !== String(item.version)) {
                    throw new LaravelApiError("Payload response metadata is inconsistent with the queue row", 422, false);
                }
                const headerPreviousHash = response.headers.get("x-previous-hash");
                const expectedPreviousHash = item.previous_hash?.toLowerCase() ?? "";
                if (
                    headerPreviousHash === null ||
                    headerPreviousHash.toLowerCase() !== expectedPreviousHash
                ) {
                    throw new LaravelApiError(
                        "Payload response X-Previous-Hash is missing or inconsistent",
                        422,
                        false,
                    );
                }
                const headerNetwork = normalizeNetwork(response.headers.get("x-solana-network"));
                if (headerNetwork !== this.expectedNetwork) {
                    throw new LaravelApiError(
                        "Payload response Solana network does not match this worker",
                        422,
                        false,
                    );
                }
            },
            signal,
        );
    }

    async confirm(input: ConfirmInput, signal?: AbortSignal): Promise<void> {
        await this.requestJson(
            this.endpoint("outbound/blockchain/confirm"),
            this.jsonRequest({
                id: input.id,
                worker_id: input.workerId,
                payload_hash: input.payloadHash,
                tx_signature: input.signature,
                slot: input.slot,
                anchor_address: input.anchorAddress,
                commitment: "finalized",
                network: this.expectedNetwork,
                anchored_at: input.anchoredAt,
            }),
            signal,
        );
    }

    async fail(input: FailInput, signal?: AbortSignal): Promise<void> {
        await this.requestJson(
            this.endpoint("outbound/blockchain/fail"),
            this.jsonRequest({
                id: input.id,
                worker_id: input.workerId,
                error_code: input.code.slice(0, 60),
                message: input.message.slice(0, 1_000),
                retry: input.retry,
            }),
            signal,
        );
    }

    private endpoint(path: string): URL {
        const base = this.baseUrl.toString().replace(/\/+$/, "");
        return new URL(`${base}/${path.replace(/^\/+/, "")}`);
    }

    private validatedPayloadUrl(item: OutboundItem): URL {
        let url: URL;
        try {
            url = new URL(item.payload_uri, this.baseUrl);
        } catch {
            throw new LaravelApiError("Queue row contains an invalid payload_uri", 422, false);
        }
        if (!this.payloadOrigins.has(url.origin) || url.username || url.password) {
            throw new LaravelApiError("Refusing to send Laravel token to an untrusted payload origin", 422, false);
        }
        const expectedPath = this.endpoint(`outbound/blockchain/payload/${item.id}`).pathname;
        if (url.pathname !== expectedPath || url.search || url.hash) {
            throw new LaravelApiError("Queue row payload_uri does not match the expected payload endpoint", 422, false);
        }
        return url;
    }

    private parseOutboundItem(value: unknown, index: number): OutboundItem {
        if (!isObject(value)) {
            throw new LaravelApiError(`Pending item ${index} is not an object`, 502, true);
        }
        const requiredNumbers = ["id", "subject_id", "version"] as const;
        for (const key of requiredNumbers) {
            if (!Number.isSafeInteger(value[key]) || Number(value[key]) <= 0) {
                throw new LaravelApiError(`Pending item ${index} has an invalid ${key}`, 502, true);
            }
        }
        if (
            typeof value.domain !== "string" ||
            typeof value.payload_hash !== "string" ||
            typeof value.payload_uri !== "string"
        ) {
            throw new LaravelApiError(`Pending item ${index} is missing string fields`, 502, true);
        }
        if (value.previous_hash !== null && typeof value.previous_hash !== "string") {
            throw new LaravelApiError(`Pending item ${index} has an invalid previous_hash`, 502, true);
        }
        if (typeof value.recovery_only !== "boolean") {
            throw new LaravelApiError(
                `Pending item ${index} has an invalid recovery_only flag`,
                502,
                value.recovery_only === undefined,
            );
        }
        if (!/^[a-fA-F0-9]{64}$/.test(value.payload_hash)) {
            throw new LaravelApiError(`Pending item ${index} has an invalid payload_hash`, 502, false);
        }
        if (
            typeof value.previous_hash === "string" &&
            !/^[a-fA-F0-9]{64}$/.test(value.previous_hash)
        ) {
            throw new LaravelApiError(`Pending item ${index} has an invalid previous_hash`, 502, false);
        }
        return {
            id: Number(value.id),
            domain: value.domain,
            subject_id: Number(value.subject_id),
            version: Number(value.version),
            previous_hash:
                typeof value.previous_hash === "string"
                    ? value.previous_hash.toLowerCase()
                    : null,
            payload_hash: value.payload_hash.toLowerCase(),
            payload_uri: value.payload_uri,
            recovery_only: value.recovery_only,
            created_at: typeof value.created_at === "string" ? value.created_at : null,
        };
    }

    private headers(): Record<string, string> {
        return {
            accept: "application/json",
            authorization: `Bearer ${this.token}`,
            "user-agent": "digisaka-solana-outbound-worker/1.0",
        };
    }

    private jsonRequest(body: JsonObject): RequestInit {
        return {
            method: "POST",
            headers: { ...this.headers(), "content-type": "application/json" },
            body: JSON.stringify(body),
        };
    }

    private unwrapData(body: unknown): unknown {
        if (!isObject(body)) return body;
        if (body.success === false) {
            throw new LaravelApiError(apiMessage(body, "Laravel returned an unsuccessful response"), 502, true);
        }
        return Object.prototype.hasOwnProperty.call(body, "data") ? body.data : body;
    }

    private assertClaimTtl(data: JsonObject, context: string): void {
        if (!Number.isSafeInteger(data.claim_ttl_ms) || Number(data.claim_ttl_ms) <= 0) {
            throw new LaravelApiError(
                `${context} response did not contain a valid data.claim_ttl_ms`,
                409,
                false,
            );
        }
        if (Number(data.claim_ttl_ms) !== this.claimTtlMs) {
            throw new LaravelApiError(
                `Laravel claim TTL ${String(data.claim_ttl_ms)}ms does not match worker ${this.claimTtlMs}ms`,
                409,
                false,
            );
        }
    }

    private async requestJson(url: URL, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
        return this.withRequestDeadline(
            url,
            init,
            async (response, requestSignal) => {
                const bytes = await this.readBoundedBody(
                    response,
                    JSON_BODY_LIMIT,
                    requestSignal,
                    () =>
                        new LaravelApiError(
                            "Laravel JSON response exceeds the 1 MiB safety limit",
                            response.status || 502,
                            false,
                        ),
                );
                let body: unknown;
                try {
                    body = JSON.parse(bytes.toString("utf8"));
                } catch {
                    throw new LaravelApiError(
                        `Laravel returned non-JSON HTTP ${response.status}`,
                        response.status || 502,
                        response.status === 0 || isRetryableStatus(response.status),
                    );
                }
                if (!response.ok) {
                    throw new LaravelApiError(
                        apiMessage(body, `Laravel request failed with HTTP ${response.status}`),
                        response.status,
                        isRetryableStatus(response.status),
                    );
                }
                if (isObject(body) && body.success === false) {
                    throw new LaravelApiError(
                        apiMessage(body, "Laravel returned an unsuccessful response"),
                        response.status,
                        false,
                    );
                }
                return body;
            },
            signal,
        );
    }

    private async withRequestDeadline<T>(
        url: URL,
        init: RequestInit,
        consume: (response: Response, signal: AbortSignal) => Promise<T>,
        parentSignal?: AbortSignal,
    ): Promise<T> {
        const timeoutController = new AbortController();
        const timeout = setTimeout(() => timeoutController.abort(new Error("request timeout")), this.timeoutMs);
        const forwardAbort = () => timeoutController.abort(parentSignal?.reason);
        parentSignal?.addEventListener("abort", forwardAbort, { once: true });
        try {
            const response = await this.awaitWithAbort(
                this.fetchImpl(url, { ...init, signal: timeoutController.signal }),
                timeoutController.signal,
            );
            return await consume(response, timeoutController.signal);
        } catch (error) {
            if (parentSignal?.aborted) throw error;
            if (error instanceof LaravelApiError) throw error;
            const message = error instanceof Error ? error.message : "network request failed";
            throw new LaravelApiError(`Laravel network error: ${message}`, 0, true);
        } finally {
            clearTimeout(timeout);
            parentSignal?.removeEventListener("abort", forwardAbort);
        }
    }

    private async readBoundedBody(
        response: Response,
        limit: number,
        signal: AbortSignal,
        limitError: () => LaravelApiError,
    ): Promise<Buffer> {
        const contentLength = response.headers.get("content-length");
        if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > limit) {
            void response.body?.cancel().catch(() => undefined);
            throw limitError();
        }
        if (!response.body) return Buffer.alloc(0);

        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let total = 0;
        let completed = false;
        try {
            while (true) {
                const result = await this.awaitWithAbort(reader.read(), signal);
                if (result.done) {
                    completed = true;
                    break;
                }
                if (!result.value) continue;
                total += result.value.byteLength;
                if (total > limit) throw limitError();
                chunks.push(Buffer.from(result.value));
            }
            return Buffer.concat(chunks, total);
        } finally {
            if (!completed) void reader.cancel().catch(() => undefined);
            else reader.releaseLock();
        }
    }

    private async awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
        if (signal.aborted) throw signal.reason ?? new Error("request aborted");
        return new Promise<T>((resolve, reject) => {
            const onAbort = () => reject(signal.reason ?? new Error("request aborted"));
            signal.addEventListener("abort", onAbort, { once: true });
            promise.then(
                (value) => {
                    signal.removeEventListener("abort", onAbort);
                    resolve(value);
                },
                (error: unknown) => {
                    signal.removeEventListener("abort", onAbort);
                    reject(error);
                },
            );
        });
    }
}
