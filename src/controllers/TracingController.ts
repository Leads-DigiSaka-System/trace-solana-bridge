import type { Request, Response } from "express";
import {
    submitDryingToSolana,
    checkDryingExistsOnSolana,
    getDryingFromSolana,
    updateDryingOnSolana,
    deleteDryingOnSolana,
    closeDryingOnSolana,
    submitMillingToSolana,
    checkMillingExistsOnSolana,
    getMillingFromSolana,
    updateMillingOnSolana,
    deleteMillingOnSolana,
    closeMillingOnSolana,
    submitSeasonToSolana,
    checkSeasonExistsOnSolana,
    getSeasonFromSolana,
    updateSeasonOnSolana,
    deleteSeasonOnSolana,
    closeSeasonOnSolana,
} from "../services/TracingService.js";

// Drying Handlers
/**
 * @openapi
 * /tracing/drying:
 *   post:
 *     summary: Submit a new drying record to Solana
 *     tags: [Tracing]
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
 *               drying_id:
 *                 type: string
 *               batch_id:
 *                 type: string
 *               dryer_actor_id:
 *                 type: string
 *               initial_mc:
 *                 type: number
 *               final_mc:
 *                 type: number
 *               temperature:
 *                 type: number
 *               airflow:
 *                 type: number
 *               humidity:
 *                 type: number
 *               duration:
 *                 type: number
 *               price:
 *                 type: number
 *               initial_weight:
 *                 type: number
 *               final_weight:
 *                 type: number
 *     responses:
 *       202:
 *         description: Drying record received
 */
