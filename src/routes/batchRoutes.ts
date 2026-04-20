import { Router } from "express";
import {
    submitBatch,
    checkBatch,
    getBatch,
    updateBatch,
    deleteBatch,
    closeBatch,
} from "../controllers/BatchController.js";
import { verifyHmac } from "../middleware/hmacAuth.js";

const router = Router();

router.post("/submit-batch", verifyHmac, submitBatch);
router.get("/check-batch/:batchId", verifyHmac, checkBatch);
router.get("/get-batch/:batchId", verifyHmac, getBatch);
router.post("/update-batch", verifyHmac, updateBatch);
router.post("/delete-batch", verifyHmac, deleteBatch);
router.post("/close-batch", verifyHmac, closeBatch);

export default router;
