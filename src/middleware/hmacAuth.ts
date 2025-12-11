import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * HMAC Authentication Middleware
 * Verifies that requests come from authorized sources (Laravel backend)
 * 
 * Required headers:
 * - X-HMAC-Signature: HMAC-SHA256 signature of timestamp.payload
 * - X-Timestamp: Unix timestamp in milliseconds
 * 
 * Security features:
 * - Rejects requests without valid signature
 * - Rejects requests older than 5 minutes (replay attack prevention)
 * - Uses constant-time comparison (timing attack prevention)
 */

const HMAC_SECRET = process.env.BRIDGE_HMAC_SECRET;
const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000; // 5 minutes
const SKIP_AUTH = process.env.SKIP_HMAC_AUTH === 'true';

export const verifyHmac = (req: Request, res: Response, next: NextFunction) => {
    // Skip auth in development if explicitly disabled
    if (SKIP_AUTH) {
        console.warn('⚠️  HMAC authentication is DISABLED (SKIP_HMAC_AUTH=true)');
        console.warn('⚠️  This should only be used in development!');
        return next();
    }

    // Check if secret is configured
    if (!HMAC_SECRET) {
        console.error('❌ CRITICAL: BRIDGE_HMAC_SECRET not configured in .env');
        return res.status(500).json({ 
            success: false,
            error: 'Server misconfiguration: HMAC secret not set' 
        });
    }

    // Get headers
    const signature = req.headers['x-hmac-signature'] as string;
    const timestamp = req.headers['x-timestamp'] as string;

    // Validate headers exist
    if (!signature || !timestamp) {
        console.warn('🚫 HMAC Auth Failed: Missing headers', {
            hasSignature: !!signature,
            hasTimestamp: !!timestamp,
            ip: req.ip,
            path: req.path
        });
        return res.status(401).json({ 
            success: false,
            error: 'Missing authentication headers',
            required: ['X-HMAC-Signature', 'X-Timestamp']
        });
    }

    // Validate timestamp is recent (prevent replay attacks)
    const requestTime = parseInt(timestamp, 10);
    const now = Date.now();
    
    if (isNaN(requestTime)) {
        console.warn('🚫 HMAC Auth Failed: Invalid timestamp format', {
            timestamp,
            ip: req.ip,
            path: req.path
        });
        return res.status(401).json({ 
            success: false,
            error: 'Invalid timestamp format' 
        });
    }

    const age = Math.abs(now - requestTime);
    if (age > MAX_TIMESTAMP_AGE_MS) {
        console.warn('🚫 HMAC Auth Failed: Request timestamp expired', {
            requestTime: new Date(requestTime).toISOString(),
            serverTime: new Date(now).toISOString(),
            ageMs: age,
            maxAgeMs: MAX_TIMESTAMP_AGE_MS,
            ip: req.ip,
            path: req.path
        });
        return res.status(401).json({ 
            success: false,
            error: 'Request timestamp expired or invalid',
            message: `Requests must be made within ${MAX_TIMESTAMP_AGE_MS / 1000 / 60} minutes`
        });
    }

    // Compute expected signature
    // Format: HMAC-SHA256(timestamp.JSON(body), secret)
    // IMPORTANT: Use raw body if available (before express.json() parsing)
    // This ensures we verify against the exact JSON string that was sent
    let payload: string;
    if ((req as any).rawBody !== undefined) {
        // Use raw body (exact JSON string sent by client)
        payload = (req as any).rawBody || '{}';
    } else {
        // Fallback: stringify parsed body (may have different key order)
        payload = JSON.stringify(req.body || {});
    }
    
    const dataToSign = `${timestamp}.${payload}`;
    const expectedSignature = crypto
        .createHmac('sha256', HMAC_SECRET)
        .update(dataToSign)
        .digest('hex');
    
    // Debug logging (only in development)
    if (process.env.NODE_ENV !== 'production') {
        console.log('🔍 HMAC Debug:', {
            receivedSignature: signature.substring(0, 16) + '...',
            expectedSignature: expectedSignature.substring(0, 16) + '...',
            payloadLength: payload.length,
            dataToSignLength: dataToSign.length,
            timestamp,
            usingRawBody: (req as any).rawBody !== undefined,
            payloadPreview: payload.substring(0, 100) + (payload.length > 100 ? '...' : ''),
        });
    }

    // Constant-time comparison to prevent timing attacks
    let isValid = false;
    try {
        const signatureBuffer = Buffer.from(signature, 'hex');
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');
        
        if (signatureBuffer.length === expectedBuffer.length) {
            isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
        }
    } catch (err) {
        // Invalid hex format or other error
        isValid = false;
    }

    if (!isValid) {
        console.warn('🚫 HMAC Auth Failed: Invalid signature', {
            ip: req.ip,
            path: req.path,
            method: req.method,
            timestamp: new Date(requestTime).toISOString()
        });
        return res.status(401).json({ 
            success: false,
            error: 'Invalid signature' 
        });
    }

    // Signature valid, proceed
    console.log('✅ HMAC Auth Passed', {
        path: req.path,
        method: req.method
    });
    next();
};

/**
 * Middleware for routes that should log but not require auth
 * Useful for status/info endpoints
 */
export const logRequest = (req: Request, res: Response, next: NextFunction) => {
    console.log(`📥 ${req.method} ${req.path}`, {
        ip: req.ip,
        timestamp: new Date().toISOString()
    });
    next();
};