export const submitDrying = async (req: Request, res: Response) => {
    try {
        const dryingData = req.body;
        const txId = await submitDryingToSolana(dryingData);
        res.status(201).json({
            message: "Drying submitted to Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Submit Drying Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const checkDrying = async (req: Request, res: Response) => {
    try {
        const dryingIdParam = req.params.dryingId;
        if (!dryingIdParam)
            return res
                .status(400)
                .json({ success: false, error: "dryingId is required" });
        const result = await checkDryingExistsOnSolana(dryingIdParam);
        res.status(200).json({
            success: true,
            exists: result.exists,
            pda: result.pda,
        });
    } catch (error: any) {
        console.error("Solana Check Drying Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getDrying = async (req: Request, res: Response) => {
    try {
        const dryingIdParam = req.params.dryingId;
        if (!dryingIdParam)
            return res
                .status(400)
                .json({ success: false, error: "dryingId is required" });
        const dryingData = await getDryingFromSolana(dryingIdParam);
        res.status(200).json({ success: true, drying: dryingData });
    } catch (error: any) {
        console.error("Solana Get Drying Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const updateDrying = async (req: Request, res: Response) => {
    try {
        const txId = await updateDryingOnSolana(req.body);
        res.status(200).json({
            message: "Drying updated on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Update Drying Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const deleteDrying = async (req: Request, res: Response) => {
    try {
        const txId = await deleteDryingOnSolana(req.body);
        res.status(200).json({
            message: "Drying deleted on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Delete Drying Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const closeDrying = async (req: Request, res: Response) => {
    try {
        const txId = await closeDryingOnSolana(req.body);
        res.status(200).json({
            message: "Drying account closed successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Close Drying Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Milling Handlers
/**
 * @openapi
 * /tracing/milling:
 *   post:
 *     summary: Submit a new milling record to Solana
 *     tags: [Tracing]
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
 *               milling_id:
 *                 type: string
 *               miller_id:
 *                 type: string
 *               batch_id:
 *                 type: string
 *               milling_type:
 *                 type: string
 *               quality:
 *                 type: string
 *               total_weight_kg:
 *                 type: number
 *               total_weight_processed_kg:
 *                 type: number
 *               recovery:
 *                 type: number
 *               moisture:
 *                 type: number
 *               price:
 *                 type: number
 *               actual_price:
 *                 type: number
 *     responses:
 *       202:
 *         description: Milling record received
 */
export const submitMilling = async (req: Request, res: Response) => {
    try {
        const txId = await submitMillingToSolana(req.body);
        res.status(201).json({
            message: "Milling submitted to Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Submit Milling Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const checkMilling = async (req: Request, res: Response) => {
    try {
        const millingIdParam = req.params.millingId;
        if (!millingIdParam)
            return res
                .status(400)
                .json({ success: false, error: "millingId is required" });
        const result = await checkMillingExistsOnSolana(millingIdParam);
        res.status(200).json({
            success: true,
            exists: result.exists,
            pda: result.pda,
        });
    } catch (error: any) {
        console.error("Solana Check Milling Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getMilling = async (req: Request, res: Response) => {
    try {
        const millingIdParam = req.params.millingId;
        if (!millingIdParam)
            return res
                .status(400)
                .json({ success: false, error: "millingId is required" });
        const millingData = await getMillingFromSolana(millingIdParam);
        res.status(200).json({ success: true, milling: millingData });
    } catch (error: any) {
        console.error("Solana Get Milling Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const updateMilling = async (req: Request, res: Response) => {
    try {
        const updateData = req.body;
        updateData.milling_id = req.params.millingId;
        const txId = await updateMillingOnSolana(updateData);
        res.status(200).json({
            message: "Milling updated on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Update Milling Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const deleteMilling = async (req: Request, res: Response) => {
    try {
        const txId = await deleteMillingOnSolana({
            milling_id: req.params.millingId,
        });
        res.status(200).json({
            message: "Milling soft deleted on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Delete Milling Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const closeMilling = async (req: Request, res: Response) => {
    try {
        const txId = await closeMillingOnSolana({
            milling_id: req.params.millingId,
        });
        res.status(200).json({
            message: "Milling account closed successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Close Milling Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Season Handlers
/**
 * @openapi
 * /tracing/season:
 *   post:
 *     summary: Submit a new production season to Solana
 *     tags: [Tracing]
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
 *               season_id:
 *                 type: string
 *               farmer_id:
 *                 type: string
 *               crop_year:
 *                 type: string
 *               season:
 *                 type: string
 *               variety:
 *                 type: string
 *     responses:
 *       202:
 *         description: Season record received
 */
export const submitSeason = async (req: Request, res: Response) => {
    try {
        const txId = await submitSeasonToSolana(req.body);
        res.status(201).json({
            message: "Season submitted to Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Submit Season Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const checkSeason = async (req: Request, res: Response) => {
    try {
        const seasonIdParam = req.params.seasonId;
        if (!seasonIdParam)
            return res
                .status(400)
                .json({ success: false, error: "seasonId is required" });
        const result = await checkSeasonExistsOnSolana(seasonIdParam);
        res.status(200).json({
            success: true,
            exists: result.exists,
            season_id: seasonIdParam,
            pda: result.pda,
        });
    } catch (error: any) {
        console.error("Solana Check Season Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getSeason = async (req: Request, res: Response) => {
    try {
        const seasonIdParam = req.params.seasonId;
        if (!seasonIdParam)
            return res
                .status(400)
                .json({ success: false, error: "seasonId is required" });
        const seasonData = await getSeasonFromSolana(seasonIdParam);
        res.status(200).json({ success: true, season: seasonData });
    } catch (error: any) {
        console.error("Solana Get Season Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const updateSeason = async (req: Request, res: Response) => {
    try {
        const txId = await updateSeasonOnSolana(req.body);
        res.status(200).json({
            message: "Season updated on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Update Season Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const deleteSeason = async (req: Request, res: Response) => {
    try {
        const txId = await deleteSeasonOnSolana(req.body);
        res.status(200).json({
            message: "Season deleted on Solana successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Delete Season Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const closeSeason = async (req: Request, res: Response) => {
    try {
        const txId = await closeSeasonOnSolana(req.body);
        res.status(200).json({
            message: "Season account closed successfully",
            transactionId: txId,
        });
    } catch (error: any) {
        console.error("Solana Close Season Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
