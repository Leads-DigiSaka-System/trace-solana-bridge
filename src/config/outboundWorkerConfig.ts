import os from "node:os";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";

export type SolanaNetwork = "devnet" | "testnet" | "mainnet";

export interface OutboundWorkerConfig {
    laravelBaseUrl: URL;
    laravelPayloadOrigins: ReadonlySet<string>;
    laravelApiToken: string;
    workerId: string;
    pollIntervalMs: number;
    batchSize: number;
    requestTimeoutMs: number;
    solanaRpcUrl: string;
    solanaNetwork: SolanaNetwork;
    feePayer: Keypair;
    rpcTimeoutMs: number;
    confirmTimeoutMs: number;
    sendMaxRetries: number;
    reconcileLookback: number;
    reconcileTimeoutMs: number;
    claimTtlMs: number;
    journalPath: string;
}

function requireText(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

function requireTextWithAlias(
    env: NodeJS.ProcessEnv,
    primary: string,
    alias: string,
): string {
    const value = env[primary]?.trim() || env[alias]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable ${primary} (or ${alias})`);
    }
    return value;
}

function boundedInteger(
    env: NodeJS.ProcessEnv,
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
): number {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be between ${minimum} and ${maximum}`);
    }
    return value;
}

function boundedIntegerWithAlias(
    env: NodeJS.ProcessEnv,
    primary: string,
    alias: string,
    fallback: number,
    minimum: number,
    maximum: number,
): number {
    const effective = { ...env };
    if (!effective[primary] && effective[alias]) effective[primary] = effective[alias];
    return boundedInteger(effective, primary, fallback, minimum, maximum);
}

function httpUrl(raw: string, name: string, allowHttp: boolean): URL {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`${name} must be a valid absolute URL`);
    }
    if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
        throw new Error(`${name} must use HTTPS (or explicitly allow HTTP for local development)`);
    }
    if (url.username || url.password) {
        throw new Error(`${name} must not contain URL credentials`);
    }
    return url;
}

export function parseFeePayer(raw: string): Keypair {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("SOLANA_FEE_PAYER_SECRET_KEY must be a JSON array");
    }
    if (
        !Array.isArray(parsed) ||
        parsed.length !== 64 ||
        parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
    ) {
        throw new Error("SOLANA_FEE_PAYER_SECRET_KEY must contain exactly 64 byte values");
    }
    try {
        return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
    } catch {
        throw new Error("SOLANA_FEE_PAYER_SECRET_KEY is not a valid Solana keypair");
    }
}

export function loadFeePayerFromEnv(env: NodeJS.ProcessEnv): Keypair {
    const keypairPath = env.SOLANA_KEYPAIR_PATH?.trim();
    if (keypairPath) {
        try {
            return parseFeePayer(readFileSync(keypairPath, "utf8"));
        } catch (error) {
            const message = error instanceof Error ? error.message : "invalid keypair file";
            throw new Error(`Cannot load SOLANA_KEYPAIR_PATH: ${message}`);
        }
    }
    return parseFeePayer(requireText(env, "SOLANA_FEE_PAYER_SECRET_KEY"));
}

