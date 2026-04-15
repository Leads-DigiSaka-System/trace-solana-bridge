import type { Request, Response } from "express";
import * as DistributionService from "../services/DistributionService.js";

/**
 * @openapi
 * /distribution/performance/submit:
 *   post:
 *     summary: Submit actor performance to Solana
 *     tags: [Distribution]
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
 *               actor_id:
 *                 type: string
 *               performance_score:
 *                 type: number
 *               reports_count:
 *                 type: number
 *               delivery_count:
 *                 type: number
 *     responses:
 *       200:
 *         description: Performance submitted
 *       500:
 *         description: Server error
 */
export const submitActorPerformance = async (req: Request, res: Response) => {
    try {
        const txSig = await DistributionService.submitActorPerformanceToSolana(
            req.body,
        );
        res.status(200).json({
            success: true,
            message: "Actor performance submitted to Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error submitting actor performance:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /distribution/performance/record:
 *   post:
 *     summary: Record delivery performance on Solana
 *     tags: [Distribution]
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
 *               actor_id:
 *                 type: string
 *               on_time:
 *                 type: number
 *     responses:
 *       200:
 *         description: Delivery performance recorded
 *       500:
 *         description: Server error
 */
export const recordDeliveryPerformance = async (
    req: Request,
    res: Response,
) => {
    try {
        const txSig =
            await DistributionService.recordDeliveryPerformanceToSolana(
                req.body,
            );
        res.status(200).json({
            success: true,
            message: "Delivery performance recorded on Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error recording delivery performance:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /distribution/submit:
 *   post:
 *     summary: Submit a new distribution to Solana
 *     tags: [Distribution]
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
 *               distribution_id:
 *                 type: string
 *               batch_id:
 *                 type: string
 *               sender_id:
 *                 type: string
 *               receiver_id:
 *                 type: string
 *               status:
 *                 type: number
 *     responses:
 *       200:
 *         description: Distribution submitted
 *       500:
 *         description: Server error
 */
export const submitDistribution = async (req: Request, res: Response) => {
    try {
        const txSig = await DistributionService.submitDistributionToSolana(
            req.body,
        );
        res.status(200).json({
            success: true,
            message: "Distribution submitted to Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error submitting distribution:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /distribution/update-status:
 *   post:
 *     summary: Update delivery status on Solana
 *     tags: [Distribution]
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
 *               distribution_id:
 *                 type: string
 *               status:
 *                 type: number
 *     responses:
 *       200:
 *         description: Delivery status updated
 *       500:
 *         description: Server error
 */
export const updateDeliveryStatus = async (req: Request, res: Response) => {
    try {
        const txSig = await DistributionService.updateDeliveryStatusToSolana(
            req.body,
        );
        res.status(200).json({
            success: true,
            message: "Delivery status updated on Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error updating delivery status:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /distribution/confirm-receipt:
 *   post:
 *     summary: Confirm receipt of distribution on Solana
 *     tags: [Distribution]
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
 *               distribution_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Receipt confirmed
 *       500:
 *         description: Server error
 */
export const confirmReceipt = async (req: Request, res: Response) => {
    try {
        const txSig = await DistributionService.confirmReceiptToSolana(
            req.body,
        );
        res.status(200).json({
            success: true,
            message: "Receipt confirmed on Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error confirming receipt:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /distribution/link-to-chain:
 *   post:
 *     summary: Link Solana transaction signature to distribution
 *     tags: [Distribution]
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
 *               distribution_id:
 *                 type: string
 *               solana_tx_signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Linked to chain
 *       500:
 *         description: Server error
 */
export const linkToChain = async (req: Request, res: Response) => {
    try {
        const txSig = await DistributionService.linkToChainToSolana(req.body);
        res.status(200).json({
            success: true,
            message: "Solana transaction linked to distribution",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error linking to chain:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /distribution/delete:
 *   post:
 *     summary: Delete a distribution on Solana
 *     tags: [Distribution]
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
 *               distribution_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Distribution deleted
 *       500:
 *         description: Server error
 */
export const deleteDistribution = async (req: Request, res: Response) => {
    try {
        const { distribution_id } = req.body;
        if (!distribution_id) {
            return res.status(400).json({
                success: false,
                message: "distribution_id is required",
            });
        }
        const txSig =
            await DistributionService.deleteDistributionOnSolana(
                distribution_id,
            );
        res.status(200).json({
            success: true,
            message: "Distribution deleted on Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error deleting distribution:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /distribution/checkpoints/submit:
 *   post:
 *     summary: Submit a new checkpoint to Solana
 *     tags: [Distribution]
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
 *               checkpoint_id:
 *                 type: string
 *               distribution_id:
 *                 type: string
 *               location:
 *                 type: string
 *               status:
 *                 type: number
 *     responses:
 *       200:
 *         description: Checkpoint submitted
 *       500:
 *         description: Server error
 */
export const submitCheckpoint = async (req: Request, res: Response) => {
    try {
        const txSig = await DistributionService.submitCheckpointToSolana(
            req.body,
        );
        res.status(200).json({
            success: true,
            message: "Checkpoint submitted to Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error submitting checkpoint:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /distribution/checkpoints/delete:
 *   post:
 *     summary: Delete a checkpoint on Solana
 *     tags: [Distribution]
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
 *               checkpoint_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Checkpoint deleted
 *       500:
 *         description: Server error
 */
export const deleteCheckpoint = async (req: Request, res: Response) => {
    try {
        const { checkpoint_id } = req.body;
        if (!checkpoint_id) {
            return res
                .status(400)
                .json({ success: false, message: "checkpoint_id is required" });
        }
        const txSig =
            await DistributionService.deleteCheckpointOnSolana(checkpoint_id);
        res.status(200).json({
            success: true,
            message: "Checkpoint deleted on Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error deleting checkpoint:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};
