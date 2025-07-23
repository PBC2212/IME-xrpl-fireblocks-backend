
require('dotenv').config();
const express = require('express');
const xrpl = require('xrpl');
const fs = require('fs');
const { FireblocksSDK } = require('fireblocks-sdk');

const app = express();
app.use(express.json());
app.use(require('cors')());

// Fireblocks Setup
const apiSecret = fs.readFileSync(process.env.FIREBLOCKS_API_SECRET_PATH, 'utf8');
const fireblocks = new FireblocksSDK(apiSecret, process.env.FIREBLOCKS_API_KEY);

// XRPL Setup
const client = new xrpl.Client(process.env.XRPL_ENDPOINT);

async function connectXRPL() {
    console.log("🔗 Connecting to XRPL...");
    await client.connect();
    console.log("✅ Connected to XRPL");
}
connectXRPL();

// Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: "Backend is running 🚀" });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🌐 Backend running on port ${PORT}`));
