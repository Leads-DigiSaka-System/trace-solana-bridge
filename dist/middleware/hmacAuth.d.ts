import type { Request, Response, NextFunction } from "express";
type RawRequest = Request & {
    rawBody?: string;
};
/** Canonical legacy-route signing input: method, URL, timestamp, nonce, body. */
export declare function hmacSigningInput(req: RawRequest, timestamp: string, nonce: string): string;
export declare const verifyHmac: (req: RawRequest, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
export declare const logRequest: (req: Request, _res: Response, next: NextFunction) => void;
export declare function clearHmacNonceCacheForTests(): void;
export {};
//# sourceMappingURL=hmacAuth.d.ts.map