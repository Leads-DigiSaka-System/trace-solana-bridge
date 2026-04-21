import { Router } from "express";
import * as ClusterController from "../controllers/ClusterController.js";
import { verifyHmac } from "../middleware/hmacAuth.js";

const router = Router();

// Clusters (Core Program)
router.post("/submit-cluster", verifyHmac, ClusterController.submitCluster);
router.post(
    "/add-farmer-to-cluster",
    verifyHmac,
    ClusterController.addFarmerToCluster,
);

export default router;
