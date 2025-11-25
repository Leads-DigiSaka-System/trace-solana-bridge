import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Node.js Solana Service is running.');
});

app.post('/api/v1/test-connection', (req, res) => {
    console.log('Request from Laravel:', req.body);
    res.status(200).json({ status: 'Connected', received: req.body });
});

app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});