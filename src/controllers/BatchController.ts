import type { Request, Response } from "express";
import {
    submitBatchToSolana,
    checkBatchExistsOnSolana,
    getBatchFromSolana,
    updateBatchOnSolana,
    deleteBatchOnSolana,
    closeBatchOnSolana,
} from "../services/BatchService.js";

/**
 * @openapi
 * /batches:
 *   post:
 *     summary: Submit a new batch to Solana
 *     tags: [Batches]
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
 *               batch_id:
 *                 type: string
 *               farmer_id:
 *                 type: string
 *               farm_id:
 *                 type: string
 *               tps_id:
 *                 type: string
 *               weight:
 *                 type: string
 *               rice_type:
 *                 type: string
 *               moisture_content:
 *                 type: string
 *               impurity_content:
 *                 type: string
 *               price_per_kg:
 *                 type: string
 *               total_price:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       202:
 *         description: Batch submission received
 *       500:
 *         description: Server error
 */
export const submitBatch = async (req: Request, res: Response) => {
    try {
        const batchData = req.body;
        const txId = await submitBatchToSolana(batchData);
        res.status(202).json({
            message: "Batch submission received and being processed by Solana",
            transactionId: txId,
            batch_id: batchData.batch_id,
        });
    } catch (error: any) {
        console.error("Solana Batch Submission Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /batches/{batchId}/check:
 *   get:
 *     summary: Check if a batch exists on Solana
 *     tags: [Batches]
 *     parameters:
 *       - in: path
 *         name: batchId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Existence status
 *       500:
 *         description: Server error
 */
export const checkBatch = async (req: Request, res: Response) => {
    try {
        const batchIdParam = req.params.batchId;
        if (!batchIdParam) {
            return res.status(400).json({
                success: false,
                error: "batchId parameter is required",
            });
        }
        const exists = await checkBatchExistsOnSolana(batchIdParam);
        res.status(200).json({
            success: true,
            exists,
            batch_id: batchIdParam,
        });
    } catch (error: any) {
        console.error("Solana Check Batch Error:", error.message);
        res.status(500).json({
            success: false,
            error: error.message || "Internal server error",
            batch_id: req.params.batchId,
        });
    }
};

/**
 * @openapi
 * /batches/{batchId}:
 *   get:
 *     summary: Get batch details from Solana
 *     tags: [Batches]
 *     parameters:
 *       - in: path
 *         name: batchId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Batch details
 *       404:
 *         description: Batch not found
 *       500:
 *         description: Server error
 */
export const getBatch = async (req: Request, res: Response) => {
    try {
        const batchIdParam = req.params.batchId;
        if (!batchIdParam) {
            return res.status(400).json({
                success: false,
                error: "batchId parameter is required",
            });
        }
        const batchData = await getBatchFromSolana(batchIdParam);
        if (!batchData) {
            return res
                .status(404)
                .json({ success: false, message: "Batch not found on Solana" });
        }
        res.status(200).json({ success: true, batch: batchData });
    } catch (error: any) {
        console.error("Solana Get Batch Error:", error.message);
        res.status(500).json({
            success: false,
            error: error.message || "Internal server error",
            batch_id: req.params.batchId,
        });
    }
};

/**
 * @openapi
 * /batches/update:
 *   post:
 *     summary: Update an existing batch on Solana
 *     tags: [Batches]
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
 *               batch_id:
 *                 type: string
 *               weight:
 *                 type: string
 *               moisture_content:
 *                 type: string
 *               impurity_content:
 *                 type: string
 *               price_per_kg:
 *                 type: string
 *               total_price:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Batch updated
 */
export const updateBatch = async (req: Request, res: Response) => {
    try {
        const batchData = req.body;
        const txId = await updateBatchOnSolana(batchData);
        res.status(200).json({
            message: "Batch updated on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Update Batch Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /batches/delete:
 *   post:
 *     summary: Delete a batch on Solana
 *     tags: [Batches]
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
 *               batch_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Batch deleted
 */
export const deleteBatch = async (req: Request, res: Response) => {
    try {
        const batchData = req.body;
        const txId = await deleteBatchOnSolana(batchData);
        res.status(200).json({
            message: "Batch deleted (deactivated) on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Delete Batch Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /batches/close:
 *   post:
 *     summary: Close a batch account on Solana
 *     tags: [Batches]
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
 *               batch_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Batch account closed
 */
export const closeBatch = async (req: Request, res: Response) => {
    try {
        const batchData = req.body;
        const txId = await closeBatchOnSolana(batchData);
        res.status(200).json({
            message:
                "Batch account closed successfully. Rent returned to authority.",
            transactionId: txId,
            warning:
                "Account has been permanently deleted from Solana blockchain.",
        });
    } catch (error: any) {
        console.error("Solana Close Batch Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
