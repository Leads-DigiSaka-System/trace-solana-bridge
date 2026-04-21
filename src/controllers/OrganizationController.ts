import type { Request, Response } from "express";
import * as OrganizationService from "../services/OrganizationService.js";

/**
 * @openapi
 * /organizations/submit:
 *   post:
 *     summary: Submit a new organization to Solana
 *     tags: [Organizations]
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
 *               org_id:
 *                 type: string
 *               name:
 *                 type: string
 *               org_type:
 *                 type: number
 *               province:
 *                 type: string
 *               city:
 *                 type: string
 *               contact_person:
 *                 type: string
 *     responses:
 *       200:
 *         description: Organization submitted
 *       500:
 *         description: Server error
 */
export const submitOrganization = async (req: Request, res: Response) => {
    try {
        const txSig = await OrganizationService.submitOrganizationToSolana(
            req.body,
        );
        res.status(200).json({
            success: true,
            message: "Organization submitted to Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error submitting organization:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /organizations/update:
 *   post:
 *     summary: Update an organization on Solana
 *     tags: [Organizations]
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
 *               org_id:
 *                 type: string
 *               name:
 *                 type: string
 *               contact_person:
 *                 type: string
 *               is_active:
 *                 type: number
 *     responses:
 *       200:
 *         description: Organization updated
 *       500:
 *         description: Server error
 */
export const updateOrganization = async (req: Request, res: Response) => {
    try {
        const txSig = await OrganizationService.updateOrganizationOnSolana(
            req.body,
        );
        res.status(200).json({
            success: true,
            message: "Organization updated on Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error updating organization:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /organizations/delete:
 *   post:
 *     summary: Delete an organization on Solana
 *     tags: [Organizations]
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
 *               org_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Organization deleted
 *       500:
 *         description: Server error
 */
export const deleteOrganization = async (req: Request, res: Response) => {
    try {
        const { org_id } = req.body;
        if (!org_id) {
            return res
                .status(400)
                .json({ success: false, message: "org_id is required" });
        }
        const txSig =
            await OrganizationService.deleteOrganizationOnSolana(org_id);
        res.status(200).json({
            success: true,
            message: "Organization deleted on Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error deleting organization:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};
