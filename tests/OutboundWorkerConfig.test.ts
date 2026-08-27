import { Keypair } from "@solana/web3.js";
import { loadOutboundWorkerConfig } from "../src/config/outboundWorkerConfig.js";

function environment(): NodeJS.ProcessEnv {
    return {
        DIGISAKA_API_BASE: "https://api.example.test/api",
        DIGISAKA_BRIDGE_TOKEN: "test-token-that-is-long-enough",
        SOLANA_RPC_URL: "https://api.devnet.solana.com",
        SOLANA_CLUSTER: "devnet",
        SOLANA_FEE_PAYER_SECRET_KEY: JSON.stringify(Array.from(Keypair.generate().secretKey)),
        POLL_INTERVAL_MS: "7000",
        BATCH_LIMIT: "8",
    };
}

describe("loadOutboundWorkerConfig", () => {
    it("supports the established deployment variable names", () => {
        const config = loadOutboundWorkerConfig(environment());
        expect(config.laravelBaseUrl.toString()).toBe("https://api.example.test/api");
        expect(config.solanaNetwork).toBe("devnet");
        expect(config.pollIntervalMs).toBe(7000);
        expect(config.batchSize).toBe(8);
        expect(config.reconcileLookback).toBe(100);
        expect(config.reconcileTimeoutMs).toBe(15_000);
        expect(config.rpcTimeoutMs).toBe(10_000);
        expect(config.claimTtlMs).toBe(300_000);
        expect(config.journalPath).toBe("./data/outbound-anchor-journal-devnet.json");
    });

    it("locks mainnet unless cutover is explicitly authorized", () => {
        expect(() =>
            loadOutboundWorkerConfig({ ...environment(), SOLANA_CLUSTER: "mainnet-beta" }),
        ).toThrow("Mainnet is locked");
    });

    it("requires reconciliation to finish within the Laravel claim lease", () => {
        expect(() =>
            loadOutboundWorkerConfig({
                ...environment(),
                OUTBOUND_CLAIM_TTL_MS: "120000",
                OUTBOUND_REQUEST_TIMEOUT_MS: "10000",
                SOLANA_RECONCILE_TIMEOUT_MS: "20000",
                SOLANA_CONFIRM_TIMEOUT_MS: "90000",
            }),
        ).toThrow("must fit below OUTBOUND_CLAIM_TTL_MS");
    });

    it("budgets claim, payload, and callback response bodies inside the lease", () => {
        expect(() =>
            loadOutboundWorkerConfig({
                ...environment(),
                OUTBOUND_CLAIM_TTL_MS: "200000",
            }),
        ).toThrow("must fit below OUTBOUND_CLAIM_TTL_MS");
    });

    it("rejects an unbounded reconciliation history", () => {
        expect(() =>
            loadOutboundWorkerConfig({
                ...environment(),
                SOLANA_RECONCILE_LOOKBACK: "251",
            }),
        ).toThrow("SOLANA_RECONCILE_LOOKBACK must be between 10 and 250");
    });

    it("uses exactly Laravel's worker ID character contract", () => {
        expect(
            loadOutboundWorkerConfig({
                ...environment(),
                OUTBOUND_WORKER_ID: "worker.Host_01:replica-2",
            }).workerId,
        ).toBe("worker.Host_01:replica-2");
        expect(() =>
            loadOutboundWorkerConfig({
                ...environment(),
                OUTBOUND_WORKER_ID: "worker@host",
            }),
        ).toThrow("dot, underscore, colon, or hyphen");
    });
});