export function loadOutboundWorkerConfig(
    env: NodeJS.ProcessEnv = process.env,
): OutboundWorkerConfig {
    const allowHttp = env.ALLOW_INSECURE_LOCAL_HTTP === "true";
    const laravelBaseUrl = httpUrl(
        requireTextWithAlias(env, "LARAVEL_API_BASE_URL", "DIGISAKA_API_BASE"),
        "LARAVEL_API_BASE_URL",
        allowHttp,
    );
    if (laravelBaseUrl.search || laravelBaseUrl.hash) {
        throw new Error("LARAVEL_API_BASE_URL must not contain a query string or fragment");
    }
    laravelBaseUrl.pathname = laravelBaseUrl.pathname.replace(/\/+$/, "");

    const solanaRpc = httpUrl(
        requireText(env, "SOLANA_RPC_URL"),
        "SOLANA_RPC_URL",
        allowHttp,
    );
    const rawNetwork = requireTextWithAlias(env, "SOLANA_NETWORK", "SOLANA_CLUSTER");
    const network = (rawNetwork === "mainnet-beta" ? "mainnet" : rawNetwork) as SolanaNetwork;
    if (!["devnet", "testnet", "mainnet"].includes(network)) {
        throw new Error("SOLANA_NETWORK must be devnet, testnet, or mainnet");
    }
    if (network === "mainnet" && env.ALLOW_SOLANA_MAINNET !== "true") {
        throw new Error("Mainnet is locked; set ALLOW_SOLANA_MAINNET=true only after an approved cutover");
    }

    const token = requireTextWithAlias(env, "LARAVEL_API_TOKEN", "DIGISAKA_BRIDGE_TOKEN");
    if (token.length < 20) {
        throw new Error("LARAVEL_API_TOKEN is unexpectedly short");
    }

    const configuredWorkerId = env.OUTBOUND_WORKER_ID?.trim();
    const workerId = configuredWorkerId || `${os.hostname()}:${process.pid}`;
    if (workerId.length > 80 || !/^[A-Za-z0-9._:-]+$/.test(workerId)) {
        throw new Error(
            "OUTBOUND_WORKER_ID must be at most 80 characters from A-Z, a-z, 0-9, dot, underscore, colon, or hyphen",
        );
    }

    const allowedOrigins = new Set<string>([laravelBaseUrl.origin]);
    if (env.LARAVEL_PAYLOAD_ORIGIN?.trim()) {
        allowedOrigins.add(
            httpUrl(env.LARAVEL_PAYLOAD_ORIGIN.trim(), "LARAVEL_PAYLOAD_ORIGIN", allowHttp).origin,
        );
    }

    const requestTimeoutMs = boundedInteger(env, "OUTBOUND_REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000);
    const reconcileTimeoutMs = boundedInteger(
        env,
        "SOLANA_RECONCILE_TIMEOUT_MS",
        15_000,
        1_000,
        60_000,
    );
    const rpcTimeoutMs = boundedInteger(env, "SOLANA_RPC_TIMEOUT_MS", 10_000, 1_000, 60_000);
    const confirmTimeoutMs = boundedInteger(
        env,
        "SOLANA_CONFIRM_TIMEOUT_MS",
        90_000,
        10_000,
        300_000,
    );
    const claimTtlMs = boundedInteger(env, "OUTBOUND_CLAIM_TTL_MS", 300_000, 30_000, 3_600_000);
    // Worst case includes claim-response consumption after the server starts
    // the lease, payload retrieval, recovery of an expired absent transaction,
    // bounded reconciliation, preparation/submission, final parsing, two
    // idempotent confirmation attempts, and a final failure report. Keep a
    // fixed margin as well.
    const worstCaseClaimBudgetMs =
        requestTimeoutMs * 5 +
        reconcileTimeoutMs +
        confirmTimeoutMs +
        rpcTimeoutMs * 5 +
        15_000;
    if (worstCaseClaimBudgetMs >= claimTtlMs) {
        throw new Error(
            "The full request, Solana RPC, reconciliation, and confirmation budget must fit below OUTBOUND_CLAIM_TTL_MS",
        );
    }

    return {
        laravelBaseUrl,
        laravelPayloadOrigins: allowedOrigins,
        laravelApiToken: token,
        workerId,
        pollIntervalMs: boundedIntegerWithAlias(
            env,
            "OUTBOUND_POLL_INTERVAL_MS",
            "POLL_INTERVAL_MS",
            5_000,
            1_000,
            300_000,
        ),
        batchSize: boundedIntegerWithAlias(env, "OUTBOUND_BATCH_SIZE", "BATCH_LIMIT", 10, 1, 100),
        requestTimeoutMs,
        solanaRpcUrl: solanaRpc.toString(),
        solanaNetwork: network,
        feePayer: loadFeePayerFromEnv(env),
        rpcTimeoutMs,
        confirmTimeoutMs,
        sendMaxRetries: boundedInteger(env, "SOLANA_SEND_MAX_RETRIES", 3, 0, 10),
        reconcileLookback: boundedInteger(env, "SOLANA_RECONCILE_LOOKBACK", 100, 10, 250),
        reconcileTimeoutMs,
        claimTtlMs,
        journalPath:
            env.OUTBOUND_JOURNAL_PATH?.trim() ||
            `./data/outbound-anchor-journal-${network}.json`,
    };
}
