import { Router } from "express";
import {
    submitTransaction,
    checkTransaction,
} from "../controllers/TransactionController.js";
import { verifyHmac } from "../middleware/hmacAuth.js";

const router = Router();

router.post("/submit-transaction", verifyHmac, submitTransaction);
router.get("/check-transaction/:nonce", verifyHmac, checkTransaction);

export default router;
