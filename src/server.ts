import express, {
    type Express,
    type Request,
    type Response,
} from "express";
import dotenv from "dotenv";
import apiRoutes from "./routes/index.js";
import { checkProgramInitialization } from "./services/ProgramService.js";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swaggerConfig.js";

dotenv.config();

const app: Express = express();

// Keep exact, bounded body bytes for HMAC verification. Express rejects
// malformed JSON rather than silently replacing it with an empty object.
app.use(
    express.json({
        limit: process.env.REQUEST_BODY_LIMIT || "256kb",
        verify: (req, _res, buffer) => {
            (req as Request & { rawBody?: string }).rawBody = buffer.toString("utf8");
        },
    }),
);

const PORT = process.env.NODE_SERVICE_PORT || 3000;

// Log HMAC auth status on startup
console.log("========================================");
const hmacBypass =
    process.env.SKIP_HMAC_AUTH === "true" &&
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test");
console.log("HMAC Authentication:", hmacBypass ? "DISABLED (local development only)" : "ENABLED");
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
    console.log(`Server is listening on port... ${PORT}`);
});
