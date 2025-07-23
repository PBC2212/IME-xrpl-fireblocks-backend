require('dotenv').config();
const express = require('express');
const xrpl = require('xrpl');
const { FireblocksSDK } = require('fireblocks-sdk');

const app = express();
app.use(express.json());
app.use(require('cors')());

// Fireblocks Setup - Using string secret from .env instead of file
const fireblocks = new FireblocksSDK(
    process.env.FIREBLOCKS_API_SECRET, 
    process.env.FIREBLOCKS_API_KEY,
    process.env.FIREBLOCKS_BASE_URL
);

// XRPL Setup
const client = new xrpl.Client(process.env.XRPL_ENDPOINT);

// Global variables to track connection status
let xrplConnected = false;
let fireblocksReady = false;

async function connectXRPL() {
    try {
        console.log("🔗 Connecting to XRPL...");
        await client.connect();
        xrplConnected = true;
        console.log("✅ Connected to XRPL Testnet");
    } catch (error) {
        console.error("❌ Failed to connect to XRPL:", error.message);
        xrplConnected = false;
    }
}

async function initializeFireblocks() {
    try {
        console.log("🔗 Initializing Fireblocks SDK...");
        // Test Fireblocks connection by getting vault accounts
        const vaultAccounts = await fireblocks.getVaultAccounts();
        fireblocksReady = true;
        console.log("✅ Fireblocks SDK initialized successfully");
        console.log(`📊 Found ${vaultAccounts.length} vault accounts`);
    } catch (error) {
        console.error("❌ Failed to initialize Fireblocks:", error.message);
        fireblocksReady = false;
    }
}

// Initialize connections
connectXRPL();
initializeFireblocks();

// Health Check Endpoint - Enhanced with connection status
app.get('/api/health', (req, res) => {
    res.json({ 
        status: "Backend is running 🚀",
        services: {
            xrpl: xrplConnected ? "Connected ✅" : "Disconnected ❌",
            fireblocks: fireblocksReady ? "Ready ✅" : "Not Ready ❌"
        },
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Create Wallet Endpoint
app.post('/api/create-wallet', async (req, res) => {
    try {
        const { userId, walletName } = req.body;
        
        if (!userId || !walletName) {
            return res.status(400).json({
                error: "userId and walletName are required"
            });
        }

        console.log(`🏗️ Creating wallet for user: ${userId}`);

        // Create new vault account in Fireblocks
        const vaultAccount = await fireblocks.createVaultAccount(walletName, false);
        
        // Create XRP asset in the vault
        const xrpAsset = await fireblocks.createVaultAsset(vaultAccount.id, 'XRP');
        
        console.log(`✅ Wallet created - Vault ID: ${vaultAccount.id}`);
        
        res.json({
            success: true,
            message: "Wallet created successfully",
            wallet: {
                vaultId: vaultAccount.id,
                walletName: vaultAccount.name,
                xrpAddress: xrpAsset.address,
                assets: [
                    {
                        type: 'XRP',
                        address: xrpAsset.address,
                        balance: '0'
                    }
                ]
            },
            userId: userId
        });

    } catch (error) {
        console.error("❌ Error creating wallet:", error.message);
        res.status(500).json({
            error: "Failed to create wallet",
            details: error.message
        });
    }
});

// Get Wallet Info Endpoint
app.get('/api/wallet/:vaultId', async (req, res) => {
    try {
        const { vaultId } = req.params;
        
        console.log(`📊 Fetching wallet info for vault: ${vaultId}`);
        
        // Get vault account details
        const vaultAccount = await fireblocks.getVaultAccount(vaultId);
        
        // Get all assets in the vault
        const assets = vaultAccount.assets || [];
        
        res.json({
            success: true,
            wallet: {
                vaultId: vaultAccount.id,
                walletName: vaultAccount.name,
                assets: assets.map(asset => ({
                    type: asset.id,
                    address: asset.address,
                    balance: asset.balance || '0',
                    available: asset.available || '0'
                }))
            }
        });

    } catch (error) {
        console.error("❌ Error fetching wallet:", error.message);
        res.status(500).json({
            error: "Failed to fetch wallet",
            details: error.message
        });
    }
});

// Pledge Asset Endpoint (Mint RWA Tokens)
app.post('/api/pledge', async (req, res) => {
    try {
        const { vaultId, assetType, assetAmount, assetDescription } = req.body;
        
        if (!vaultId || !assetType || !assetAmount) {
            return res.status(400).json({
                error: "vaultId, assetType, and assetAmount are required"
            });
        }

        console.log(`🏭 Processing pledge for vault ${vaultId}: ${assetAmount} ${assetType}`);

        // For now, return a placeholder response
        // This will be implemented in the next iteration
        res.json({
            success: true,
            message: "Pledge initiated successfully",
            pledge: {
                vaultId: vaultId,
                assetType: assetType,
                assetAmount: assetAmount,
                description: assetDescription,
                status: "pending",
                txHash: null, // Will be populated when XRPL transaction is submitted
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error("❌ Error processing pledge:", error.message);
        res.status(500).json({
            error: "Failed to process pledge",
            details: error.message
        });
    }
});

// Redeem Asset Endpoint
app.post('/api/redeem', async (req, res) => {
    try {
        const { vaultId, tokenAmount, assetType } = req.body;
        
        if (!vaultId || !tokenAmount || !assetType) {
            return res.status(400).json({
                error: "vaultId, tokenAmount, and assetType are required"
            });
        }

        console.log(`🔄 Processing redemption for vault ${vaultId}: ${tokenAmount} ${assetType} tokens`);

        // Placeholder response - will be implemented fully later
        res.json({
            success: true,
            message: "Redemption initiated successfully",
            redemption: {
                vaultId: vaultId,
                tokenAmount: tokenAmount,
                assetType: assetType,
                status: "pending",
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error("❌ Error processing redemption:", error.message);
        res.status(500).json({
            error: "Failed to process redemption",
            details: error.message
        });
    }
});

// Atomic Swap Endpoint
app.post('/api/swap', async (req, res) => {
    try {
        const { vaultId, fromAsset, toAsset, amount } = req.body;
        
        if (!vaultId || !fromAsset || !toAsset || !amount) {
            return res.status(400).json({
                error: "vaultId, fromAsset, toAsset, and amount are required"
            });
        }

        console.log(`💱 Processing swap for vault ${vaultId}: ${amount} ${fromAsset} → ${toAsset}`);

        // Placeholder response - will be implemented fully later
        res.json({
            success: true,
            message: "Swap initiated successfully",
            swap: {
                vaultId: vaultId,
                fromAsset: fromAsset,
                toAsset: toAsset,
                amount: amount,
                status: "pending",
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error("❌ Error processing swap:", error.message);
        res.status(500).json({
            error: "Failed to process swap",
            details: error.message
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error("🚨 Unhandled error:", error);
    res.status(500).json({
        error: "Internal server error",
        message: error.message
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: "Endpoint not found",
        message: `${req.method} ${req.originalUrl} is not a valid endpoint`
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log("\n🛑 Shutting down gracefully...");
    if (xrplConnected) {
        await client.disconnect();
        console.log("✅ XRPL connection closed");
    }
    process.exit(0);
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🌐 Backend server running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📚 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;