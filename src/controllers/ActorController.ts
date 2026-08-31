import type { Request, Response } from "express";
import {
    submitActorToSolana,
    checkActorExistsOnSolana,
    getActorFromSolana,
    updateActorOnSolana,
    deleteActorOnSolana,
    closeActorOnSolana,
} from "../services/ActorService.js";
import { routeParam } from "./routeParam.js";

/**
 * @openapi
 * /actors:
 *   post:
 *     summary: Submit a new actor to Solana
 *     tags: [Actors]
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
 *               user_id:
 *                 type: string
 *               name:
 *                 type: string
 *               roles:
 *                 type: array
 *                 items:
 *                   type: string
 *               organization:
 *                 type: string
 *               is_active:
 *                 type: boolean
 *               province:
 *                 type: string
 *               city:
 *                 type: string
 *               balance:
 *                 type: number
 *               address:
 *                 type: string
 *               farm_id:
 *                 type: string
 *               farmer_id:
 *                 type: string
 *               assigned_tps:
 *                 type: string
 *               farmer_signature_key:
 *                 type: string
 *     responses:
 *       202:
 *         description: Actor submission received
 *       500:
 *         description: Server error
 */
export const submitActor = async (req: Request, res: Response) => {
    try {
        const actorData = req.body;
        const txId = await submitActorToSolana(actorData);
        res.status(202).json({
            message: "Actor submission received and being processed by Solana",
            transactionId: txId,
            actor_id: actorData.actor_id,
        });
    } catch (error: any) {
        console.error("Solana Actor Submission Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * @openapi
 * /actors/{actorId}/check:
 *   get:
 *     summary: Check if an actor exists on Solana
 *     tags: [Actors]
 *     parameters:
 *       - in: path
 *         name: actorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Existence status
 *       500:
 *         description: Server error
 */
export const checkActor = async (req: Request, res: Response) => {
    try {
        const actorIdParam = routeParam(req.params.actorId);
        if (!actorIdParam) {
            return res.status(400).json({
                success: false,
                error: "actorId parameter is required",
            });
        }
        const exists = await checkActorExistsOnSolana(actorIdParam);
        res.status(200).json({
            exists,
            actor_id: parseInt(actorIdParam, 10),
            message: exists
                ? "Actor exists on Solana"
                : "Actor does not exist on Solana",
        });
    } catch (error: any) {
        console.error("Solana Check Actor Error:", error.message);
        res.status(500).json({
            success: false,
            error: error.message || "Internal server error",
            actor_id: routeParam(req.params.actorId)
                ? parseInt(routeParam(req.params.actorId)!, 10)
                : null,
        });
    }
};

/**
 * @openapi
 * /actors/{actorId}:
 *   get:
 *     summary: Get actor details from Solana
 *     tags: [Actors]
 *     parameters:
 *       - in: path
 *         name: actorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Actor details
 *       404:
 *         description: Actor not found
 *       500:
 *         description: Server error
 */
export const getActor = async (req: Request, res: Response) => {
    try {
        const actorIdParam = routeParam(req.params.actorId);
        if (!actorIdParam) {
            return res.status(400).json({
                success: false,
                error: "actorId parameter is required",
            });
        }
        const actorData = await getActorFromSolana(actorIdParam);
        if (!actorData) {
            return res
                .status(404)
                .json({ success: false, message: "Actor not found on Solana" });
        }
        res.status(200).json({ success: true, actor: actorData });
    } catch (error: any) {
        console.error("Solana Get Actor Error:", error.message);
        res.status(500).json({
            success: false,
            error: error.message || "Internal server error",
            actor_id: routeParam(req.params.actorId)
                ? parseInt(routeParam(req.params.actorId)!, 10)
                : null,
        });
    }
};

/**
 * @openapi
 * /actors:
 *   put:
 *     summary: Update an existing actor on Solana
 *     tags: [Actors]
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
 *               name:
 *                 type: string
 *               roles:
 *                 type: array
 *                 items:
 *                   type: string
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Actor updated
 *       500:
 *         description: Server error
 */
export const updateActor = async (req: Request, res: Response) => {
    try {
        const actorData = req.body;
        const txId = await updateActorOnSolana(actorData);
        res.status(200).json({
            message: "Actor updated on Solana successfully",
            transactionId: txId,
            actor_id: actorData.actor_id,
        });
    } catch (error: any) {
        console.error("Solana Update Actor Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const deleteActor = async (req: Request, res: Response) => {
    try {
        const actorData = req.body;
        const txId = await deleteActorOnSolana(actorData);
        res.status(200).json({
            message: "Actor deleted (deactivated) on Solana successfully",
            transactionId: txId,
            actor_id: actorData.actor_id,
        });
    } catch (error: any) {
        console.error("Solana Delete Actor Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const closeActor = async (req: Request, res: Response) => {
    try {
        const actorData = req.body;
        const txId = await closeActorOnSolana(actorData);
        res.status(200).json({
            message:
                "Actor account closed successfully. Rent returned to authority.",
            transactionId: txId,
            warning:
                "Account has been permanently deleted from Solana blockchain.",
        });
    } catch (error: any) {
        console.error("Solana Close Actor Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};
