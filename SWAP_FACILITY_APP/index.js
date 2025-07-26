/**
 * IME RWA Swap Facility - Main Entry Point
 * Swap platform for existing RWA tokens → XRP/USDT/Crypto
 * 
 * Features:
 * - Swap existing RWA tokens for liquid crypto at discount rates
 * - Hummingbot integration for automated liquidity provision
 * - Oracle validation of RWA token authenticity and valuation
 * - Atomic XRPL-native swaps with no custody requirements
 * - Optional Fireblocks integration for enterprise liquidity sourcing
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
require('dotenv').config();

// Import core services
const OracleService = require('./services/oracleService');
const SwapEngine = require('./services/swapEngine');
const HummingbotService = require('./services/hummingbotService');
const FireblocksService = require('./services/fireblocksService');
const DexRouter = require('./services/dexRouter');
const FeeManager = require('./services/feeManager');

// Import routes
const swapRoutes = require('./routes/swapRoutes');
const oracleRoutes = require('./routes/oracleRoutes');
const hummingbotRoutes = require('./routes/hummingbotRoutes');
const healthRoutes = require('./routes/healthRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(helmet()); // Security headers
app.use(compression()); // Gzip compression
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize services
let oracleService, swapEngine, hummingbotService, fireblocksService, dexRouter, feeManager;

async function initializeServices() {
    try {
        console.log('🚀 Initializing IME RWA Swap Facility...');
        
        // Initialize Oracle Service (for RWA token validation only)
        oracleService = new OracleService({
            xrplClient: process.env.XRPL_CLIENT,
            oracleWallet: {
                seed: process.env.ORACLE_WALLET_SEED,
                address: process.env.ORACLE_WALLET_ADDRESS
            },
            validationOnly: true // Only validate existing RWA tokens, don't mint
        });
        await oracleService.initialize();
        console.log('✅ Oracle Service initialized (validation mode)');

        // Initialize DEX Router
        dexRouter = new DexRouter({
            xrplClient: process.env.XRPL_CLIENT,
            enableAMM: process.env.ENABLE_AMM === 'true',
            enableOrderBook: process.env.ENABLE_ORDER_BOOK === 'true'
        });
        await dexRouter.initialize();
        console.log('✅ DEX Router initialized');

        // Initialize Hummingbot Service (optional for liquidity provision)
        if (process.env.HUMMINGBOT_ENABLED !== 'false') {
            try {
                hummingbotService = new HummingbotService({
                    hummingbotApiUrl: process.env.HUMMINGBOT_API_URL || 'http://localhost:8080',
                    apiKey: process.env.HUMMINGBOT_API_KEY,
                    strategies: ['rwa_market_making', 'cross_exchange_arbitrage'],
                    enableAutoLiquidity: process.env.ENABLE_AUTO_LIQUIDITY !== 'false',
                    hummingbotPath: process.env.HUMMINGBOT_PATH || '/hummingbot'
                });
                await hummingbotService.initialize();
                console.log('✅ Hummingbot Service initialized');
            } catch (error) {
                console.log('⚠️  Hummingbot Service disabled - not installed or configured');
                hummingbotService = null;
            }
        } else {
            console.log('⚠️  Hummingbot Service disabled via configuration');
            hummingbotService = null;
        }

        // Initialize Fee Manager
        feeManager = new FeeManager({
            platformFeePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT) || 2.5,
            feeWallet: process.env.FEE_WALLET_ADDRESS,
            minimumFee: parseFloat(process.env.MINIMUM_FEE) || 1,
            xrplClient: process.env.XRPL_CLIENT // Add this line
        });
        console.log('✅ Fee Manager initialized');

        // Initialize Fireblocks Service (optional - for enterprise liquidity)
        if (process.env.FIREBLOCKS_API_KEY && process.env.FIREBLOCKS_SECRET) {
            fireblocksService = new FireblocksService({
                apiKey: process.env.FIREBLOCKS_API_KEY,
                secretKey: process.env.FIREBLOCKS_SECRET,
                baseUrl: process.env.FIREBLOCKS_BASE_URL || 'https://api.fireblocks.io'
            });
            await fireblocksService.initialize();
            console.log('✅ Fireblocks Service initialized');
        } else {
            console.log('⚠️  Fireblocks integration disabled - API credentials not provided');
        }

        // Initialize Swap Engine (orchestrates RWA → Crypto swaps)
        swapEngine = new SwapEngine({
            oracleService,
            dexRouter,
            feeManager,
            hummingbotService,
            fireblocksService,
            xrplClient: process.env.XRPL_CLIENT,
            atomicSwapEnabled: process.env.ATOMIC_SWAP_ENABLED !== 'false'
        });
        await swapEngine.initialize();
        console.log('✅ Swap Engine initialized');

        console.log('🎉 All services initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Service initialization failed:', error);
        return false;
    }
}

// Make services available to routes
app.use((req, res, next) => {
    req.services = {
        oracleService,
        swapEngine,
        hummingbotService,
        fireblocksService,
        dexRouter,
        feeManager
    };
    next();
});

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/oracle', oracleRoutes);
app.use('/api/swap', swapRoutes);
app.use('/api/hummingbot', hummingbotRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static('public'));
    
    // Catch-all handler for SPA
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
}

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
        ...(isDevelopment && { stack: error.stack }),
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found',
        path: req.path,
        timestamp: new Date().toISOString()
    });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    
    if (swapEngine) await swapEngine.shutdown();
    if (hummingbotService) await hummingbotService.shutdown();
    if (oracleService) await oracleService.shutdown();
    if (dexRouter) await dexRouter.shutdown();
    if (fireblocksService) await fireblocksService.shutdown();
    
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    
    if (swapEngine) await swapEngine.shutdown();
    if (hummingbotService) await hummingbotService.shutdown();
    if (oracleService) await oracleService.shutdown();
    if (dexRouter) await dexRouter.shutdown();
    if (fireblocksService) await fireblocksService.shutdown();
    
    process.exit(0);
});

// Start server
async function startServer() {
    const servicesInitialized = await initializeServices();
    
    if (!servicesInitialized) {
        console.error('❌ Failed to initialize services. Exiting...');
        process.exit(1);
    }
    
    app.listen(PORT, () => {
        console.log(`
🚀 IME RWA Swap Facility Server Started
📡 Port: ${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
🔗 XRPL Network: ${process.env.XRPL_CLIENT}
💰 Platform Fee: ${process.env.PLATFORM_FEE_PERCENT || 2.5}%
🤖 Hummingbot: ${hummingbotService ? 'Connected' : 'Disabled'}
🔐 Fireblocks: ${fireblocksService ? 'Enabled' : 'Disabled'}
⚡ Atomic Swaps: ${process.env.ATOMIC_SWAP_ENABLED !== 'false' ? 'Enabled' : 'Disabled'}

📋 Available Endpoints:
   GET  /api/health             - Health check
   GET  /api/health/detailed    - Detailed system status
   POST /api/oracle/validate    - Validate RWA token
   GET  /api/oracle/discount    - Get discount rates
   POST /api/swap/quote        - Get swap quote (RWA → Crypto)
   POST /api/swap/execute      - Execute swap
   GET  /api/swap/status       - Check swap status
   GET  /api/hummingbot/status - Hummingbot liquidity status
   POST /api/hummingbot/config - Configure liquidity strategies
        `);
    });
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the application
startServer().catch((error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
});