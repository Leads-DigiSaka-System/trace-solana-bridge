import crypto from "node:crypto";
import dotenv from "dotenv";
import type { Request, Response, NextFunction } from "express";

dotenv.config();

const DEFAULT_MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1_000;
const usedNonces = new Map<string, number>();

type RawRequest = Request & { rawBody?: string };

function maxTimestampAge(): number {
    const raw = process.env.HMAC_MAX_TIMESTAMP_AGE_MS;
    if (!raw) return DEFAULT_MAX_TIMESTAMP_AGE_MS;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 10_000 && parsed <= 300_000
        ? parsed
        : DEFAULT_MAX_TIMESTAMP_AGE_MS;
}

function removeExpiredNonces(now: number, maxAge: number): void {
    for (const [nonce, expiresAt] of usedNonces) {
        if (expiresAt <= now) usedNonces.delete(nonce);
    }
    while (usedNonces.size > 10_000) {
        const oldest = usedNonces.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        usedNonces.delete(oldest);
    }
}

/** Canonical legacy-route signing input: method, URL, timestamp, nonce, body. */
export function hmacSigningInput(req: RawRequest, timestamp: string, nonce: string): string {
    return `${req.method.toUpperCase()}\n${req.originalUrl}\n${timestamp}\n${nonce}\n${req.rawBody ?? ""}`;
}

export const verifyHmac = (req: RawRequest, res: Response, next: NextFunction) => {
    const developmentBypass =
        process.env.SKIP_HMAC_AUTH === "true" &&
        (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test");
    if (developmentBypass) return next();

    const secret = process.env.BRIDGE_HMAC_SECRET?.trim();
    if (!secret || secret.length < 32) {
        console.error("HMAC authentication is not securely configured");
        return res.status(503).json({ success: false, error: "Authentication unavailable" });
    }

    const signature = req.header("x-hmac-signature")?.trim().toLowerCase();
    const timestamp = req.header("x-timestamp")?.trim();
    const nonce = req.header("x-hmac-nonce")?.trim();
    if (!signature || !timestamp || !nonce) {
        return res.status(401).json({ success: false, error: "Missing authentication headers" });
    }
    if (!/^[a-f0-9]{64}$/.test(signature) || !/^\d{13}$/.test(timestamp)) {
        return res.status(401).json({ success: false, error: "Invalid authentication headers" });
    }
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) {
        return res.status(401).json({ success: false, error: "Invalid request nonce" });
    }

    const now = Date.now();
    const maxAge = maxTimestampAge();
    const requestTime = Number(timestamp);
    if (Math.abs(now - requestTime) > maxAge) {
        return res.status(401).json({ success: false, error: "Request timestamp expired or invalid" });
    }
    removeExpiredNonces(now, maxAge);
    if (usedNonces.has(nonce)) {
        return res.status(409).json({ success: false, error: "Request nonce has already been used" });
    }

    const expected = crypto
        .createHmac("sha256", secret)
        .update(hmacSigningInput(req, timestamp, nonce))
        .digest();
    const received = Buffer.from(signature, "hex");
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
        return res.status(401).json({ success: false, error: "Invalid signature" });
    }

    usedNonces.set(nonce, now + maxAge);
    next();
};

export const logRequest = (req: Request, _res: Response, next: NextFunction) => {
    console.log(`${req.method} ${req.path}`);
    next();
};

export function clearHmacNonceCacheForTests(): void {
    if (process.env.NODE_ENV === "test") usedNonces.clear();
}
