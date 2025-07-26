/**
 * IME RWA Swap Platform - Main Server
 * Entry point for the RWA token swap facility backend
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Import middleware
const { errorHandler, notFound } = require('./middleware/errorHandler');
const asyncHandler = require('./middleware/asyncHandler');

// Import database
const { sequelize, testConnection, initializeDatabase } = require('./config/database');

// Import models
const models = require('./models');

// Import routes
const healthRoutes = require('./routes/healthRoutes');
const swapRoutes = require('./routes/swapRoutes');
const oracleRoutes = require('./routes/oracleRoutes');
const hummingbotRoutes = require('./routes/hummingbotRoutes');

// Import services
const OracleService = require('./services/oracleService');
const SwapEngine = require('./services/swapEngine');
const DexRouter = require('./services/dexRouter');
const FeeManager = require('./services/feeManager');
const HummingbotService = require('./services/hummingbotService');
const FireblocksService = require('./services/fireblocksService');
const SologenicService = require('./services/sologenicService');
const GateHubService = require('./services/gateHubService');
const LiquidityRouter = require('./services/liquidityRouter');

// Initialize Express app
const app = express();

// Global variables for services
let services = {};

/**
 * Configure middleware
 */
function configureMiddleware() {
    // Security middleware
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", "data:", "https:"],
            },
        },
        crossOriginEmbedderPolicy: false
    }));

    // CORS configuration
    app.use(cors({
        origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3001'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type', 
            'Authorization', 
            'X-API-Key', 
            'X-API-Secret',
            'X-Requested-With'
        ]
    }));

    // Compression
    app.use(compression());

    // Body parsing
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Rate limiting
    const limiter = rateLimit({
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
        max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // limit each IP to 100 requests per windowMs
        message: {
            success: false,
            message: 'Too many requests from this IP, please try again later.'
        },
        standardHeaders: true,
        legacyHeaders: false
    });

    app.use('/api/', limiter);

    // Request logging in development
    if (process.env.NODE_ENV === 'development') {
        app.use((req, res, next) => {
            console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
            next();
        });
    }
}

/**
 * Initialize services
 */
async function initializeServices() {
    try {
        console.log('🔧 Initializing services...');

        // Service configurations
        const xrplConfig = process.env.XRPL_SERVER || 'wss://s.altnet.rippletest.net:51233';
        
        const oracleWallet = {
            seed: process.env.ORACLE_WALLET_SEED
        };

        // Initialize Oracle Service
        services.oracleService = new OracleService({
            xrplClient: xrplConfig,
            oracleWallet: oracleWallet,
            validationOnly: true
        });
        await services.oracleService.initialize();

        // Initialize Fee Manager
        services.feeManager = new FeeManager({
            platformFeePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT) || 2.5,
            minimumFee: parseFloat(process.env.MINIMUM_FEE) || 1,
            maximumFee: parseFloat(process.env.MAXIMUM_FEE) || 1000,
            xrplClient: xrplConfig
        });
        await services.feeManager.initialize();

        // Initialize DEX Router
        services.dexRouter = new DexRouter({
            xrplClient: xrplConfig,
            enableAMM: true,
            enableOrderBook: true
        });
        await services.dexRouter.initialize();

        // Initialize optional services
        await initializeOptionalServices(xrplConfig);

        // Initialize Liquidity Router
        services.liquidityRouter = new LiquidityRouter({
            fireblocksService: services.fireblocksService,
            sologenicService: services.sologenicService,
            gateHubService: services.gateHubService
        });
        await services.liquidityRouter.initialize();

        // Initialize Swap Engine (main orchestrator)
        services.swapEngine = new SwapEngine({
            xrplClient: xrplConfig,
            oracleService: services.oracleService,
            dexRouter: services.dexRouter,
            feeManager: services.feeManager,
            hummingbotService: services.hummingbotService,
            fireblocksService: services.fireblocksService
        });
        await services.swapEngine.initialize();

        console.log('✅ All services initialized successfully');

    } catch (error) {
        console.error('❌ Service initialization failed:', error);
        throw error;
    }
}

/**
 * Initialize optional services (Fireblocks, Hummingbot, etc.)
 */
