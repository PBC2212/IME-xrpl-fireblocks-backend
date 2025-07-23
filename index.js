require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import services
const xrplService = require('./services/xrplService');
const fireblocksService = require('./services/fireblocksService');

// Import controllers
const assetController = require('./controllers/assetController');

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS configuration for Lovable frontend
app.use(cors({
    origin: process.env.FRONTEND_URL || '*', // Configure this for your Lovable app
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`📡 ${req.method} ${req.path} - ${new Date().toISOString()}`);
    next();
});

// Global variables to track service status
let servicesReady = {
    xrpl: false,
    fireblocks: false,
    server: false
};

/**
 * Initialize all services
 */
async function initializeServices() {
    console.log("🚀 Initializing services...");
    
    try {
        // Initialize XRPL Service
        console.log("🔗 Connecting to XRPL...");
        await xrplService.connect();
        servicesReady.xrpl = true;
        console.log("✅ XRPL Service ready");
        
        // Test Fireblocks Service
        console.log("🔥 Testing Fireblocks connection...");
        const fireblocksHealth = await fireblocksService.healthCheck();
        servicesReady.fireblocks = fireblocksHealth.success;
        
        if (servicesReady.fireblocks) {
            console.log("✅ Fireblocks Service ready");
        } else {
            console.warn("⚠️ Fireblocks Service not ready:", fireblocksHealth.error);
        }
        
        servicesReady.server = true;
        console.log("🎉 All services initialized successfully!");
        
    } catch (error) {
        console.error("❌ Failed to initialize services:", error.message);
        servicesReady.server = false;
    }
}

// =============================================================================
// API ROUTES
// =============================================================================

/**
 * Health Check Endpoint - Enhanced with service status
 * GET /api/health
 */
