import express, {} from "express";
import dotenv from "dotenv";
import apiRoutes from "./routes/index.js";
import { checkProgramInitialization } from "./services/ProgramService.js";
dotenv.config();
const app = express();
// Capture raw body for HMAC verification before parsing JSON
// This middleware must run BEFORE express.json() to capture the raw request body
app.use((req, res, next) => {
    // Only capture body for POST/PUT/PATCH/DELETE requests
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        let rawBody = "";
        req.on("data", (chunk) => {
            rawBody += chunk.toString("utf8");
        });
        req.on("end", () => {
            // Store raw body for HMAC middleware to use
            req.rawBody = rawBody;
            // Manually parse JSON and attach to req.body so routes can use it
            try {
                req.body = rawBody ? JSON.parse(rawBody) : {};
            }
            catch (e) {
                req.body = {};
            }
            next();
        });
    }
    else {
        // For GET requests, no body to capture
        next();
    }
});
const PORT = process.env.NODE_SERVICE_PORT || 3000;
// Log HMAC auth status on startup
console.log("========================================");
console.log("HMAC Authentication:", process.env.SKIP_HMAC_AUTH === "true" ? "⚠️  DISABLED" : "✅ ENABLED");
if (process.env.SKIP_HMAC_AUTH === "true") {
    console.log("WARNING: HMAC auth is disabled. Enable for production!");
}
console.log("========================================");
// --- API ROUTES ---
app.get("/", (req, res) => {
    res.send("Node.js Solana Bridge Service is running.");
});
// Healthy check route
app.get("/health", async (req, res) => {
    try {
        const isInitialized = await checkProgramInitialization();
        res.status(200).json({
            status: "OK",
            solana: isInitialized ? "Connected" : "Disconnected",
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        res.status(500).json({ status: "ERROR", error: error.message });
    }
});
// All other routes
app.use("/api/v1", apiRoutes);
// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
//# sourceMappingURL=server.js.map