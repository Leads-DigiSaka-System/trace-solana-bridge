import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import dotenv from 'dotenv';
import { 
    checkProgramInitialization, 
    submitActorToSolana, 
    checkActorExistsOnSolana,
    getActorFromSolana,
    updateActorOnSolana, 
    deleteActorOnSolana,
    closeActorOnSolana,
    // Batch functions
    submitBatchToSolana,
    checkBatchExistsOnSolana,
    getBatchFromSolana,
    updateBatchOnSolana,
    deleteBatchOnSolana,
    closeBatchOnSolana,
    // Drying functions
    submitDryingToSolana,
    checkDryingExistsOnSolana,
    getDryingFromSolana,
    updateDryingOnSolana,
    deleteDryingOnSolana,
    closeDryingOnSolana,
    // Milling functions
    submitMillingToSolana,
    checkMillingExistsOnSolana,
    getMillingFromSolana,
    updateMillingOnSolana,
    deleteMillingOnSolana,
    closeMillingOnSolana,
    // Season functions
    submitSeasonToSolana,
    checkSeasonExistsOnSolana,
    getSeasonFromSolana,
    updateSeasonOnSolana,
    deleteSeasonOnSolana,
    closeSeasonOnSolana,
    // Transaction functions
    submitTransactionToSolana,
    checkTransactionExistsOnSolana,
    // Admin functions
    initializeProgramOnSolana,
    getProgramConfig,
    getFeePayerPublicKey,
    closeConfigOnSolana
} from './solanaService.js';
import { verifyHmac, logRequest } from './middleware/hmacAuth.js';

dotenv.config();

const app: Express = express();

