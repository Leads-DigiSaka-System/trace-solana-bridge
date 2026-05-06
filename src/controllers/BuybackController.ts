import type { Request, Response } from "express";
import {
    submitBuybackToSolana,
    checkBuybackExistsOnSolana,
    getBuybackFromSolana,
    updateInSeasonOnSolana,
    settleBuybackOnSolana,
    confirmBuybackPaymentOnSolana,
    updatePaymentScheduleOnSolana,
    markBuybackSettledOnSolana,
    deleteBuybackOnSolana,
    closeBuybackOnSolana,
} from "../services/BuybackService.js";

/**
 * @openapi
 * /buybacks:
 *   post:
 *     summary: Submit a new buyback to Solana
 *     tags: [Buybacks]
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
 *               buyback_id:
 *                 type: string
 *               actor_id:
 *                 type: string
 *               season_id:
 *                 type: string
 *               target_amount:
 *                 type: string
 *               target_price_per_kg:
 *                 type: string
 *               target_harvest_date:
 *                 type: number
 *               target_payment_date:
 *                 type: number
 *               status:
 *                 type: string
 *     responses:
 *       202:
 *         description: Buyback submission received
 *       500:
 *         description: Server error
 */
export const submitBuyback = async (req: Request, res: Response) => {
    try {
        const txId = await submitBuybackToSolana(req.body);
        res.status(202).json({
            success: true,
            message:
                "Buyback submission received and being processed by Solana",
            transactionId: txId,
        });
    } catch (error: any) {
        const message = error?.message ?? String(error);
        // Strip circular refs — pull out only what you need
        const solanaLogs = error?.logs ?? [];
        console.error("Solana Buyback Submission Error:", message);
        if (solanaLogs.length) console.error("Logs:", solanaLogs);

        res.status(500).json({
            ok: false,
            error: message,
            logs: solanaLogs,
        });
    }
};

/**
 * @openapi
 * /buybacks/{buybackId}/check:
 *   get:
 *     summary: Check if a buyback exists on Solana
 *     tags: [Buybacks]
 *     parameters:
 *       - in: path
 *         name: buybackId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Existence status
 *       500:
 *         description: Server error
 */
