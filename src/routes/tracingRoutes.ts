import { Router } from "express";
import {
    submitDrying,
    checkDrying,
    getDrying,
    updateDrying,
    deleteDrying,
    closeDrying,
    submitMilling,
    checkMilling,
    getMilling,
    updateMilling,
    deleteMilling,
    closeMilling,
    submitSeason,
    checkSeason,
    getSeason,
    updateSeason,
    deleteSeason,
    closeSeason,
} from "../controllers/TracingController.js";
import { verifyHmac } from "../middleware/hmacAuth.js";

const router = Router();

// Drying
router.post("/submit-drying", verifyHmac, submitDrying);
router.get("/check-drying/:dryingId", verifyHmac, checkDrying);
router.get("/get-drying/:dryingId", verifyHmac, getDrying);
router.post("/update-drying", verifyHmac, updateDrying);
router.post("/delete-drying", verifyHmac, deleteDrying);
router.post("/close-drying", verifyHmac, closeDrying);

// Milling
router.post("/submit-milling", verifyHmac, submitMilling);
router.get("/check-milling/:millingId", verifyHmac, checkMilling);
router.get("/milling/:millingId", verifyHmac, getMilling);
router.put("/milling/:millingId", verifyHmac, updateMilling);
router.delete("/milling/:millingId", verifyHmac, deleteMilling);
router.delete("/milling/:millingId/close", verifyHmac, closeMilling);

// Season
router.post("/submit-season", verifyHmac, submitSeason);
router.get("/check-season/:seasonId", verifyHmac, checkSeason);
router.get("/get-season/:seasonId", verifyHmac, getSeason);
router.post("/update-season", verifyHmac, updateSeason);
router.post("/delete-season", verifyHmac, deleteSeason);
router.post("/close-season", verifyHmac, closeSeason);

export default router;