// Capture raw body for HMAC verification before parsing JSON
// This middleware must run BEFORE express.json() to capture the raw request body
app.use((req: Request, res: Response, next: NextFunction) => {
    // Only capture body for POST/PUT/PATCH requests
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        let rawBody = '';
        req.on('data', (chunk: Buffer) => {
            rawBody += chunk.toString('utf8');
        });
        req.on('end', () => {
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

// Note: We're NOT using express.json() here because we manually parse in the middleware above
// This ensures we have access to the raw body for HMAC verification

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

app.get('/', (req: Request, res: Response) => {
    res.send('Node.js Solana Bridge Service is running.');
});

// 1. ADMIN CHECK ROUTE (Public - just checks program deployed)
app.get('/api/v1/check-init-status', logRequest, async (req: Request, res: Response) => {
    try {
        const isInitialized = await checkProgramInitialization(); 
        
        if (isInitialized) {
            res.json({ status: 'initialized' });
        } else {
            // 409 Conflict: Signals that a necessary prerequisite is not met
            res.status(409).json({ status: 'uninitialized', message: 'Solana program is not yet initialized by the admin.' });
        }
    } catch (error: any) {
        console.error('Bridge error during status check:', error.message);
        res.status(503).json({ status: 'error', message: 'Bridge service temporarily unavailable for status check.' });
    }
});

// ============================================
// PROTECTED ROUTES (HMAC required)
// ============================================

// 2. TRANSACTION SUBMISSION ROUTE (Called asynchronously by Laravel Queue Worker)
app.post('/api/v1/submit-actor', verifyHmac, async (req: Request, res: Response) => {
    try {
        const actorData = req.body; 
        
        // Call the service function to build and submit the transaction
        const txId = await submitActorToSolana(actorData); 
        
        // Return the Transaction ID for Laravel to log
        res.status(202).json({ 
            message: 'Transaction accepted and submitted to Solana.', 
            transactionId: txId 
        });
    } catch (error: any) {
        console.error('Solana Submission Error:', error.message);
        // 500 status if the submission fails (e.g., network error, invalid instruction)
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. CHECK ACTOR EXISTS ROUTE (Called synchronously by Laravel PUT)
app.get('/api/v1/check-actor/:actorId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const actorIdParam = req.params.actorId;
        
        if (!actorIdParam) {
            return res.status(400).json({ success: false, error: 'Actor ID parameter is required' });
        }
        
        // CRITICAL: Don't use parseInt() for large numbers - it loses precision
        // Pass the string directly to checkActorExistsOnSolana - BN handles strings correctly
        // Validate it's a numeric string
        if (!/^\d+$/.test(actorIdParam)) {
            return res.status(400).json({ success: false, error: 'Invalid actor ID format. Must be a numeric string.' });
        }
        
        // Pass as string to preserve precision for large u64 values
        const exists = await checkActorExistsOnSolana(actorIdParam);
        
        res.json({ 
            exists,
            actor_id: actorIdParam // Return as string to preserve precision
        });
    } catch (error: any) {
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

// 7. GET ACTOR DETAILS ROUTE
app.get('/api/v1/get-actor/:actorId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const actorIdParam = req.params.actorId;
        
        if (!actorIdParam) {
            return res.status(400).json({ success: false, error: 'Actor ID parameter is required' });
        }
        
        const actorId = parseInt(actorIdParam, 10);
        
        if (isNaN(actorId)) {
            return res.status(400).json({ success: false, error: 'Invalid actor ID' });
        }
        
        const actor = await getActorFromSolana(actorId);
        
        if (!actor) {
            return res.status(404).json({ 
                success: false, 
                error: 'Actor not found on Solana',
                actor_id: actorId
            });
        }
        
        res.json({ 
            success: true,
            actor,
            actor_id: actorId
        });
    } catch (error: any) {
        console.error('Error fetching actor:', {
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
app.post('/api/v1/update-actor', verifyHmac, async (req: Request, res: Response) => {
    try {
        const actorData = req.body; 
        
        // Call the service function to update the actor
        const txId = await updateActorOnSolana(actorData); 
        
        // Return the Transaction ID for Laravel to log
        res.status(202).json({ 
            message: 'Actor update accepted and submitted to Solana.', 
            transactionId: txId 
        });
    } catch (error: any) {
        console.error('Solana Update Error:', error.message);
        // 500 status if the update fails (e.g., network error, invalid instruction, actor doesn't exist)
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. DELETE ACTOR ROUTE
app.post('/api/v1/delete-actor', verifyHmac, async (req: Request, res: Response) => {
    try {
        const actorData = req.body; 
        
        // Call the service function to delete (deactivate) the actor
        const txId = await deleteActorOnSolana(actorData); 
        
        // Return the Transaction ID for Laravel to log
        res.status(202).json({ 
            message: 'Actor deletion accepted and submitted to Solana.', 
            transactionId: txId 
        });
    } catch (error: any) {
        console.error('Solana Delete Error:', error.message);
        // 500 status if the deletion fails (e.g., network error, invalid instruction, actor doesn't exist)
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. CLOSE ACTOR ROUTE (permanently remove account, return rent)
app.post('/api/v1/close-actor', verifyHmac, async (req: Request, res: Response) => {
    try {
        const actorData = req.body; 
        
        // Call the service function to close (permanently delete) the actor account
        const txId = await closeActorOnSolana(actorData); 
        
        // Return the Transaction ID for Laravel to log
        res.status(200).json({ 
            message: 'Actor account closed successfully. Rent returned to authority.', 
            transactionId: txId,
            warning: 'Account has been permanently deleted from Solana blockchain.'
        });
    } catch (error: any) {
        console.error('Solana Close Actor Error:', error.message);
        // 500 status if the close fails (e.g., network error, invalid instruction, actor doesn't exist)
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test connection route (protected)
app.post('/api/v1/test-connection', verifyHmac, (req: Request, res: Response) => {
    console.log('Request from Laravel:', req.body);
    res.status(200).json({ status: 'Connected', received: req.body });
});

// ============================================
// RICE BATCH ROUTES (PROTECTED)
// ============================================

// Submit a new batch to Solana
app.post('/api/v1/submit-batch', verifyHmac, async (req: Request, res: Response) => {
    try {
        const batchData = req.body;
        
        const txId = await submitBatchToSolana(batchData);
        
        res.status(202).json({
            message: 'Batch accepted and submitted to Solana.',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Batch Submission Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if batch exists on Solana
app.get('/api/v1/check-batch/:batchId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const batchIdParam = req.params.batchId;
        
        if (!batchIdParam) {
            return res.status(400).json({ success: false, error: 'Batch ID parameter is required' });
        }
        
        if (!/^\d+$/.test(batchIdParam)) {
            return res.status(400).json({ success: false, error: 'Invalid batch ID format. Must be a numeric string.' });
        }
        
        const exists = await checkBatchExistsOnSolana(batchIdParam);
        
        res.json({
            exists,
            batch_id: batchIdParam
        });
    } catch (error: any) {
        console.error('Error checking batch existence:', {
            message: error.message,
            stack: error.stack,
            batchId: req.params.batchId
        });
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error',
            batch_id: req.params.batchId
        });
    }
});

// Get batch details from Solana
app.get('/api/v1/get-batch/:batchId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const batchIdParam = req.params.batchId;
        
        if (!batchIdParam) {
            return res.status(400).json({ success: false, error: 'Batch ID parameter is required' });
        }
        
        if (!/^\d+$/.test(batchIdParam)) {
            return res.status(400).json({ success: false, error: 'Invalid batch ID format. Must be a numeric string.' });
        }
        
        const batch = await getBatchFromSolana(batchIdParam);
        
        if (!batch) {
            return res.status(404).json({
                success: false,
                error: 'Batch not found on Solana',
                batch_id: batchIdParam
            });
        }
        
        res.json({
            success: true,
            batch,
            batch_id: batchIdParam
        });
    } catch (error: any) {
        console.error('Error fetching batch:', {
            message: error.message,
            stack: error.stack,
            batchId: req.params.batchId
        });
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error',
            batch_id: req.params.batchId
        });
    }
});

// Update batch on Solana
app.post('/api/v1/update-batch', verifyHmac, async (req: Request, res: Response) => {
    try {
        const batchData = req.body;
        
        const txId = await updateBatchOnSolana(batchData);
        
        res.status(202).json({
            message: 'Batch update accepted and submitted to Solana.',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Batch Update Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete (soft delete) batch on Solana
app.post('/api/v1/delete-batch', verifyHmac, async (req: Request, res: Response) => {
    try {
        const batchData = req.body;
        
        const txId = await deleteBatchOnSolana(batchData);
        
        res.status(202).json({
            message: 'Batch deletion accepted and submitted to Solana.',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Batch Delete Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Close batch account (permanently remove, return rent)
app.post('/api/v1/close-batch', verifyHmac, async (req: Request, res: Response) => {
    try {
        const batchData = req.body;
        
        const txId = await closeBatchOnSolana(batchData);
        
        res.status(200).json({
            message: 'Batch account closed successfully. Rent returned to authority.',
            transactionId: txId,
            warning: 'Account has been permanently deleted from Solana blockchain.'
        });
    } catch (error: any) {
        console.error('Solana Close Batch Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// DRYING ROUTES
// ============================================

// Submit a new drying record to Solana
app.post('/api/v1/submit-drying', verifyHmac, async (req: Request, res: Response) => {
    try {
        const dryingData = req.body;
        
        const txId = await submitDryingToSolana(dryingData);
        
        res.status(201).json({
            message: 'Drying submitted to Solana successfully',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Submit Drying Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if drying exists on Solana
app.get('/api/v1/check-drying/:dryingId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const dryingIdParam = req.params.dryingId;
        
        if (!dryingIdParam) {
            return res.status(400).json({ 
                success: false, 
                error: 'dryingId parameter is required' 
            });
        }

        const result = await checkDryingExistsOnSolana(dryingIdParam);
        
        if (result.exists) {
            res.status(200).json({
                exists: true,
                drying_id: dryingIdParam,
                pda: result.pda,
                message: 'Drying exists on Solana'
            });
        } else {
            res.status(200).json({
                exists: false,
                drying_id: dryingIdParam,
                message: 'Drying does not exist on Solana'
            });
        }
    } catch (error: any) {
        console.error('Solana Check Drying Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get drying details from Solana
app.get('/api/v1/get-drying/:dryingId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const dryingIdParam = req.params.dryingId;
        
        if (!dryingIdParam) {
            return res.status(400).json({ 
                success: false, 
                error: 'dryingId parameter is required' 
            });
        }

        // First check if drying exists
        const existsResult = await checkDryingExistsOnSolana(dryingIdParam);
        if (!existsResult.exists) {
            return res.status(404).json({
                success: false,
                error: `Drying ${dryingIdParam} not found on Solana`
            });
        }

        // Fetch drying data
        const dryingData = await getDryingFromSolana(dryingIdParam);
        
        res.status(200).json({
            success: true,
            drying: dryingData
        });
    } catch (error: any) {
        console.error('Solana Get Drying Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update drying on Solana
app.post('/api/v1/update-drying', verifyHmac, async (req: Request, res: Response) => {
    try {
        const dryingData = req.body;
        
        const txId = await updateDryingOnSolana(dryingData);
        
        res.status(200).json({
            message: 'Drying updated on Solana successfully',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Update Drying Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete (soft delete) drying on Solana
app.post('/api/v1/delete-drying', verifyHmac, async (req: Request, res: Response) => {
    try {
        const dryingData = req.body;
        
        const txId = await deleteDryingOnSolana(dryingData);
        
        res.status(200).json({
            message: 'Drying deleted (deactivated) on Solana successfully',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Delete Drying Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Close drying account (permanently remove, return rent)
app.post('/api/v1/close-drying', verifyHmac, async (req: Request, res: Response) => {
    try {
        const dryingData = req.body;
        
        const txId = await closeDryingOnSolana(dryingData);
        
        res.status(200).json({
            message: 'Drying account closed successfully. Rent returned to authority.',
            transactionId: txId,
            warning: 'Account has been permanently deleted from Solana blockchain.'
        });
    } catch (error: any) {
        console.error('Solana Close Drying Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// MILLING ROUTES
// ============================================

// Submit a new milling record to Solana
app.post('/api/v1/submit-milling', verifyHmac, async (req: Request, res: Response) => {
    try {
        const millingData = req.body;
        
        const txId = await submitMillingToSolana(millingData);
        
        res.status(201).json({
            message: 'Milling submitted to Solana successfully',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Submit Milling Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if milling exists on Solana
app.get('/api/v1/check-milling/:millingId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const millingIdParam = req.params.millingId;
        
        if (!millingIdParam) {
            return res.status(400).json({ 
                success: false, 
                error: 'millingId parameter is required' 
            });
        }

        const result = await checkMillingExistsOnSolana(millingIdParam);
        
        if (result.exists) {
            return res.status(200).json({
                exists: true,
                pda: result.pda,
                message: 'Milling exists on Solana'
            });
        } else {
            return res.status(404).json({
                exists: false,
                message: 'Milling does not exist on Solana'
            });
        }
    } catch (error: any) {
        console.error('Solana Check Milling Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get milling data from Solana
app.get('/api/v1/milling/:millingId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const millingIdParam = req.params.millingId;
        
        if (!millingIdParam) {
            return res.status(400).json({ 
                success: false, 
                error: 'millingId parameter is required' 
            });
        }

        // First check if milling exists
        const existsResult = await checkMillingExistsOnSolana(millingIdParam);
        
        if (!existsResult.exists) {
            return res.status(404).json({
                success: false,
                exists: false,
                error: `Milling ${millingIdParam} does not exist on Solana`
            });
        }

        // Fetch the milling data
        const millingData = await getMillingFromSolana(millingIdParam);
        
        return res.status(200).json({
            success: true,
            milling: millingData
        });
    } catch (error: any) {
        console.error('Solana Get Milling Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update a milling record on Solana
app.put('/api/v1/milling/:millingId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const millingIdParam = req.params.millingId;
        const updateData = req.body;
        
        if (!millingIdParam) {
            return res.status(400).json({ 
                success: false, 
                error: 'millingId parameter is required' 
            });
        }

        // Add milling_id to update data
        updateData.milling_id = millingIdParam;
        
        const txId = await updateMillingOnSolana(updateData);
        
        res.status(200).json({
            message: 'Milling updated on Solana successfully',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Update Milling Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Soft delete a milling record on Solana (set is_active = 0)
app.delete('/api/v1/milling/:millingId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const millingIdParam = req.params.millingId;
        
        if (!millingIdParam) {
            return res.status(400).json({ 
                success: false, 
                error: 'millingId parameter is required' 
            });
        }

        const millingData = { milling_id: millingIdParam };
        
        const txId = await deleteMillingOnSolana(millingData);
        
        res.status(200).json({
            message: 'Milling soft deleted on Solana successfully (is_active = 0)',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Delete Milling Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Close milling account on Solana (permanently delete)
app.delete('/api/v1/milling/:millingId/close', verifyHmac, async (req: Request, res: Response) => {
    try {
        const millingIdParam = req.params.millingId;
        
        if (!millingIdParam) {
            return res.status(400).json({ 
                success: false, 
                error: 'millingId parameter is required' 
            });
        }

        const millingData = { milling_id: millingIdParam };
        
        const txId = await closeMillingOnSolana(millingData);
        
        res.status(200).json({
            message: 'Milling account closed successfully. Rent returned to authority.',
            transactionId: txId,
            warning: 'Account has been permanently deleted from Solana blockchain.'
        });
    } catch (error: any) {
        console.error('Solana Close Milling Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// PRODUCTION SEASON ROUTES
// ============================================

// Submit a new production season to Solana
app.post('/api/v1/submit-season', verifyHmac, async (req: Request, res: Response) => {
    try {
        const seasonData = req.body;
        
        const txId = await submitSeasonToSolana(seasonData);
        
        res.status(201).json({
            message: 'Season submitted to Solana successfully',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Submit Season Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if season exists on Solana
app.get('/api/v1/check-season/:seasonId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const seasonIdParam = req.params.seasonId;
        
        if (!seasonIdParam) {
            return res.status(400).json({ 
                success: false, 
                error: 'seasonId parameter is required' 
            });
        }

        const result = await checkSeasonExistsOnSolana(seasonIdParam);
        
        if (result.exists) {
            res.status(200).json({
                exists: true,
                season_id: seasonIdParam,
                pda: result.pda,
                message: 'Season exists on Solana'
            });
        } else {
            res.status(200).json({
                exists: false,
                season_id: seasonIdParam,
                message: 'Season does not exist on Solana'
            });
        }
    } catch (error: any) {
        console.error('Solana Check Season Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get season details from Solana
app.get('/api/v1/get-season/:seasonId', verifyHmac, async (req: Request, res: Response) => {
    try {
        const seasonIdParam = req.params.seasonId;
        
        if (!seasonIdParam) {
            return res.status(400).json({ 
                success: false, 
                error: 'seasonId parameter is required' 
            });
        }

        // First check if season exists
        const existsResult = await checkSeasonExistsOnSolana(seasonIdParam);
        if (!existsResult.exists) {
            return res.status(404).json({
                success: false,
                error: `Season ${seasonIdParam} not found on Solana`
            });
        }

        // Fetch season data
        const seasonData = await getSeasonFromSolana(seasonIdParam);
        
        res.status(200).json({
            success: true,
            season: seasonData
        });
    } catch (error: any) {
        console.error('Solana Get Season Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update season on Solana
app.post('/api/v1/update-season', verifyHmac, async (req: Request, res: Response) => {
    try {
        const seasonData = req.body;
        
        const txId = await updateSeasonOnSolana(seasonData);
        
        res.status(200).json({
            message: 'Season updated on Solana successfully',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Update Season Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete (soft delete) season on Solana
app.post('/api/v1/delete-season', verifyHmac, async (req: Request, res: Response) => {
    try {
        const seasonData = req.body;
        
        const txId = await deleteSeasonOnSolana(seasonData);
        
        res.status(200).json({
            message: 'Season deleted (deactivated) on Solana successfully',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Delete Season Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Close season account (permanently remove, return rent)
app.post('/api/v1/close-season', verifyHmac, async (req: Request, res: Response) => {
    try {
        const seasonData = req.body;
        
        const txId = await closeSeasonOnSolana(seasonData);
        
        res.status(200).json({
            message: 'Season account closed successfully. Rent returned to authority.',
            transactionId: txId,
            warning: 'Account has been permanently deleted from Solana blockchain.'
        });
    } catch (error: any) {
        console.error('Solana Close Season Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// TRANSACTION ROUTES (PROTECTED)
// ============================================

// Submit a new transaction to Solana
app.post('/api/v1/submit-transaction', verifyHmac, async (req: Request, res: Response) => {
    try {
        const transactionData = req.body;
        
        const txId = await submitTransactionToSolana(transactionData);
        
        res.status(201).json({
            message: 'Transaction submitted to Solana successfully',
            transactionId: txId
        });
    } catch (error: any) {
        console.error('Solana Submit Transaction Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if transaction exists on Solana by nonce
app.get('/api/v1/check-transaction/:nonce', verifyHmac, async (req: Request, res: Response) => {
    try {
        const nonceParam = req.params.nonce;
        
        if (!nonceParam) {
            return res.status(400).json({ 
                success: false, 
                error: 'nonce parameter is required' 
            });
        }

        const nonceNum = parseInt(nonceParam, 10);
        if (isNaN(nonceNum) || nonceNum < 0 || nonceNum > 255) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid nonce format. Must be a u8 (0-255)' 
            });
        }

        const exists = await checkTransactionExistsOnSolana(nonceNum);
        
        res.json({
            exists,
            nonce: nonceNum,
            message: exists ? 'Transaction exists on Solana' : 'Transaction does not exist on Solana'
        });
    } catch (error: any) {
        console.error('Error checking transaction existence:', {
            message: error.message,
            stack: error.stack,
            nonce: req.params.nonce
        });
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error',
            nonce: req.params.nonce
        });
    }
});

// ============================================
// ADMIN ROUTES
// ============================================

// Initialize program (one-time setup) - Creates ProgramConfig account (PROTECTED)
app.post('/api/v1/admin/initialize', verifyHmac, async (req: Request, res: Response) => {
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
    } catch (error: any) {
        console.error('Program initialization error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get program initialization status (PUBLIC - informational only)
app.get('/api/v1/admin/status', logRequest, async (req: Request, res: Response) => {
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
    } catch (error: any) {
        console.error('Error fetching program status:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get fee payer info (PUBLIC - informational only)
app.get('/api/v1/admin/fee-payer', logRequest, async (req: Request, res: Response) => {
    try {
        res.json({
            success: true,
            publicKey: getFeePayerPublicKey(),
            message: 'This is the public key that will be set as super_admin upon initialization'
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Close program config (un-initialize) - FOR TESTING ONLY (PROTECTED)
app.delete('/api/v1/admin/close', verifyHmac, async (req: Request, res: Response) => {
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
    } catch (error: any) {
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