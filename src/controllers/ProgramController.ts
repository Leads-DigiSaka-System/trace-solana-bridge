import type { Request, Response } from "express";
import {
    initializeProgramOnSolana,
    getProgramConfig,
    getFeePayerPublicKey,
    closeConfigOnSolana,
} from "../services/ProgramService.js";

/**
 * @openapi
 * /program/initialize:
 *   post:
 *     summary: Initialize the program on Solana
 *     tags: [Program]
 *     security:
 *       - hmacAuth: []
 *       - timestamp: []
 *     responses:
 *       201:
 *         description: Program initialized
 */
export const initializeProgram = async (req: Request, res: Response) => {
    try {
        const config = await getProgramConfig();
        if (config.isInitialized) {
            return res.status(409).json({
                success: false,
                error: "Program is already initialized",
                config,
            });
        }
        const txId = await initializeProgramOnSolana();
        res.status(201).json({
            success: true,
            message: "Program initialized successfully",
            transactionId: txId,
            superAdmin: getFeePayerPublicKey(),
        });
    } catch (error: any) {
        console.error("Program initialization error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /program/status:
 *   get:
 *     summary: Get program configuration and status
 *     tags: [Program]
 *     responses:
 *       200:
 *         description: Program status
 */
export const getStatus = async (req: Request, res: Response) => {
    try {
        const config = await getProgramConfig();
        res.json({
            success: true,
            ...config,
            feePayerPublicKey: getFeePayerPublicKey(),
        });
    } catch (error: any) {
        console.error("Error fetching program status:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /check-init-status:
 *   get:
 *     summary: Check if programs are deployed and initialized
 *     tags: [Status]
 *     responses:
 *       200:
 *         description: Initialization status
 */
export const checkInitStatus = async (req: Request, res: Response) => {
    try {
        const config = await getProgramConfig();
        res.status(200).json({
            success: true,
            isInitialized: config.isInitialized,
            message: config.isInitialized
                ? "Program is initialized and ready"
                : "Program is not yet initialized",
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /test-connection:
 *   post:
 *     summary: HMAC-protected echo/test endpoint
 *     tags: [Status]
 *     security:
 *       - hmacAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Echo response
 */
export const testConnection = async (req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        message: "HMAC connection test successful",
        echo: req.body,
        timestamp: new Date().toISOString(),
    });
};

/**
 * @openapi
 * /program/fee-payer:
 *   get:
 *     summary: Get the public key of the fee payer
 *     tags: [Program]
 *     responses:
 *       200:
 *         description: Fee payer public key
 */
export const getFeePayer = async (req: Request, res: Response) => {
    try {
        res.json({
            success: true,
            publicKey: getFeePayerPublicKey(),
            message:
                "This is the public key that will be set as super_admin upon initialization",
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /program/close:
 *   post:
 *     summary: Close the program configuration on Solana
 *     tags: [Program]
 *     security:
 *       - hmacAuth: []
 *       - timestamp: []
 *     responses:
 *       200:
 *         description: Config closed
 */
export const closeConfig = async (req: Request, res: Response) => {
    try {
        const txId = await closeConfigOnSolana();
        res.status(200).json({
            success: true,
            message: "Program config closed successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Close config error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
