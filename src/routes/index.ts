import { Router } from "express";
import actorRoutes from "./actorRoutes.js";
import batchRoutes from "./batchRoutes.js";
import tracingRoutes from "./tracingRoutes.js";
import transactionRoutes from "./transactionRoutes.js";
import programRoutes from "./programRoutes.js";
import organizationRoutes from "./organizationRoutes.js";
import validatorRoutes from "./validatorRoutes.js";
import clusterRoutes from "./clusterRoutes.js";
import distributionRoutes from "./distributionRoutes.js";

const router = Router();

router.use("/", actorRoutes);
router.use("/", batchRoutes);
router.use("/", tracingRoutes);
router.use("/", transactionRoutes);
router.use("/", programRoutes);
router.use("/", organizationRoutes);
router.use("/", validatorRoutes);
router.use("/", clusterRoutes);
router.use("/", distributionRoutes);

export default router;
