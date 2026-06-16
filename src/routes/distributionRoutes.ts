import { Router } from "express";
import * as DistributionController from "../controllers/DistributionController.js";
import { verifyHmac } from "../middleware/hmacAuth.js";

const router = Router();

// Performance
router.post(
    "/submit-actor-performance",
    verifyHmac,
    DistributionController.submitActorPerformance,
);
router.post(
    "/record-delivery-performance",
    verifyHmac,
    DistributionController.recordDeliveryPerformance,
);

// Distributions
router.post(
    "/submit-distribution",
    verifyHmac,
    DistributionController.submitDistribution,
);
router.post(
    "/update-delivery-status",
    verifyHmac,
    DistributionController.updateDeliveryStatus,
);
router.post("/record-qa", verifyHmac, DistributionController.recordQa);
router.post(
    "/confirm-receipt",
    verifyHmac,
    DistributionController.confirmReceipt,
);
router.post("/link-to-chain", verifyHmac, DistributionController.linkToChain);
router.post(
    "/delete-distribution",
    verifyHmac,
    DistributionController.deleteDistribution,
);

// Checkpoints
router.post(
    "/submit-checkpoint",
    verifyHmac,
    DistributionController.submitCheckpoint,
);
router.post(
    "/delete-checkpoint",
    verifyHmac,
    DistributionController.deleteCheckpoint,
);

export default router;
