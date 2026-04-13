import type { Request, Response } from "express";
import {
    submitTransactionToSolana,
    checkTransactionExistsOnSolana,
} from "../services/TransactionService.js";

export const submitTransaction = async (req: Request, res: Response) => {
    try {
        const txId = await submitTransactionToSolana(req.body);
        res.status(201).json({
            message: "Transaction submitted to Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Submit Transaction Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const checkTransaction = async (req: Request, res: Response) => {
    try {
        const nonceParam = req.params.nonce;
        if (!nonceParam)
            return res
                .status(400)
                .json({ success: false, error: "nonce is required" });
        const exists = await checkTransactionExistsOnSolana(nonceParam);
        res.json({
            exists,
            nonce: nonceParam,
            message: exists
                ? "Transaction exists on Solana"
                : "Transaction does not exist on Solana",
        });
    } catch (error: any) {
        console.error("Error checking transaction existence:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
