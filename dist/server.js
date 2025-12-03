import express, {} from 'express';
import dotenv from 'dotenv';
import { checkProgramInitialization, submitActorToSolana, checkActorExistsOnSolana, updateActorOnSolana } from './solanaService.js';
dotenv.config();
const app = express();
app.use(express.json());
const PORT = process.env.NODE_SERVICE_PORT || 3000;
// --- API ROUTES ---
app.get('/', (req, res) => {
    res.send('Node.js Solana Bridge Service is running.');
});
// 1. ADMIN CHECK ROUTE (Called synchronously by Laravel POST)
app.get('/api/v1/check-init-status', async (req, res) => {
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
// 2. TRANSACTION SUBMISSION ROUTE (Called asynchronously by Laravel Queue Worker)
app.post('/api/v1/submit-actor', async (req, res) => {
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
app.get('/api/v1/check-actor/:actorId', async (req, res) => {
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
app.post('/api/v1/update-actor', async (req, res) => {
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
// The old test route can remain or be removed.
app.post('/api/v1/test-connection', (req, res) => {
    console.log('Request from Laravel:', req.body);
    res.status(200).json({ status: 'Connected', received: req.body });
});
// --- SERVER START ---
// The app.listen must be at the end, after all routes are defined.
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
//# sourceMappingURL=server.js.map