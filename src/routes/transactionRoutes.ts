import { Router } from "express";
import {
    submitTransaction,
    checkTransaction,
    addTransaction,
    updateTransaction,
    getTransactionStatus,
} from "../controllers/TransactionController.js";
import { verifyHmac } from "../middleware/hmacAuth.js";

const router = Router();

router.post("/submit-transaction", verifyHmac, submitTransaction);
router.post("/add-transaction", verifyHmac, addTransaction);
router.post("/update-transaction", verifyHmac, updateTransaction);
router.get("/check-transaction/:nonce", verifyHmac, checkTransaction);
router.get("/status/:signature", verifyHmac, getTransactionStatus);

export default router;
