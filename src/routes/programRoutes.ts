import { Router } from "express";
import {
    initializeProgram,
    getStatus,
    getFeePayer,
    closeConfig,
} from "../controllers/ProgramController.js";
import { verifyHmac, logRequest } from "../middleware/hmacAuth.js";

const router = Router();

router.post("/admin/initialize", verifyHmac, initializeProgram);
router.get("/admin/status", logRequest, getStatus);
router.get("/admin/fee-payer", logRequest, getFeePayer);
router.delete("/admin/close", verifyHmac, closeConfig);

export default router;