export const checkBuyback = async (req: Request, res: Response) => {
    try {
        const { buybackId } = req.params;
        if (!buybackId)
            return res
                .status(400)
                .json({ success: false, error: "buybackId is required" });
        const result = await checkBuybackExistsOnSolana(buybackId);
        res.status(200).json({
            success: true,
            ...result,
        });
    } catch (error: any) {
        console.error("Solana Check Buyback Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /buybacks/{buybackId}:
 *   get:
 *     summary: Get buyback details from Solana
 *     tags: [Buybacks]
 *     parameters:
 *       - in: path
 *         name: buybackId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Buyback details
 *       404:
 *         description: Buyback not found
 *       500:
 *         description: Server error
 */
export const getBuyback = async (req: Request, res: Response) => {
    try {
        const { buybackId } = req.params;
        if (!buybackId)
            return res
                .status(400)
                .json({ success: false, error: "buybackId is required" });
        const buybackData = await getBuybackFromSolana(buybackId);
        res.status(200).json({ success: true, buyback: buybackData });
    } catch (error: any) {
        console.error("Solana Get Buyback Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /buybacks/update-in-season:
 *   post:
 *     summary: Update in-season data for a buyback
 *     tags: [Buybacks]
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
 *               buyback_id:
 *                 type: string
 *               risk_events:
 *                 type: string
 *               harvest_forecast:
 *                 type: string
 *     responses:
 *       200:
 *         description: In-season data updated
 *       500:
 *         description: Server error
 */
export const updateInSeason = async (req: Request, res: Response) => {
    try {
        const txId = await updateInSeasonOnSolana(req.body);
        res.status(200).json({
            success: true,
            message: "In-season data updated on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Update In-Season Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /buybacks/settle:
 *   post:
 *     summary: Settle a buyback on Solana
 *     tags: [Buybacks]
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
 *               buyback_id:
 *                 type: string
 *               actual_harvest_amount:
 *                 type: string
 *               final_price_per_kg:
 *                 type: string
 *     responses:
 *       200:
 *         description: Buyback settled
 *       500:
 *         description: Server error
 */
export const settleBuyback = async (req: Request, res: Response) => {
    try {
        const txId = await settleBuybackOnSolana(req.body);
        res.status(200).json({
            success: true,
            message: "Buyback settled on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Settle Buyback Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /buybacks/confirm-payment:
 *   post:
 *     summary: Confirm buyback payment on Solana
 *     tags: [Buybacks]
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
 *               buyback_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment confirmed
 *       500:
 *         description: Server error
 */
export const confirmBuybackPayment = async (req: Request, res: Response) => {
    try {
        const { buyback_id } = req.body;
        if (!buyback_id)
            return res.status(400).json({
                success: false,
                error: "buyback_id is required in body",
            });
        const txId = await confirmBuybackPaymentOnSolana(buyback_id);
        res.status(200).json({
            success: true,
            message: "Payment confirmed on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Confirm Payment Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /buybacks/update-payment-schedule:
 *   post:
 *     summary: Update payment schedule for a buyback
 *     tags: [Buybacks]
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
 *               buyback_id:
 *                 type: string
 *               target_payment_date:
 *                 type: number
 *     responses:
 *       200:
 *         description: Payment schedule updated
 *       500:
 *         description: Server error
 */
export const updatePaymentSchedule = async (req: Request, res: Response) => {
    try {
        const { buyback_id, target_payment_date } = req.body;
        if (!buyback_id || target_payment_date === undefined) {
            return res.status(400).json({
                success: false,
                error: "buyback_id and target_payment_date are required",
            });
        }
        const txId = await updatePaymentScheduleOnSolana(
            buyback_id,
            target_payment_date,
        );
        res.status(200).json({
            success: true,
            message: "Payment schedule updated on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Update Payment Schedule Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /buybacks/mark-settled:
 *   post:
 *     summary: Mark a buyback as settled on Solana
 *     tags: [Buybacks]
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
 *               buyback_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Buyback marked settled
 *       500:
 *         description: Server error
 */
export const markBuybackSettled = async (req: Request, res: Response) => {
    try {
        const { buyback_id } = req.body;
        if (!buyback_id)
            return res
                .status(400)
                .json({ success: false, error: "buyback_id is required" });
        const txId = await markBuybackSettledOnSolana(buyback_id);
        res.status(200).json({
            success: true,
            message: "Buyback marked as settled on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Mark Settled Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /buybacks/delete:
 *   post:
 *     summary: Delete a buyback on Solana
 *     tags: [Buybacks]
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
 *               buyback_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Buyback deleted
 *       500:
 *         description: Server error
 */
export const deleteBuyback = async (req: Request, res: Response) => {
    try {
        const { buyback_id } = req.body;
        if (!buyback_id)
            return res
                .status(400)
                .json({ success: false, error: "buyback_id is required" });
        const txId = await deleteBuybackOnSolana(buyback_id);
        res.status(200).json({
            success: true,
            message: "Buyback deleted on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Delete Buyback Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /buybacks/close:
 *   post:
 *     summary: Close a buyback account on Solana
 *     tags: [Buybacks]
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
 *               buyback_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Buyback account closed
 *       500:
 *         description: Server error
 */
export const closeBuyback = async (req: Request, res: Response) => {
    try {
        const { buyback_id } = req.body;
        if (!buyback_id)
            return res
                .status(400)
                .json({ success: false, error: "buyback_id is required" });
        const txId = await closeBuybackOnSolana(buyback_id);
        res.status(200).json({
            success: true,
            message: "Buyback account closed successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Close Buyback Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
