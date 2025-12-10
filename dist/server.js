import express, {} from 'express';
import dotenv from 'dotenv';
import { checkProgramInitialization, submitActorToSolana, checkActorExistsOnSolana, updateActorOnSolana, deleteActorOnSolana, initializeProgramOnSolana, getProgramConfig, getFeePayerPublicKey, closeConfigOnSolana } from './solanaService.js';
import { verifyHmac, logRequest } from './middleware/hmacAuth.js';
dotenv.config();
const app = express();
app.use(express.json());
const PORT = process.env.NODE_SERVICE_PORT || 3000;
// Log HMAC auth status on startup
console.log('========================================');
console.log('HMAC Authentication:', process.env.SKIP_HMAC_AUTH === 'true' ? '⚠️  DISABLED' : '✅ ENABLED');
if (process.env.SKIP_HMAC_AUTH === 'true') {
    console.log('WARNING: HMAC auth is disabled. Enable for production!');
}
console.log('========================================');
// --- API ROUTES ---
// ============================================
// PUBLIC ROUTES (No HMAC required)
// ============================================
app.get('/', (req, res) => {
    res.send('Node.js Solana Bridge Service is running.');
});
// 1. ADMIN CHECK ROUTE (Public - just checks program deployed)
app.get('/api/v1/check-init-status', logRequest, async (req, res) => {
    try {
        const isInitialized = await checkProgramInitialization();
        if (isInitialized) {
            res.json({ status: 'initialized' });
        }
        else {
            // 409 Conflict: Signals that a necessary prerequisite is not met
            res.status(409).json({ status: 'uninitialized', message: 'Solana program is not yet initialized by the admin.' });
        }
    }
    catch (error) {
        console.error('Bridge error during status check:', error.message);
        res.status(503).json({ status: 'error', message: 'Bridge service temporarily unavailable for status check.' });
    }
});
// ============================================
// PROTECTED ROUTES (HMAC required)
// ============================================
// 2. TRANSACTION SUBMISSION ROUTE (Called asynchronously by Laravel Queue Worker)
app.post('/api/v1/submit-actor', verifyHmac, async (req, res) => {
    try {
        const actorData = req.body;
        // Call the service function to build and submit the transaction
        const txId = await submitActorToSolana(actorData);
        // Return the Transaction ID for Laravel to log
        res.status(202).json({
            message: 'Transaction accepted and submitted to Solana.',
            transactionId: txId
        });
    }
    catch (error) {
        console.error('Solana Submission Error:', error.message);
        // 500 status if the submission fails (e.g., network error, invalid instruction)
        res.status(500).json({ success: false, error: error.message });
    }
});
// 3. CHECK ACTOR EXISTS ROUTE (Called synchronously by Laravel PUT)
app.get('/api/v1/check-actor/:actorId', verifyHmac, async (req, res) => {
    try {
        const actorIdParam = req.params.actorId;
        if (!actorIdParam) {
            return res.status(400).json({ success: false, error: 'Actor ID parameter is required' });
        }
        const actorId = parseInt(actorIdParam, 10);
        if (isNaN(actorId)) {
            return res.status(400).json({ success: false, error: 'Invalid actor ID' });
        }
        const exists = await checkActorExistsOnSolana(actorId);
        res.json({
            exists,
            actor_id: actorId
        });
    }
    catch (error) {
        console.error('Error checking actor existence:', {
            message: error.message,
            stack: error.stack,
            actorId: req.params.actorId
        });
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error',
            actor_id: req.params.actorId ? parseInt(req.params.actorId, 10) : null
        });
    }
});
// 4. UPDATE ACTOR ROUTE (Called asynchronously by Laravel Queue Worker)
app.post('/api/v1/update-actor', verifyHmac, async (req, res) => {
    try {
        const actorData = req.body;
        // Call the service function to update the actor
        const txId = await updateActorOnSolana(actorData);
        // Return the Transaction ID for Laravel to log
        res.status(202).json({
            message: 'Actor update accepted and submitted to Solana.',
            transactionId: txId
        });
    }
    catch (error) {
        console.error('Solana Update Error:', error.message);
        // 500 status if the update fails (e.g., network error, invalid instruction, actor doesn't exist)
        res.status(500).json({ success: false, error: error.message });
    }
});
// 5. DELETE ACTOR ROUTE
app.post('/api/v1/delete-actor', verifyHmac, async (req, res) => {
    try {
        const actorData = req.body;
        // Call the service function to delete (deactivate) the actor
        const txId = await deleteActorOnSolana(actorData);
        // Return the Transaction ID for Laravel to log
        res.status(202).json({
            message: 'Actor deletion accepted and submitted to Solana.',
            transactionId: txId
        });
    }
    catch (error) {
        console.error('Solana Delete Error:', error.message);
        // 500 status if the deletion fails (e.g., network error, invalid instruction, actor doesn't exist)
        res.status(500).json({ success: false, error: error.message });
    }
});
// Test connection route (protected)
app.post('/api/v1/test-connection', verifyHmac, (req, res) => {
    console.log('Request from Laravel:', req.body);
    res.status(200).json({ status: 'Connected', received: req.body });
});
// ============================================
// ADMIN ROUTES
// ============================================
// Initialize program (one-time setup) - Creates ProgramConfig account (PROTECTED)
app.post('/api/v1/admin/initialize', verifyHmac, async (req, res) => {
    try {
        console.log('========================================');
        console.log('ADMIN: Initialize Program Request');
        console.log('========================================');
        // First check if already initialized
        const config = await getProgramConfig();
        if (config.isInitialized) {
            console.log('Program already initialized');
            return res.status(409).json({
                success: false,
                error: 'Program is already initialized',
                config: {
                    isInitialized: config.isInitialized,
                    superAdmin: config.superAdmin,
                    initializedAt: config.initializedAt,
                    initializedAtFormatted: config.initializedAt
                        ? new Date(config.initializedAt * 1000).toISOString()
                        : null,
                    configPda: config.configPda,
                }
            });
        }
        // Initialize the program
        const txId = await initializeProgramOnSolana();
        console.log('Program initialized successfully, transaction:', txId);
        res.status(201).json({
            success: true,
            message: 'Program initialized successfully',
            transactionId: txId,
            superAdmin: getFeePayerPublicKey(),
        });
    }
    catch (error) {
        console.error('Program initialization error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Get program initialization status (PUBLIC - informational only)
app.get('/api/v1/admin/status', logRequest, async (req, res) => {
    try {
        console.log('ADMIN: Checking program status...');
        const config = await getProgramConfig();
        console.log('Program status:', config);
        res.json({
            success: true,
            isInitialized: config.isInitialized,
            superAdmin: config.superAdmin,
            initializedAt: config.initializedAt,
            initializedAtFormatted: config.initializedAt
                ? new Date(config.initializedAt * 1000).toISOString()
                : null,
            configPda: config.configPda,
            feePayerPublicKey: getFeePayerPublicKey(),
        });
    }
    catch (error) {
        console.error('Error fetching program status:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Get fee payer info (PUBLIC - informational only)
app.get('/api/v1/admin/fee-payer', logRequest, async (req, res) => {
    try {
        res.json({
            success: true,
            publicKey: getFeePayerPublicKey(),
            message: 'This is the public key that will be set as super_admin upon initialization'
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Close program config (un-initialize) - FOR TESTING ONLY (PROTECTED)
app.delete('/api/v1/admin/close', verifyHmac, async (req, res) => {
    try {
        console.log('========================================');
        console.log('ADMIN: Close Config Request (Un-initialize)');
        console.log('WARNING: This is for testing purposes only');
        console.log('========================================');
        // First check if initialized
        const config = await getProgramConfig();
        if (!config.isInitialized) {
            return res.status(400).json({
                success: false,
                error: 'Program is not initialized. Nothing to close.',
                config: config
            });
        }
        // Close the config
        const txId = await closeConfigOnSolana();
        console.log('Program config closed successfully, transaction:', txId);
        res.status(200).json({
            success: true,
            message: 'Program config closed successfully. Program is now un-initialized.',
            transactionId: txId,
            warning: 'The program must be re-initialized before it can be used again.'
        });
    }
    catch (error) {
        console.error('Close config error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// --- SERVER START ---
// The app.listen must be at the end, after all routes are defined.
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
//# sourceMappingURL=server.js.map