/**
 * Swap Controller for Atomic Swaps with Hummingbot Integration
 * RESTful endpoints for P2P trading and market maker coordination
 */

const express = require('express');
const Joi = require('joi');
const swapService = require('../services/swapService');
const { isValidXRPLSeed, isValidXRPLAddress, isValidCurrencyCode } = require('../utils/xrplHelpers');

const router = express.Router();

// Input validation schemas
const schemas = {
  createSwap: Joi.object({
    walletSeed: Joi.string().required().pattern(/^s[a-zA-Z0-9]{25,34}$/),
    fromAsset: Joi.string().required().min(1).max(10),
    toAsset: Joi.string().required().min(1).max(10),
    amount: Joi.string().required().pattern(/^\d+(\.\d+)?$/),
    exchangeRate: Joi.string().optional().pattern(/^\d+(\.\d+)?$/),
    assetType: Joi.string().optional().valid(
      'real-estate', 'commodities', 'art', 'equipment', 
      'inventory', 'intellectual-property', 'securities', 'other'
    ),
    expiresAt: Joi.date().optional().greater('now')
  }),
  
  acceptSwap: Joi.object({
    swapId: Joi.string().required(),
    counterpartyWalletSeed: Joi.string().required().pattern(/^s[a-zA-Z0-9]{25,34}$/)
  }),
  
  cancelSwap: Joi.object({
    swapId: Joi.string().required(),
    walletSeed: Joi.string().required().pattern(/^s[a-zA-Z0-9]{25,34}$/)
  }),
  
  hummingbotOffer: Joi.object({
    fromAsset: Joi.string().required(),
    toAsset: Joi.string().required(),
    amount: Joi.string().required().pattern(/^\d+(\.\d+)?$/),
    exchangeRate: Joi.string().required().pattern(/^\d+(\.\d+)?$/),
    source: Joi.string().optional().default('hummingbot'),
    strategy: Joi.string().optional()
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

// Swap rate limiting middleware
const swapRateLimit = (req, res, next) => {
  const userKey = req.ip || 'unknown';
  const now = Date.now();
  
  // Simple rate limiting (10 swap operations per minute)
  if (!req.app.locals.swapRateLimits) {
    req.app.locals.swapRateLimits = new Map();
  }
  
  const userRequests = req.app.locals.swapRateLimits.get(userKey) || [];
  const recentRequests = userRequests.filter(time => now - time < 60000);
  
  if (recentRequests.length >= 10) {
    return res.status(429).json({
      success: false,
      message: 'Swap rate limit exceeded',
      data: {
        limit: 10,
        windowMs: 60000,
        retryAfter: 60,
        timestamp: new Date().toISOString()
      }
    });
  }
  
  recentRequests.push(now);
  req.app.locals.swapRateLimits.set(userKey, recentRequests);
  next();
};

// GET /api/swaps/statistics - Get swap statistics and platform metrics
router.get('/statistics', (req, res) => {
  try {
    const stats = swapService.getSwapStatistics();
    
    res.json({
      success: true,
      message: 'Swap statistics retrieved successfully',
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Swap statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve swap statistics',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// GET /api/swaps/active - Get all active swap offers
router.get('/active', async (req, res) => {
  try {
    const filterOptions = {
      fromAsset: req.query.fromAsset,
      toAsset: req.query.toAsset,
      minAmount: req.query.minAmount,
      maxAmount: req.query.maxAmount
    };
    
    // Remove undefined values
    Object.keys(filterOptions).forEach(key => {
      if (filterOptions[key] === undefined) {
        delete filterOptions[key];
      }
    });
    
    const activeOffers = await swapService.getActiveSwapOffers(filterOptions);
    
    res.json({
      success: true,
      message: 'Active swap offers retrieved successfully',
      data: activeOffers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get active swaps error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve active swap offers',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// GET /api/swaps/user/:address - Get user's swap offers
router.get('/user/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    // Validate XRPL address
    if (!isValidXRPLAddress(address)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid XRPL address format',
        data: {
          address,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    const userOffers = await swapService.getUserSwapOffers(address);
    
    res.json({
      success: true,
      message: 'User swap offers retrieved successfully',
      data: userOffers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get user swaps error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user swap offers',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// POST /api/swaps/create - Create new atomic swap offer
router.post('/create', 
  swapRateLimit,
  validateInput(schemas.createSwap), 
  async (req, res) => {
    try {
      const { walletSeed, fromAsset, toAsset, amount, exchangeRate, assetType, expiresAt } = req.validatedBody;
      
      // Additional validation for currency codes
      if (!isValidCurrencyCode(fromAsset) && fromAsset !== 'XRP') {
        return res.status(400).json({
          success: false,
          message: 'Invalid fromAsset currency code',
          data: { fromAsset, timestamp: new Date().toISOString() }
        });
      }
      
      if (!isValidCurrencyCode(toAsset) && toAsset !== 'XRP') {
        return res.status(400).json({
          success: false,
          message: 'Invalid toAsset currency code',
          data: { toAsset, timestamp: new Date().toISOString() }
        });
      }
      
      // Prevent self-swaps
      if (fromAsset === toAsset) {
        return res.status(400).json({
          success: false,
          message: 'Cannot swap asset to itself',
          data: { fromAsset, toAsset, timestamp: new Date().toISOString() }
        });
      }
      
      const options = {
        exchangeRate,
        assetType,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined
      };
      
      const swapOffer = await swapService.createSwapOffer(
        walletSeed, 
        fromAsset, 
        toAsset, 
        amount, 
        options
      );
      
      res.json({
        success: true,
        message: 'Atomic swap offer created successfully',
        data: swapOffer,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Create swap error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create swap offer',
        data: {
          error: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// POST /api/swaps/accept - Accept/fill an existing swap offer
router.post('/accept', 
  swapRateLimit,
  validateInput(schemas.acceptSwap), 
  async (req, res) => {
    try {
      const { swapId, counterpartyWalletSeed } = req.validatedBody;
      
      const result = await swapService.acceptSwapOffer(swapId, counterpartyWalletSeed);
      
      res.json({
        success: true,
        message: 'Swap offer accepted successfully',
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Accept swap error:', error);
      
      // Return appropriate status codes for different error types
      let statusCode = 500;
      if (error.message.includes('not found')) statusCode = 404;
      if (error.message.includes('expired') || error.message.includes('not active')) statusCode = 409;
      
      res.status(statusCode).json({
        success: false,
        message: 'Failed to accept swap offer',
        data: {
          error: error.message,
          swapId: req.validatedBody.swapId,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// POST /api/swaps/cancel - Cancel an existing swap offer
router.post('/cancel', 
  swapRateLimit,
  validateInput(schemas.cancelSwap), 
  async (req, res) => {
    try {
      const { swapId, walletSeed } = req.validatedBody;
      
      const result = await swapService.cancelSwapOffer(swapId, walletSeed);
      
      res.json({
        success: true,
        message: 'Swap offer cancelled successfully',
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Cancel swap error:', error);
      
      let statusCode = 500;
      if (error.message.includes('not found')) statusCode = 404;
      if (error.message.includes('Only the creator')) statusCode = 403;
      if (error.message.includes('not active')) statusCode = 409;
      
      res.status(statusCode).json({
        success: false,
        message: 'Failed to cancel swap offer',
        data: {
          error: error.message,
          swapId: req.validatedBody.swapId,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// POST /api/swaps/hummingbot-offer - Register Hummingbot market maker offer
router.post('/hummingbot-offer', 
  validateInput(schemas.hummingbotOffer), 
  async (req, res) => {
    try {
      const offerData = req.validatedBody;
      
      const hummingbotOffer = await swapService.registerHummingbotOffer(offerData);
      
      res.json({
        success: true,
        message: 'Hummingbot offer registered successfully',
        data: hummingbotOffer,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Hummingbot offer error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to register Hummingbot offer',
        data: {
          error: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// GET /api/swaps/trading-pairs - Get available trading pairs
router.get('/trading-pairs', (req, res) => {
  try {
    const tradingPairs = [
      {
        base: 'RWA',
        quote: 'XRP',
        name: 'RWA/XRP',
        description: 'Real World Assets to XRP',
        active: true,
        hummingbotSupported: true
      },
      {
        base: 'USD',
        quote: 'XRP',
        name: 'USD/XRP',
        description: 'USD Stablecoin to XRP',
        active: true,
        hummingbotSupported: true
      },
      {
        base: 'EUR',
        quote: 'XRP',
        name: 'EUR/XRP',
        description: 'EUR Stablecoin to XRP',
        active: true,
        hummingbotSupported: true
      },
      {
        base: 'GLD',
        quote: 'XRP',
        name: 'GLD/XRP',
        description: 'Gold Token to XRP',
        active: true,
        hummingbotSupported: true
      },
      {
        base: 'REE',
        quote: 'XRP',
        name: 'REE/XRP',
        description: 'Real Estate Token to XRP',
        active: true,
        hummingbotSupported: true
      }
    ];
    
    res.json({
      success: true,
      message: 'Trading pairs retrieved successfully',
      data: {
        tradingPairs,
        totalPairs: tradingPairs.length,
        hummingbotSupportedPairs: tradingPairs.filter(pair => pair.hummingbotSupported).length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Get trading pairs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve trading pairs',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// GET /api/swaps/market-depth/:base/:quote - Get market depth for trading pair
router.get('/market-depth/:base/:quote', async (req, res) => {
  try {
    const { base, quote } = req.params;
    
    // Validate currency codes
    if (!isValidCurrencyCode(base) && base !== 'XRP') {
      return res.status(400).json({
        success: false,
        message: 'Invalid base currency',
        data: { base, timestamp: new Date().toISOString() }
      });
    }
    
    if (!isValidCurrencyCode(quote) && quote !== 'XRP') {
      return res.status(400).json({
        success: false,
        message: 'Invalid quote currency',
        data: { quote, timestamp: new Date().toISOString() }
      });
    }
    
    // Get active offers for this trading pair
    const activeOffers = await swapService.getActiveSwapOffers({
      fromAsset: base,
      toAsset: quote
    });
    
    // Separate into bids and asks
    const bids = activeOffers.offers
      .filter(offer => offer.fromAsset === base && offer.toAsset === quote)
      .sort((a, b) => b.exchangeRate - a.exchangeRate) // Highest bid first
      .slice(0, 20); // Top 20 bids
    
    const asks = activeOffers.offers
      .filter(offer => offer.fromAsset === quote && offer.toAsset === base)
      .sort((a, b) => a.exchangeRate - b.exchangeRate) // Lowest ask first
      .slice(0, 20); // Top 20 asks
    
    const marketDepth = {
      tradingPair: `${base}/${quote}`,
      bids: bids.map(bid => ({
        price: bid.exchangeRate.toFixed(6),
        amount: bid.amount,
        total: (parseFloat(bid.amount) * bid.exchangeRate).toFixed(6),
        swapId: bid.swapId
      })),
      asks: asks.map(ask => ({
        price: (1 / ask.exchangeRate).toFixed(6),
        amount: ask.requestedAmount,
        total: ask.amount,
        swapId: ask.swapId
      })),
      spread: bids.length > 0 && asks.length > 0 
        ? ((1 / asks[0].exchangeRate) - bids[0].exchangeRate).toFixed(6)
        : '0',
      lastUpdated: new Date().toISOString()
    };
    
    res.json({
      success: true,
      message: 'Market depth retrieved successfully',
      data: marketDepth,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get market depth error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve market depth',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

module.exports = router;