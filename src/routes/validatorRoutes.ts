import { Router } from "express";
import * as ValidatorController from "../controllers/ValidatorController.js";
import { verifyHmac } from "../middleware/hmacAuth.js";

const router = Router();

// Validators (Core Program)
router.post(
    "/register-validator",
    verifyHmac,
    ValidatorController.registerValidator,
);
router.post(
    "/update-validator",
    verifyHmac,
    ValidatorController.updateValidator,
);
router.post(
    "/deactivate-validator",
    verifyHmac,
    ValidatorController.deactivateValidator,
);

export default router;
