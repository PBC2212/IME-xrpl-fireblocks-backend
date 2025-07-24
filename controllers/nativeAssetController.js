const express = require('express');
const Joi = require('joi');
const xrplNativeService = require('../services/xrplNativeService');
const { 
  validateAssetTokenization, 
  tokenizationRateLimit, 
  enrichAssetMetadata, 
  getAssetTypes 
} = require('../middleware/assetValidation');

const router = express.Router();

// Input validation schemas
const schemas = {
  createWallet: Joi.object({
    userId: Joi.string().required().min(1).max(100),
    walletName: Joi.string().required().min(1).max(200)
  }),
  
  createTrustline: Joi.object({
    walletSeed: Joi.string().required().pattern(/^s[a-zA-Z0-9]{25,34}$/),
    tokenSymbol: Joi.string().optional().default('RWA').length(3),
    limit: Joi.string().optional().default('1000000')
  }),
  
  pledge: Joi.object({
    userAddress: Joi.string().required().pattern(/^r[a-zA-Z0-9]{25,34}$/),
    assetType: Joi.string().required().min(1).max(100),
    assetAmount: Joi.string().required().pattern(/^\d+(\.\d+)?$/),
    assetDescription: Joi.string().optional().max(500),
    tokenSymbol: Joi.string().optional().default('RWA').length(3)
  }),
  
  redeem: Joi.object({
    walletSeed: Joi.string().required().pattern(/^s[a-zA-Z0-9]{25,34}$/),
    tokenAmount: Joi.string().required().pattern(/^\d+(\.\d+)?$/),
    tokenSymbol: Joi.string().optional().default('RWA').length(3)
  }),
  
  swap: Joi.object({
    walletSeed: Joi.string().required().pattern(/^s[a-zA-Z0-9]{25,34}$/),
    fromAsset: Joi.string().required().min(1),
    toAsset: Joi.string().required().min(1),
    amount: Joi.string().required().pattern(/^\d+(\.\d+)?$/),
    exchangeRate: Joi.string().optional().pattern(/^\d+(\.\d+)?$/)
  })
};

// Middleware for input validation
const validateInput = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        data: {
          details: error.details.map(detail => detail.message),
          timestamp: new Date().toISOString()
        }
      });
    }
    req.validatedBody = value;
    next();
  };
};

// GET /api/native/asset-types - Get available asset types for tokenization
router.get('/asset-types', getAssetTypes);

// GET /api/native/stats - Platform statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await xrplNativeService.getPlatformStats();
    
    res.json({
      success: true,
      message: 'Platform statistics retrieved successfully',
      data: {
        stats,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve platform statistics',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// POST /api/native/create-wallet - Create new XRPL wallet
router.post('/create-wallet', validateInput(schemas.createWallet), async (req, res) => {
  try {
    const { userId, walletName } = req.validatedBody;
    
    const wallet = await xrplNativeService.createWallet(userId, walletName);
    
    res.json({
      success: true,
      message: 'XRPL wallet created successfully',
      data: wallet,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Create wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create XRPL wallet',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// GET /api/native/wallet/:address - Get wallet info & balances
router.get('/wallet/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    // Validate XRPL address format
    if (!/^r[a-zA-Z0-9]{25,34}$/.test(address)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid XRPL address format',
        data: {
          address,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    const walletInfo = await xrplNativeService.getWalletInfo(address);
    
    res.json({
      success: true,
      message: 'Wallet information retrieved successfully',
      data: {
        wallet: walletInfo,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve wallet information',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// GET /api/native/transactions/:address - Transaction history
router.get('/transactions/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { limit = '10' } = req.query;
    
    if (!/^r[a-zA-Z0-9]{25,34}$/.test(address)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid XRPL address format',
        data: {
          address,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    const transactions = await xrplNativeService.getTransactionHistory(address, parseInt(limit));
    
    res.json({
      success: true,
      message: 'Transaction history retrieved successfully',
      data: {
        transactions,
        address,
        limit: parseInt(limit),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve transaction history',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// GET /api/native/validate/:address - Validate XRPL address
router.get('/validate/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    const validation = await xrplNativeService.validateAddress(address);
    
    res.json({
      success: true,
      message: 'Address validation completed',
      data: {
        validation,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Validate address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate address',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// POST /api/native/create-trustline - Create trust line for RWA tokens
router.post('/create-trustline', validateInput(schemas.createTrustline), async (req, res) => {
  try {
    const { walletSeed, tokenSymbol, limit } = req.validatedBody;
    
    const trustLine = await xrplNativeService.createTrustLine(walletSeed, tokenSymbol, limit);
    
    res.json({
      success: true,
      message: 'Trust line created successfully',
      data: {
        trustLine,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Create trustline error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create trust line',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// POST /api/native/pledge - Pledge asset → mint tokens (Enhanced)
router.post('/pledge', 
  tokenizationRateLimit,
  validateAssetTokenization, 
  enrichAssetMetadata, 
  async (req, res) => {
    try {
      const { validatedAsset, enrichedMetadata } = req;
      
      const pledge = await xrplNativeService.pledgeAssetEnhanced(
        validatedAsset.userAddress,
        validatedAsset.assetType,
        validatedAsset.assetAmount,
        validatedAsset.assetDescription,
        validatedAsset.tokenSymbol,
        enrichedMetadata
      );
      
      // Set rate limiting header for next request
      res.set('X-Last-Tokenization', Date.now().toString());
      
      res.json({
        success: true,
        message: `Asset tokenized successfully. ${validatedAsset.tokenSymbol} tokens minted.`,
        data: pledge,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Enhanced pledge asset error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to tokenize asset',
        data: {
          error: error.message,
          assetType: req.validatedAsset?.assetType,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// POST /api/native/redeem - Burn tokens → release assets
router.post('/redeem', validateInput(schemas.redeem), async (req, res) => {
  try {
    const { walletSeed, tokenAmount, tokenSymbol } = req.validatedBody;
    
    const redemption = await xrplNativeService.redeemTokens(walletSeed, tokenAmount, tokenSymbol);
    
    res.json({
      success: true,
      message: `${tokenSymbol || 'RWA'} tokens burned and assets released successfully`,
      data: {
        redemption,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Redeem tokens error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to redeem tokens',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// POST /api/native/swap - Create DEX swap offer
router.post('/swap', validateInput(schemas.swap), async (req, res) => {
  try {
    const { walletSeed, fromAsset, toAsset, amount, exchangeRate } = req.validatedBody;
    
    const swap = await xrplNativeService.createSwapOffer(
      walletSeed, 
      fromAsset, 
      toAsset, 
      amount, 
      exchangeRate
    );
    
    res.json({
      success: true,
      message: 'DEX swap offer created successfully',
      data: {
        swap,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Create swap error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create DEX swap offer',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// GET /api/native/orderbook/:base/:counter - Get order book for trading pair
router.get('/orderbook/:base/:counter', async (req, res) => {
  try {
    const { base, counter } = req.params;
    
    const orderBook = await xrplNativeService.getOrderBook(base, counter);
    
    res.json({
      success: true,
      message: 'Order book retrieved successfully',
      data: {
        orderBook,
        tradingPair: `${base}/${counter}`,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Get orderbook error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve order book',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

module.exports = router;