import type { Request, Response } from "express";
import * as ValidatorService from "../services/ValidatorService.js";

/**
 * @openapi
 * /validators/register:
 *   post:
 *     summary: Register a new validator on Solana
 *     tags: [Validators]
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
 *               validator_id:
 *                 type: string
 *               name:
 *                 type: string
 *               assigned_province:
 *                 type: string
 *               assigned_city:
 *                 type: string
 *     responses:
 *       200:
 *         description: Validator registered
 *       500:
 *         description: Server error
 */
export const registerValidator = async (req: Request, res: Response) => {
    try {
        const txSig = await ValidatorService.registerValidatorOnSolana(
            req.body,
        );
        res.status(200).json({
            success: true,
            message: "Validator registered on Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error registering validator:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /validators/update:
 *   post:
 *     summary: Update a validator on Solana
 *     tags: [Validators]
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
 *               validator_id:
 *                 type: string
 *               name:
 *                 type: string
 *               assigned_province:
 *                 type: string
 *               assigned_city:
 *                 type: string
 *               is_active:
 *                 type: number
 *     responses:
 *       200:
 *         description: Validator updated
 *       500:
 *         description: Server error
 */
export const updateValidator = async (req: Request, res: Response) => {
    try {
        const txSig = await ValidatorService.updateValidatorOnSolana(req.body);
        res.status(200).json({
            success: true,
            message: "Validator updated on Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error updating validator:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * @openapi
 * /validators/deactivate:
 *   post:
 *     summary: Deactivate a validator on Solana
 *     tags: [Validators]
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
 *               validator_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Validator deactivated
 *       500:
 *         description: Server error
 */
export const deactivateValidator = async (req: Request, res: Response) => {
    try {
        const { validator_id } = req.body;
        if (!validator_id) {
            return res
                .status(400)
                .json({ success: false, message: "validator_id is required" });
        }
        const txSig =
            await ValidatorService.deactivateValidatorOnSolana(validator_id);
        res.status(200).json({
            success: true,
            message: "Validator deactivated on Solana",
            transaction_signature: txSig,
        });
    } catch (err: any) {
        console.error("Error deactivating validator:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};