app.get('/api/health', async (req, res) => {
    try {
        // Get detailed service status
        const xrplHealth = servicesReady.xrpl;
        const fireblocksHealth = await fireblocksService.healthCheck();
        
        const healthStatus = {
            status: "Backend is running 🚀",
            services: {
                xrpl: xrplHealth ? "Connected ✅" : "Disconnected ❌",
                fireblocks: fireblocksHealth.success ? "Ready ✅" : "Not Ready ❌"
            },
            environment: {
                nodeEnv: process.env.NODE_ENV || 'development',
                xrplEndpoint: process.env.XRPL_ENDPOINT,
                fireblocksUrl: process.env.FIREBLOCKS_BASE_URL
            },
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: require('./package.json').version || '1.0.0'
        };

        // Determine overall health
        const isHealthy = xrplHealth && fireblocksHealth.success;
        const statusCode = isHealthy ? 200 : 503;

        res.status(statusCode).json({
            success: isHealthy,
            ...healthStatus
        });

    } catch (error) {
        console.error("❌ Health check error:", error.message);
        res.status(503).json({
            success: false,
            status: "Service Unavailable ❌",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Get API Documentation
 * GET /api/docs
 */
app.get('/api/docs', (req, res) => {
    const apiDocs = {
        title: "XRPL Fireblocks Asset Platform API",
        version: "1.0.0",
        description: "Real-World Asset tokenization platform using XRPL and Fireblocks",
        baseUrl: `${req.protocol}://${req.get('host')}/api`,
        endpoints: {
            health: {
                method: "GET",
                path: "/health",
                description: "Check service health and status"
            },
            wallets: {
                create: {
                    method: "POST",
                    path: "/create-wallet",
                    description: "Create new user wallet",
                    body: {
                        userId: "string (required)",
                        walletName: "string (required)"
                    }
                },
                get: {
                    method: "GET",
                    path: "/wallet/:vaultId",
                    description: "Get wallet information and balances"
                },
                list: {
                    method: "GET",
                    path: "/wallets",
                    description: "Get all wallets (admin)"
                },
                transactions: {
                    method: "GET",
                    path: "/wallet/:vaultId/transactions",
                    description: "Get transaction history for wallet"
                }
            },
            assets: {
                pledge: {
                    method: "POST",
                    path: "/pledge",
                    description: "Pledge asset and mint RWA tokens",
                    body: {
                        vaultId: "string (required)",
                        assetType: "string (required)",
                        assetAmount: "number (required)",
                        assetDescription: "string (optional)",
                        tokenSymbol: "string (optional)"
                    }
                },
                redeem: {
                    method: "POST",
                    path: "/redeem",
                    description: "Redeem tokens and release pledged assets",
                    body: {
                        vaultId: "string (required)",
                        tokenAmount: "number (required)",
                        tokenSymbol: "string (optional)",
                        redemptionAddress: "string (optional)"
                    }
                },
                swap: {
                    method: "POST",
                    path: "/swap",
                    description: "Create atomic swap between assets",
                    body: {
                        vaultId: "string (required)",
                        fromAsset: "string (required)",
                        toAsset: "string (required)",
                        amount: "number (required)",
                        exchangeRate: "number (optional)"
                    }
                }
            }
        },
        lovableIntegration: {
            note: "All endpoints return consistent JSON format perfect for Lovable.ai frontend",
            responseFormat: {
                success: "boolean",
                message: "string",
                data: "object",
                timestamp: "ISO string"
            }
        }
    };

    res.json(apiDocs);
});

// =============================================================================
// WALLET MANAGEMENT ROUTES
// =============================================================================

/**
 * Create new user wallet
 * POST /api/create-wallet
 */
app.post('/api/create-wallet', assetController.createWallet);

/**
 * Get wallet information
 * GET /api/wallet/:vaultId
 */
app.get('/api/wallet/:vaultId', assetController.getWallet);

/**
 * Get all wallets (admin endpoint)
 * GET /api/wallets
 */
app.get('/api/wallets', assetController.getAllWallets);

/**
 * Get wallet transaction history
 * GET /api/wallet/:vaultId/transactions
 */
app.get('/api/wallet/:vaultId/transactions', assetController.getTransactionHistory);

// =============================================================================
// ASSET TOKENIZATION ROUTES
// =============================================================================

/**
 * Pledge asset and mint RWA tokens
 * POST /api/pledge
 */
app.post('/api/pledge', assetController.pledgeAsset);

/**
 * Redeem tokens and release pledged assets
 * POST /api/redeem
 */
app.post('/api/redeem', assetController.redeemAsset);

/**
 * Create atomic swap offer
 * POST /api/swap
 */
app.post('/api/swap', assetController.createSwap);

// =============================================================================
// UTILITY ROUTES
// =============================================================================

/**
 * Validate XRPL address
 * GET /api/validate-address/:address
 */
app.get('/api/validate-address/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const isValid = xrplService.isValidAddress(address);
        
        res.json({
            success: true,
            data: {
                address: address,
                isValid: isValid,
                network: isValid ? 'XRPL' : 'invalid'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'VALIDATION_FAILED',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Get network information
 * GET /api/network-info
 */
app.get('/api/network-info', async (req, res) => {
    try {
        const networkInfo = await xrplService.getNetworkInfo();
        
        res.json({
            success: true,
            data: {
                xrpl: networkInfo,
                fireblocks: {
                    environment: 'sandbox',
                    baseUrl: process.env.FIREBLOCKS_BASE_URL
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'NETWORK_INFO_FAILED',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// =============================================================================
// ERROR HANDLING MIDDLEWARE
// =============================================================================

/**
 * Global error handler
 */
app.use((error, req, res, next) => {
    console.error("🚨 Unhandled error:", error);
    
    res.status(error.status || 500).json({
        success: false,
        error: error.code || 'INTERNAL_SERVER_ERROR',
        message: error.message || 'An unexpected error occurred',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
        timestamp: new Date().toISOString()
    });
});

/**
 * 404 handler
 */
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'ENDPOINT_NOT_FOUND',
        message: `${req.method} ${req.originalUrl} is not a valid endpoint`,
        availableEndpoints: [
            'GET /api/health',
            'GET /api/docs',
            'POST /api/create-wallet',
            'GET /api/wallet/:vaultId',
            'POST /api/pledge',
            'POST /api/redeem',
            'POST /api/swap'
        ],
        timestamp: new Date().toISOString()
    });
});

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    
    try {
        // Disconnect from XRPL
        if (servicesReady.xrpl) {
            await xrplService.disconnect();
            console.log("✅ XRPL connection closed");
        }
        
        console.log("✅ Graceful shutdown completed");
        process.exit(0);
    } catch (error) {
        console.error("❌ Error during shutdown:", error.message);
        process.exit(1);
    }
}

// Handle shutdown signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

/**
 * Start the server
 */
async function startServer() {
    try {
        // Initialize services first
        await initializeServices();
        
        // Start HTTP server
        const PORT = process.env.PORT || 5000;
        const server = app.listen(PORT, () => {
            console.log(`\n🌐 ======================================`);
            console.log(`🚀 IME XRPL Fireblocks Backend Server`);
            console.log(`🌐 Running on port ${PORT}`);
            console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
            console.log(`📚 API docs: http://localhost:${PORT}/api/docs`);
            console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`⏰ Started at: ${new Date().toISOString()}`);
            console.log(`🌐 ======================================\n`);
        });

        // Handle server errors
        server.on('error', (error) => {
            console.error('❌ Server error:', error.message);
            process.exit(1);
        });

        return server;
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

// Start the server
startServer();

module.exports = app;