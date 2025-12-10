import type { Request, Response, NextFunction } from 'express';
export declare const verifyHmac: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
/**
 * Middleware for routes that should log but not require auth
 * Useful for status/info endpoints
 */
export declare const logRequest: (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=hmacAuth.d.ts.map