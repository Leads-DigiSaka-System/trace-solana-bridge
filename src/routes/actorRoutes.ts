import { Router } from "express";
import {
    submitActor,
    checkActor,
    getActor,
    updateActor,
    deleteActor,
    closeActor,
} from "../controllers/ActorController.js";
import { verifyHmac } from "../middleware/hmacAuth.js";

const router = Router();

router.post("/submit-actor", verifyHmac, submitActor);
router.get("/check-actor/:actorId", verifyHmac, checkActor);
router.get("/get-actor/:actorId", verifyHmac, getActor);
router.post("/update-actor", verifyHmac, updateActor);
router.post("/delete-actor", verifyHmac, deleteActor);
router.post("/close-actor", verifyHmac, closeActor);

export default router;
