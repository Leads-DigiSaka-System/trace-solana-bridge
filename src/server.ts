import express, { type Express, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import { checkProgramInitialization, submitActorToSolana } from './solanaService.js'; 

dotenv.config();

const app: Express = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- API ROUTES ---

app.get('/', (req: Request, res: Response) => {
    res.send('Node.js Solana Bridge Service is running.');
});

// 1. ADMIN CHECK ROUTE (Called synchronously by Laravel POST)
app.get('/api/v1/check-init-status', async (req: Request, res: Response) => {
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

// 2. TRANSACTION SUBMISSION ROUTE (Called asynchronously by Laravel Queue Worker)
app.post('/api/v1/submit-actor', async (req: Request, res: Response) => {
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

// The old test route can remain or be removed.
app.post('/api/v1/test-connection', (req: Request, res: Response) => {
    console.log('Request from Laravel:', req.body);
    res.status(200).json({ status: 'Connected', received: req.body });
});


// --- SERVER START ---
// The app.listen must be at the end, after all routes are defined.
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});