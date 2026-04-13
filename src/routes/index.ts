import { Router } from "express";
import actorRoutes from "./actorRoutes.js";
import batchRoutes from "./batchRoutes.js";
import tracingRoutes from "./tracingRoutes.js";
import transactionRoutes from "./transactionRoutes.js";
import programRoutes from "./programRoutes.js";

const router = Router();

router.use("/", actorRoutes);
router.use("/", batchRoutes);
router.use("/", tracingRoutes);
router.use("/", transactionRoutes);
router.use("/", programRoutes);

export default router;
