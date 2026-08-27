import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
    clearHmacNonceCacheForTests,
    hmacSigningInput,
    verifyHmac,
} from "../src/middleware/hmacAuth.js";

const secret = "a-production-length-hmac-secret-value";

function responseRecorder(): { response: Response; status: () => number } {
    let statusCode = 200;
    const response = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        json() {
            return this;
        },
    } as unknown as Response;
    return { response, status: () => statusCode };
}

describe("verifyHmac", () => {
    beforeEach(() => {
        process.env.NODE_ENV = "test";
        process.env.SKIP_HMAC_AUTH = "false";
        process.env.BRIDGE_HMAC_SECRET = secret;
        clearHmacNonceCacheForTests();
    });

    it("binds signature to method, path, timestamp, nonce, and raw body", () => {
        const timestamp = String(Date.now());
        const nonce = "unique_nonce_123456";
        const headers: Record<string, string> = { "x-timestamp": timestamp, "x-hmac-nonce": nonce };
        const request = {
            method: "POST",
            originalUrl: "/api/v1/submit-actor?mode=strict",
            rawBody: '{"id":1}',
            path: "/submit-actor",
            header: (name: string) => headers[name.toLowerCase()],
        } as unknown as Request & { rawBody: string };
        headers["x-hmac-signature"] = crypto
            .createHmac("sha256", secret)
            .update(hmacSigningInput(request, timestamp, nonce))
            .digest("hex");
        const result = responseRecorder();
        let passed = false;
        verifyHmac(request, result.response, (() => {
            passed = true;
        }) as NextFunction);
        expect(passed).toBe(true);
        expect(result.status()).toBe(200);
    });

    it("rejects replay of an otherwise valid request nonce", () => {
        const timestamp = String(Date.now());
        const nonce = "unique_nonce_654321";
        const headers: Record<string, string> = { "x-timestamp": timestamp, "x-hmac-nonce": nonce };
        const request = {
            method: "GET",
            originalUrl: "/api/v1/status/abc",
            path: "/status/abc",
            header: (name: string) => headers[name.toLowerCase()],
        } as unknown as Request;
        headers["x-hmac-signature"] = crypto
            .createHmac("sha256", secret)
            .update(hmacSigningInput(request, timestamp, nonce))
            .digest("hex");
        verifyHmac(request, responseRecorder().response, (() => undefined) as NextFunction);
        const replay = responseRecorder();
        verifyHmac(request, replay.response, (() => undefined) as NextFunction);
        expect(replay.status()).toBe(409);
    });
});
