import crypto from "node:crypto";
import { jest } from "@jest/globals";
import {
    LaravelApiError,
    LaravelOutboundClient,
} from "../src/services/LaravelOutboundClient.js";
import type { OutboundItem } from "../src/worker/types.js";

const body = Buffer.from('{"id":41,"status":"approved"}', "utf8");
const hash = crypto.createHash("sha256").update(body).digest("hex");
const item: OutboundItem = {
    id: 41,
    domain: "buyback.application",
    subject_id: 72,
    version: 2,
    previous_hash: null,
    payload_hash: hash,
    memo_format: "v2",
    memo_hash: "c".repeat(64),
    payload_uri: "https://api.example.test/api/outbound/blockchain/payload/41",
    recovery_only: false,
    created_at: null,
};

function client(fetchImpl: typeof fetch, timeoutMs = 2_000): LaravelOutboundClient {
    return new LaravelOutboundClient({
        baseUrl: new URL("https://api.example.test/api"),
        payloadOrigins: new Set(["https://api.example.test"]),
        token: "test-token-that-is-long-enough",
        timeoutMs,
        claimTtlMs: 300_000,
        expectedNetwork: "devnet",
        fetchImpl,
    });
}

describe("LaravelOutboundClient", () => {
    it("unwraps Laravel data and claims exactly one row", async () => {
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        success: true,
                        data: {
                            items: [item],
                            next_cursor: 41,
                            network: "devnet",
                            claim_ttl_ms: 300_000,
                        },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        success: true,
                        data: {
                            claimed_count: 1,
                            claimed: [item],
                            claim_ttl_ms: 300_000,
                        },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                ),
            ) as unknown as typeof fetch;

        const api = client(fetchMock);
        await expect(api.pending(10)).resolves.toEqual({ items: [item], rejected: [] });
        await expect(api.claim(item, "worker-1")).resolves.toEqual(item);

        const firstCall = (fetchMock as unknown as jest.Mock).mock.calls[0] as [URL, RequestInit];
        expect((firstCall[1].headers as Record<string, string>).authorization).toBe(
            "Bearer test-token-that-is-long-enough",
        );
        const secondCall = (fetchMock as unknown as jest.Mock).mock.calls[1] as [URL, RequestInit];
        expect(JSON.parse(String(secondCall[1].body))).toEqual({ ids: [41], worker_id: "worker-1" });
    });

    it("returns valid rows even when another pending item is malformed", async () => {
        const malformed = {
            ...item,
            id: 42,
            payload_hash: "not-a-sha256",
            recovery_only: "not-a-boolean",
        };
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    success: true,
                    data: {
                        items: [malformed, item],
                        network: "devnet",
                        claim_ttl_ms: 300_000,
                    },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
        ) as unknown as typeof fetch;

        await expect(client(fetchMock).pending(10)).resolves.toEqual({
            items: [item],
            rejected: [
                expect.objectContaining({
                    id: 42,
                    index: 0,
                    retryable: false,
                }),
            ],
        });
    });

    it("claims and terminally fails an isolated malformed row without reparsing it", async () => {
        const malformed = {
            ...item,
            id: 42,
            payload_hash: "not-a-sha256",
            recovery_only: "not-a-boolean",
        };
        const fetchMock = jest
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        success: true,
                        data: {
                            items: [malformed],
                            network: "devnet",
                            claim_ttl_ms: 300_000,
                        },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        success: true,
                        data: {
                            claimed_count: 1,
                            claimed: [malformed],
                            claim_ttl_ms: 300_000,
                        },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ success: true, data: { status: "failed" } }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            ) as unknown as typeof fetch;
        const api = client(fetchMock);

        const batch = await api.pending(10);
        expect(batch.items).toEqual([]);
        expect(batch.rejected).toEqual([
            expect.objectContaining({ id: 42, retryable: false }),
        ]);
        await expect(api.claimRejected(42, "worker-rejected")).resolves.toBe(true);
        await expect(
            api.fail({
                id: 42,
                workerId: "worker-rejected",
                code: "invalid_outbound_item",
                message: batch.rejected[0]?.message ?? "malformed",
                retry: false,
            }),
        ).resolves.toBeUndefined();
        const failCall = (fetchMock as unknown as jest.Mock).mock.calls[2] as [URL, RequestInit];
        expect(JSON.parse(String(failCall[1].body))).toEqual(
            expect.objectContaining({ id: 42, retry: false, error_code: "invalid_outbound_item" }),
        );
    });

    it("requires the fail-closed recovery-only flag on every queue row", async () => {
        const missingFlag = { ...item } as Record<string, unknown>;
        delete missingFlag.recovery_only;
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    success: true,
                    data: {
                        items: [missingFlag],
                        network: "devnet",
                        claim_ttl_ms: 300_000,
                    },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
        ) as unknown as typeof fetch;

        await expect(client(fetchMock).pending(10)).resolves.toEqual({
            items: [],
            rejected: [expect.objectContaining({ id: 41, retryable: true })],
        });
    });

    it("fails closed when Laravel and the worker target different Solana networks", async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    success: true,
                    data: { items: [], network: "mainnet", claim_ttl_ms: 300_000 },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
        ) as unknown as typeof fetch;

        await expect(client(fetchMock).pending(10)).rejects.toMatchObject<Partial<LaravelApiError>>({
            status: 409,
            retryable: false,
        });
    });

    it.each([
        ["missing", undefined],
        ["mismatched", 299_000],
    ])("rejects a %s Laravel claim TTL contract", async (_label, claimTtlMs) => {
        const data: Record<string, unknown> = { items: [], network: "devnet" };
        if (claimTtlMs !== undefined) data.claim_ttl_ms = claimTtlMs;
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({ success: true, data }), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        ) as unknown as typeof fetch;

        await expect(client(fetchMock).pending(10)).rejects.toMatchObject({
            status: 409,
            retryable: false,
        });
    });

    it("uses the claimed row's recovery-only flag after a pending/claim race", async () => {
        const claimed = { ...item, recovery_only: true };
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    success: true,
                    data: { claimed_count: 1, claimed: [claimed], claim_ttl_ms: 300_000 },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
        ) as unknown as typeof fetch;

        await expect(client(fetchMock).claim(item, "worker-race")).resolves.toEqual(claimed);
    });

    it("fails closed when a claimed row changes immutable pending data", async () => {
        const claimed = { ...item, payload_hash: "d".repeat(64) };
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    success: true,
                    data: { claimed_count: 1, claimed: [claimed], claim_ttl_ms: 300_000 },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
        ) as unknown as typeof fetch;

        await expect(client(fetchMock).claim(item, "worker-race")).rejects.toMatchObject({
            status: 409,
            retryable: false,
        });
    });

    it("fails closed on a malformed claimed row", async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    success: true,
                    data: {
                        claimed_count: 1,
                        claimed: [{ id: item.id }],
                        claim_ttl_ms: 300_000,
                    },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
        ) as unknown as typeof fetch;

        await expect(client(fetchMock).claim(item, "worker-race")).rejects.toMatchObject({
            status: 502,
            retryable: false,
        });
    });

    it("hashes the raw payload and sends bearer auth only to its trusted origin", async () => {
        const fetchMock = jest.fn(async (_url: URL, init?: RequestInit) => {
            expect((init?.headers as Record<string, string>).authorization).toBe(
                "Bearer test-token-that-is-long-enough",
            );
            return new Response(body, {
                status: 200,
                headers: {
                    "x-payload-hash": hash,
                    "x-previous-hash": "",
                    "x-domain": item.domain,
                    "x-version": String(item.version),
                    "x-solana-network": "devnet",
                },
            });
        }) as unknown as typeof fetch;
        await expect(client(fetchMock).fetchAndVerifyPayload(item)).resolves.toBeUndefined();
    });

    it("rejects a canonical payload bound to another Solana network", async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(body, {
                status: 200,
                headers: {
                    "x-payload-hash": hash,
                    "x-previous-hash": "",
                    "x-domain": item.domain,
                    "x-version": String(item.version),
                    "x-solana-network": "mainnet-beta",
                },
            }),
        ) as unknown as typeof fetch;

        await expect(client(fetchMock).fetchAndVerifyPayload(item)).rejects.toMatchObject({
            status: 422,
            retryable: false,
        });
    });

    it("rejects payload metadata whose previous hash drifts from the pending row", async () => {
        const chainedItem = { ...item, previous_hash: "a".repeat(64) };
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(body, {
                status: 200,
                headers: {
                    "x-payload-hash": hash,
                    "x-previous-hash": "b".repeat(64),
                    "x-domain": item.domain,
                    "x-version": String(item.version),
                    "x-solana-network": "devnet",
                },
            }),
        ) as unknown as typeof fetch;

        await expect(client(fetchMock).fetchAndVerifyPayload(chainedItem)).rejects.toMatchObject({
            status: 422,
            retryable: false,
        });
    });

    it("refuses an arbitrary payload URI before sending the bearer token", async () => {
        const fetchMock = jest.fn() as unknown as typeof fetch;
        const request = client(fetchMock).fetchAndVerifyPayload({
            ...item,
            payload_uri: "https://attacker.example/api/outbound/blockchain/payload/41",
        });
        await expect(request).rejects.toMatchObject<Partial<LaravelApiError>>({ retryable: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps the claim deadline active while the JSON body is stalled", async () => {
        jest.useFakeTimers();
        try {
            let requestSignal: AbortSignal | undefined;
            let cancelled = false;
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('{"success":true,"data":'));
                },
                cancel() {
                    cancelled = true;
                },
            });
            const fetchMock = jest.fn(async (_url: URL, init?: RequestInit) => {
                requestSignal = init?.signal as AbortSignal;
                return new Response(stream, {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            }) as unknown as typeof fetch;

            const request = client(fetchMock, 50).claim(item, "worker-stalled");
            const expectation = expect(request).rejects.toMatchObject({ status: 0, retryable: true });
            await jest.advanceTimersByTimeAsync(51);
            await expectation;
            expect(requestSignal?.aborted).toBe(true);
            expect(cancelled).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it("keeps the request deadline active while the canonical payload body is stalled", async () => {
        jest.useFakeTimers();
        try {
            let requestSignal: AbortSignal | undefined;
            let cancelled = false;
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('{"partial":'));
                },
                cancel() {
                    cancelled = true;
                },
            });
            const fetchMock = jest.fn(async (_url: URL, init?: RequestInit) => {
                requestSignal = init?.signal as AbortSignal;
                return new Response(stream, {
                    status: 200,
                    headers: {
                        "x-payload-hash": hash,
                        "x-previous-hash": "",
                        "x-domain": item.domain,
                        "x-version": String(item.version),
                        "x-solana-network": "devnet",
                    },
                });
            }) as unknown as typeof fetch;

            const request = client(fetchMock, 50).fetchAndVerifyPayload(item);
            const expectation = expect(request).rejects.toMatchObject({ status: 0, retryable: true });
            await jest.advanceTimersByTimeAsync(51);
            await expectation;
            expect(requestSignal?.aborted).toBe(true);
            expect(cancelled).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it("enforces the canonical payload cap while streaming", async () => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(1_100_000));
                controller.enqueue(new Uint8Array(1_100_000));
                controller.close();
            },
        });
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(stream, {
                status: 200,
                headers: {
                    "x-payload-hash": hash,
                    "x-previous-hash": "",
                    "x-domain": item.domain,
                    "x-version": String(item.version),
                    "x-solana-network": "devnet",
                },
            }),
        ) as unknown as typeof fetch;

        await expect(client(fetchMock).fetchAndVerifyPayload(item)).rejects.toMatchObject({
            status: 422,
            retryable: false,
        });
    });

    it("posts the ownership and finalized proof fields on confirm", async () => {
        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({ success: true, data: { status: "anchored" } }), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        ) as unknown as typeof fetch;
        await client(fetchMock).confirm({
            id: 41,
            workerId: "worker-1",
            payloadHash: hash,
            signature: "signature",
            slot: 123,
            anchorAddress: "fee-payer",
            anchoredAt: "2026-08-27T00:00:00.000Z",
        });
        const call = (fetchMock as unknown as jest.Mock).mock.calls[0] as [URL, RequestInit];
        expect(JSON.parse(String(call[1].body))).toEqual(
            expect.objectContaining({
                id: 41,
                worker_id: "worker-1",
                payload_hash: hash,
                commitment: "finalized",
                network: "devnet",
                tx_signature: "signature",
                slot: 123,
            }),
        );
    });
});
