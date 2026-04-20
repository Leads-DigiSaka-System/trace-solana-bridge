import { Router } from "express";
import {
    submitBuyback,
    checkBuyback,
    getBuyback,
    updateInSeason,
    settleBuyback,
    confirmBuybackPayment,
    updatePaymentSchedule,
    markBuybackSettled,
    deleteBuyback,
    closeBuyback,
} from "../controllers/BuybackController.js";
import { verifyHmac } from "../middleware/hmacAuth.js";

const router = Router();

router.post("/submit-buyback", verifyHmac, submitBuyback);
router.get("/check-buyback/:buybackId", checkBuyback);
router.get("/get-buyback/:buybackId", getBuyback);
router.post("/update-in-season", verifyHmac, updateInSeason);
router.post("/settle-buyback", verifyHmac, settleBuyback);
router.post("/confirm-buyback-payment", verifyHmac, confirmBuybackPayment);
router.post("/update-payment-schedule", verifyHmac, updatePaymentSchedule);
router.post("/mark-buyback-settled", verifyHmac, markBuybackSettled);
router.post("/delete-buyback", verifyHmac, deleteBuyback);
router.post("/close-buyback", verifyHmac, closeBuyback);

export default router;
