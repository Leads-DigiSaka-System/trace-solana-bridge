import type { Request, Response } from "express";
import * as ClusterService from "../services/ClusterService.js";

/**
 * @openapi
 * /clusters/submit:
 *   post:
 *     summary: Submit a new cluster to Solana
 *     tags: [Clusters]
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
 *               cluster_id:
 *                 type: string
 *               name:
 *                 type: string
 *               province:
 *                 type: string
 *               city:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cluster submitted
 *       500:
 *         description: Server error
 */
export const submitCluster = async (req: Request, res: Response) => {
    try {
        const txSig = await ClusterService.submitClusterToSolana(req.body);
        res.status(200).json({
            success: true,
            message: "Cluster submitted to Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error submitting cluster:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /clusters/add-farmer:
 *   post:
 *     summary: Add a farmer to a cluster on Solana
 *     tags: [Clusters]
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
 *               cluster_id:
 *                 type: string
 *               farmer_actor_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Farmer added to cluster
 *       500:
 *         description: Server error
 */
export const addFarmerToCluster = async (req: Request, res: Response) => {
    try {
        const txSig = await ClusterService.addFarmerToClusterOnSolana(req.body);
        res.status(200).json({
            success: true,
            message: "Farmer added to cluster on Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error adding farmer to cluster:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};
