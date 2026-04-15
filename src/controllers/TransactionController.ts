import type { Request, Response } from "express";
import {
    submitTransactionToSolana,
    checkTransactionExistsOnSolana,
    addTransactionToSolana,
    updateTransactionOnSolana,
} from "../services/TransactionService.js";

/**
 * @openapi
 * /transactions:
 *   post:
 *     summary: Submit a new transaction to Solana
 *     tags: [Transactions]
 *     security:
 *       - hmacAuth: []
 *       - timestamp: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               from_actor_id:
 *                 type: string
 *               to_actor_id:
 *                 type: string
 *               quantity:
 *                 type: string
 *               unit_price:
 *                 type: string
 *               payment_reference:
 *                 type: string
 *               nonce:
 *                 type: number
 *               batch_id:
 *                 type: string
 *               moisture:
 *                 type: number
 *               status:
 *                 type: number
 *               is_test:
 *                 type: number
 *     responses:
 *       202:
 *         description: Transaction record received
 */
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

/**
 * @openapi
 * /transactions/{nonce}/check:
 *   get:
 *     summary: Check if a transaction exists on Solana
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: nonce
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Existence status
 */
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

/**
 * @openapi
 * /transactions/add:
 *   post:
 *     summary: Add transaction data to an existing record on Solana
 *     tags: [Transactions]
 *     security:
 *       - hmacAuth: []
 *       - timestamp: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nonce:
 *                 type: number
 *               status:
 *                 type: number
 *     responses:
 *       200:
 *         description: Transaction added
 */
export const addTransaction = async (req: Request, res: Response) => {
    try {
        const txId = await addTransactionToSolana(req.body);
        res.status(200).json({
            message: "Transaction added to existing Solana record successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Add Transaction Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /transactions/update:
 *   post:
 *     summary: Update transaction status on Solana
 *     tags: [Transactions]
 *     security:
 *       - hmacAuth: []
 *       - timestamp: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nonce:
 *                 type: number
 *               status:
 *                 type: number
 *     responses:
 *       200:
 *         description: Transaction updated
 */
export const updateTransaction = async (req: Request, res: Response) => {
    try {
        const { nonce, status } = req.body;
        if (nonce === undefined || status === undefined) {
            return res.status(400).json({
                success: false,
                error: "nonce and status are required",
            });
        }
        const txId = await updateTransactionOnSolana(nonce, status);
        res.status(200).json({
            message: "Transaction status updated on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Update Transaction Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
