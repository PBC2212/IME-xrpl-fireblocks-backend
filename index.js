const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
require('dotenv').config();

// Import custom modules
const nativeAssetController = require('./controllers/nativeAssetController');
const oracleController = require('./controllers/oracleController');
const xrplNativeService = require('./services/xrplNativeService');
const { validateConfig } = require('./config/xrplConfig');
const { 
  rateLimitMiddleware, 
  sanitizeInput, 
  securityHeaders, 
  validateRequest, 
  xrplSecurity, 
  secureLogger 
} = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 5000;

// Validate configuration on startup
console.log('🔍 Validating XRPL configuration...');
const configValidation = validateConfig();
if (!configValidation.isValid) {
  console.error('❌ Configuration validation failed:');
  configValidation.errors.forEach(error => console.error(`  - ${error}`));
  console.error('Please check your .env file and fix the configuration errors.');
  process.exit(1);
}
console.log('✅ Configuration validation passed');

// Initialize XRPL service
const initializeXRPL = async () => {
  try {
    await xrplNativeService.initialize();
    console.log('✅ XRPL service initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize XRPL service:', error.message);
    console.error('Server will continue but XRPL operations may fail');
  }
};

// Security middleware (applied first)
app.use(helmet());
app.use(compression());
app.use(securityHeaders);
app.use(rateLimitMiddleware);

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:5173'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request processing middleware
app.use(sanitizeInput);
app.use(validateRequest);
app.use(secureLogger);

// Logging middleware (after security middleware)
app.use(morgan('combined'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'IME XRPL Native Platform Backend is running',
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      xrplEndpoint: process.env.XRPL_ENDPOINT
    }
  });
});

// API Documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    success: true,
    message: 'IME XRPL Native Platform API Documentation',
    data: {
      platform: 'XRPL Native RWA Tokenization',
      version: '1.0.0',
      endpoints: {
        health: 'GET /api/health',
        docs: 'GET /api/docs',
        stats: 'GET /api/native/stats',
        oracle: 'GET /api/oracle/status',
        hummingbotFeed: 'GET /api/oracle/hummingbot-feed',
        createWallet: 'POST /api/native/create-wallet',
        walletInfo: 'GET /api/native/wallet/:address',
        transactions: 'GET /api/native/transactions/:address',
        validateAddress: 'GET /api/native/validate/:address',
        createTrustline: 'POST /api/native/create-trustline',
        pledge: 'POST /api/native/pledge',
        redeem: 'POST /api/native/redeem',
        swap: 'POST /api/native/swap',
        orderbook: 'GET /api/native/orderbook/:base/:counter',
        // Atomic Swaps API
        swapStatistics: 'GET /api/swaps/statistics',
        activeSwaps: 'GET /api/swaps/active',
        userSwaps: 'GET /api/swaps/user/:address',
        createSwap: 'POST /api/swaps/create',
        acceptSwap: 'POST /api/swaps/accept',
        cancelSwap: 'POST /api/swaps/cancel',
        hummingbotOffer: 'POST /api/swaps/hummingbot-offer',
        tradingPairs: 'GET /api/swaps/trading-pairs',
        marketDepth: 'GET /api/swaps/market-depth/:base/:quote'
      },
      examples: {
        createWallet: {
          method: 'POST',
          url: '/api/native/create-wallet',
          body: {
            userId: 'user123',
            walletName: 'John Doe Wallet'
          }
        },
        pledge: {
          method: 'POST',
          url: '/api/native/pledge',
          body: {
            userAddress: 'rXXXXXXXXXXXXXXXXX',
            assetType: 'Real Estate',
            assetAmount: '100000',
            assetDescription: 'Downtown office building'
          }
        },
        createAtomicSwap: {
          method: 'POST',
          url: '/api/swaps/create',
          body: {
            walletSeed: 'sXXXXXXXXXXXXXXXXXXXXXXXX',
            fromAsset: 'RWA',
            toAsset: 'XRP',
            amount: '1000',
            exchangeRate: '0.5',
            assetType: 'real-estate'
          }
        },
        hummingbotOffer: {
          method: 'POST',
          url: '/api/swaps/hummingbot-offer',
          body: {
            fromAsset: 'RWA',
            toAsset: 'XRP',
            amount: '5000',
            exchangeRate: '0.7',
            strategy: 'market_making'
          }
        }
      }
    }
  });
});

// XRPL Native Asset routes (with XRPL-specific security)
app.use('/api/native', xrplSecurity, nativeAssetController);

// Oracle API routes for Hummingbot integration
app.use('/api/oracle', oracleController);

// Atomic Swaps API routes
app.use('/api/swaps', require('./controllers/swapController'));

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    data: {
      requestedUrl: req.originalUrl,
      availableEndpoints: [
        'GET /api/health',
        'GET /api/docs',
        'POST /api/native/create-wallet',
        'POST /api/native/pledge',
        'GET /api/swaps/active',
        'POST /api/swaps/create',
        'POST /api/swaps/hummingbot-offer'
      ]
    }
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    data: {
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      timestamp: new Date().toISOString()
    }
  });
});

// Start server
const startServer = async () => {
  // Initialize XRPL first
  await initializeXRPL();
  
  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`🚀 IME XRPL Native Platform Backend running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📚 API docs: http://localhost:${PORT}/api/docs`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 XRPL Endpoint: ${process.env.XRPL_ENDPOINT}`);
    console.log(`💎 Default Token: ${process.env.DEFAULT_ASSET_CURRENCY || 'RWA'}`);
    console.log(`🏦 Token Issuer: ${process.env.DEFAULT_ASSET_ISSUER || 'Not configured'}`);
    console.log('🎯 Server ready for requests!');
  });
};

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  await xrplNativeService.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  await xrplNativeService.disconnect();
  process.exit(0);
});

// Start the server
startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

module.exports = app;