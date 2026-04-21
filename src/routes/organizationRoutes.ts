import { Router } from "express";
import * as OrganizationController from "../controllers/OrganizationController.js";
import { verifyHmac } from "../middleware/hmacAuth.js";

const router = Router();

// Organizations (Core Program)
router.post(
    "/submit-organization",
    verifyHmac,
    OrganizationController.submitOrganization,
);
router.post(
    "/update-organization",
    verifyHmac,
    OrganizationController.updateOrganization,
);
router.post(
    "/delete-organization",
    verifyHmac,
    OrganizationController.deleteOrganization,
);

export default router;