async function initializeOptionalServices(xrplConfig) {
    try {
        // Fireblocks Service (optional)
        if (process.env.FIREBLOCKS_API_KEY && process.env.FIREBLOCKS_SECRET_KEY) {
            services.fireblocksService = new FireblocksService({
                apiKey: process.env.FIREBLOCKS_API_KEY,
                secretKey: process.env.FIREBLOCKS_SECRET_KEY,
                vaultAccountId: process.env.FIREBLOCKS_VAULT_ACCOUNT_ID
            });
            await services.fireblocksService.initialize();
            console.log('✅ Fireblocks service initialized');
        } else {
            console.log('⚠️  Fireblocks service skipped (credentials not provided)');
        }

        // Hummingbot Service (optional)
        if (process.env.HUMMINGBOT_PATH) {
            services.hummingbotService = new HummingbotService({
                hummingbotPath: process.env.HUMMINGBOT_PATH,
                configPath: process.env.HUMMINGBOT_CONFIG_PATH,
                oracleApiUrl: `${process.env.API_BASE_URL}/api/oracle`
            });
            await services.hummingbotService.initialize();
            console.log('✅ Hummingbot service initialized');
        } else {
            console.log('⚠️  Hummingbot service skipped (path not provided)');
        }

        // Sologenic Service (optional)
        if (process.env.SOLOGENIC_API_KEY) {
            services.sologenicService = new SologenicService({
                apiKey: process.env.SOLOGENIC_API_KEY,
                apiSecret: process.env.SOLOGENIC_API_SECRET,
                xrplClient: xrplConfig
            });
            await services.sologenicService.initialize();
            console.log('✅ Sologenic service initialized');
        } else {
            console.log('⚠️  Sologenic service skipped (API key not provided)');
        }

        // GateHub Service (optional)
        if (process.env.GATEHUB_API_KEY) {
            services.gateHubService = new GateHubService({
                apiKey: process.env.GATEHUB_API_KEY,
                apiSecret: process.env.GATEHUB_API_SECRET
            });
            await services.gateHubService.initialize();
            console.log('✅ GateHub service initialized');
        } else {
            console.log('⚠️  GateHub service skipped (API key not provided)');
        }

    } catch (error) {
        console.error('❌ Optional service initialization failed:', error);
        // Don't throw - optional services can fail without stopping the app
    }
}

/**
 * Configure routes
 */
function configureRoutes() {
    // Add services to request object
    app.use((req, res, next) => {
        req.services = services;
        next();
    });

    // API routes
    app.use('/api/health', healthRoutes);
    app.use('/api/swap', swapRoutes);
    app.use('/api/oracle', oracleRoutes);
    
    if (services.hummingbotService) {
        app.use('/api/hummingbot', hummingbotRoutes);
    }

    // Basic info endpoint
    app.get('/api/info', asyncHandler(async (req, res) => {
        res.json({
            success: true,
            name: 'IME RWA Swap Facility',
            version: '1.0.0',
            environment: process.env.NODE_ENV,
            services: {
                oracle: !!services.oracleService,
                swapEngine: !!services.swapEngine,
                dexRouter: !!services.dexRouter,
                feeManager: !!services.feeManager,
                hummingbot: !!services.hummingbotService,
                fireblocks: !!services.fireblocksService,
                sologenic: !!services.sologenicService,
                gatehub: !!services.gateHubService,
                liquidityRouter: !!services.liquidityRouter
            },
            timestamp: new Date().toISOString()
        });
    }));

    // Root endpoint
    app.get('/', (req, res) => {
        res.json({
            message: 'IME RWA Swap Facility API',
            version: '1.0.0',
            status: 'operational',
            documentation: '/api/info'
        });
    });

    // 404 handler
    app.use(notFound);

    // Global error handler
    app.use(errorHandler);
}

/**
 * Graceful shutdown handler
 */
function setupGracefulShutdown() {
    const gracefulShutdown = async (signal) => {
        console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

        // Stop accepting new connections
        server.close(async () => {
            console.log('📡 HTTP server closed');

            try {
                // Shutdown services
                console.log('🔧 Shutting down services...');
                
                if (services.swapEngine) {
                    await services.swapEngine.shutdown();
                }
                if (services.oracleService) {
                    await services.oracleService.shutdown();
                }
                if (services.dexRouter) {
                    await services.dexRouter.shutdown();
                }
                if (services.feeManager) {
                    await services.feeManager.shutdown();
                }
                if (services.hummingbotService) {
                    await services.hummingbotService.shutdown();
                }
                if (services.fireblocksService) {
                    await services.fireblocksService.shutdown();
                }
                if (services.sologenicService) {
                    await services.sologenicService.shutdown();
                }
                if (services.gateHubService) {
                    await services.gateHubService.shutdown();
                }
                if (services.liquidityRouter) {
                    await services.liquidityRouter.shutdown();
                }

                // Close database connection
                await sequelize.close();
                console.log('🗄️  Database connection closed');

                console.log('✅ Graceful shutdown completed');
                process.exit(0);

            } catch (error) {
                console.error('❌ Error during shutdown:', error);
                process.exit(1);
            }
        });

        // Force close after 30 seconds
        setTimeout(() => {
            console.error('❌ Forceful shutdown due to timeout');
            process.exit(1);
        }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught Exception:', error);
        gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
        gracefulShutdown('UNHANDLED_REJECTION');
    });
}

/**
 * Start the server
 */
async function startServer() {
    try {
        console.log('🚀 Starting IME RWA Swap Facility...');

        // Test database connection
        const dbConnected = await testConnection();
        if (!dbConnected) {
            throw new Error('Database connection failed');
        }

        // Initialize database
        await initializeDatabase();

        // Configure middleware
        configureMiddleware();

        // Initialize services
        await initializeServices();

        // Configure routes
        configureRoutes();

        // Setup graceful shutdown
        setupGracefulShutdown();

        // Start server
        const PORT = process.env.PORT || 3000;
        global.server = app.listen(PORT, () => {
            console.log(`\n🎉 IME RWA Swap Facility is running!`);
            console.log(`📡 Server: http://localhost:${PORT}`);
            console.log(`🔗 API Info: http://localhost:${PORT}/api/info`);
            console.log(`💚 Health Check: http://localhost:${PORT}/api/health`);
            console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`📊 Database: Connected`);
            console.log(`🔧 Services: ${Object.keys(services).length} initialized\n`);
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer();

module.exports = app;