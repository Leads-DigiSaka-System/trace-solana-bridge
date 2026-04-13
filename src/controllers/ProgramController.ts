import type { Request, Response } from "express";
import {
    initializeProgramOnSolana,
    getProgramConfig,
    getFeePayerPublicKey,
    closeConfigOnSolana,
} from "../services/ProgramService.js";

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
