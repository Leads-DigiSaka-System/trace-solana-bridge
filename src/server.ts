import express, {
    type Express,
    type Request,
    type Response,
    type NextFunction,
} from "express";
import dotenv from "dotenv";
import apiRoutes from "./routes/index.js";
import { checkProgramInitialization } from "./services/ProgramService.js";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swaggerConfig.js";

dotenv.config();

const app: Express = express();

// Capture raw body for HMAC verification before parsing JSON
// This middleware must run BEFORE express.json() to capture the raw request body
app.use((req: Request, res: Response, next: NextFunction) => {
    // Only capture body for POST/PUT/PATCH/DELETE requests
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        let rawBody = "";
        req.on("data", (chunk: Buffer) => {
            rawBody += chunk.toString("utf8");
        });
        req.on("end", () => {
            // Store raw body for HMAC middleware to use
            (req as any).rawBody = rawBody;
            // Manually parse JSON and attach to req.body so routes can use it
            try {
                req.body = rawBody ? JSON.parse(rawBody) : {};
            } catch (e) {
                req.body = {};
            }
            next();
        });
    } else {
        // For GET requests, no body to capture
        next();
    }
});

const PORT = process.env.NODE_SERVICE_PORT || 3000;

// Log HMAC auth status on startup
console.log("========================================");
console.log(
    "HMAC Authentication:",
    process.env.SKIP_HMAC_AUTH === "true" ? "⚠️  DISABLED" : "✅ ENABLED",
);
if (process.env.SKIP_HMAC_AUTH === "true") {
    console.log("WARNING: HMAC auth is disabled. Enable for production!");
}
console.log("========================================");

// --- API ROUTES ---

app.get("/", (req: Request, res: Response) => {
    res.send("Node.js Solana Bridge Service is running.");
});

// Healthy check route
app.get("/health", async (req: Request, res: Response) => {
    try {
        const isInitialized = await checkProgramInitialization();
        res.status(200).json({
            status: "OK",
            solana: isInitialized ? "Connected" : "Disconnected",
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        res.status(500).json({ status: "ERROR", error: error.message });
    }
});

// All other routes
app.use("/api/v1", apiRoutes);

// Swagger Documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
