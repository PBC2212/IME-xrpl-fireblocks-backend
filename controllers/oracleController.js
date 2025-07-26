/**
 * Oracle Controller for Asset Valuation API
 * RESTful endpoints for Hummingbot integration and price feeds
 */

const express = require('express');
const Joi = require('joi');
const oracleService = require('../services/oracleService');
const { isValidCurrencyCode } = require('../utils/xrplHelpers');

const router = express.Router();

// Input validation schemas
const schemas = {
  assetValuation: Joi.object({
    assetType: Joi.string().required().valid(
      'real-estate', 'commodities', 'art', 'equipment', 
      'inventory', 'intellectual-property', 'securities', 'other'
    ),
    assetAmount: Joi.string().required().pattern(/^\d+(\.\d+)?$/),
    tokenSymbol: Joi.string().optional().default('RWA').length(3)
  }),
  
  exchangeRate: Joi.object({
    assetType: Joi.string().required().valid(
      'real-estate', 'commodities', 'art', 'equipment', 
      'inventory', 'intellectual-property', 'securities', 'other'
    ),
    assetAmount: Joi.string().required().pattern(/^\d+(\.\d+)?$/),
    tokenSymbol: Joi.string().optional().default('RWA').length(3),
    baseCurrency: Joi.string().optional().default('XRP').length(3)
  }),
  
  ltvUpdate: Joi.object({
    ltvRatio: Joi.number().required().min(0.1).max(0.9)
  }),
  
  hummingbotWebhook: Joi.object({
    eventType: Joi.string().required().valid(
      'asset_tokenized', 'trustline_created', 'swap_created', 
      'order_filled', 'price_updated', 'system_alert'
    ),
    data: Joi.object().required()
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

// Rate limiting for oracle endpoints
const oracleRateLimit = (req, res, next) => {
  const userKey = req.ip || 'unknown';
  const now = Date.now();
  
  // Simple in-memory rate limiting (100 requests per minute)
  if (!req.app.locals.oracleRateLimits) {
    req.app.locals.oracleRateLimits = new Map();
  }
  
  const userRequests = req.app.locals.oracleRateLimits.get(userKey) || [];
  const recentRequests = userRequests.filter(time => now - time < 60000); // Last minute
  
  if (recentRequests.length >= 100) {
    return res.status(429).json({
      success: false,
      message: 'Oracle rate limit exceeded',
      data: {
        limit: 100,
        windowMs: 60000,
        retryAfter: 60,
        timestamp: new Date().toISOString()
      }
    });
  }
  
  recentRequests.push(now);
  req.app.locals.oracleRateLimits.set(userKey, recentRequests);
  next();
};

// GET /api/oracle/status - Oracle health and status
router.get('/status', (req, res) => {
  try {
    const status = oracleService.getOracleStatus();
    
    res.json({
      success: true,
      message: 'Oracle status retrieved successfully',
      data: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Oracle status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get oracle status',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// GET /api/oracle/prices - Get all current prices
router.get('/prices', oracleRateLimit, async (req, res) => {
  try {
    const prices = await oracleService.getAllPrices();
    
    res.json({
      success: true,
      message: 'Current prices retrieved successfully',
      data: prices,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get prices error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve current prices',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// GET /api/oracle/xrp-price - Get current XRP/USD price
router.get('/xrp-price', oracleRateLimit, async (req, res) => {
  try {
    const xrpPrice = await oracleService.getXRPPrice();
    
    res.json({
      success: true,
      message: 'XRP price retrieved successfully',
      data: {
        price: xrpPrice,
        currency: 'USD',
        timestamp: new Date().toISOString(),
        source: 'IME_Oracle'
      }
    });
  } catch (error) {
    console.error('Get XRP price error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve XRP price',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// POST /api/oracle/asset-valuation - Get asset valuation
router.post('/asset-valuation', 
  oracleRateLimit,
  validateInput(schemas.assetValuation), 
  async (req, res) => {
    try {
      const { assetType, assetAmount, tokenSymbol } = req.validatedBody;
      
      const valuation = await oracleService.getAssetValuation(assetType, assetAmount, tokenSymbol);
      
      res.json({
        success: true,
        message: 'Asset valuation calculated successfully',
        data: valuation,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Asset valuation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to calculate asset valuation',
        data: {
          error: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// POST /api/oracle/rwa-xrp-rate - Get RWA to XRP exchange rate
router.post('/rwa-xrp-rate', 
  oracleRateLimit,
  validateInput(schemas.exchangeRate), 
  async (req, res) => {
    try {
      const { assetType, assetAmount, tokenSymbol } = req.validatedBody;
      
      const rate = await oracleService.getRWAToXRPRate(assetType, assetAmount, tokenSymbol);
      
      res.json({
        success: true,
        message: 'RWA/XRP exchange rate calculated successfully',
        data: rate,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('RWA/XRP rate error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to calculate RWA/XRP exchange rate',
        data: {
          error: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// GET /api/oracle/hummingbot-feed - Hummingbot-compatible price feed
router.get('/hummingbot-feed', oracleRateLimit, async (req, res) => {
  try {
    const { token = 'RWA', base = 'XRP' } = req.query;
    
    // Validate query parameters
    if (!isValidCurrencyCode(token) || !isValidCurrencyCode(base)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid token or base currency',
        data: {
          token,
          base,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    const priceFeed = await oracleService.getHummingbotPriceFeed(token, base);
    
    // Return in Hummingbot's expected format
    res.json(priceFeed);
  } catch (error) {
    console.error('Hummingbot feed error:', error);
    res.status(500).json({
      error: 'Failed to generate price feed',
      message: error.message,
      timestamp: Math.floor(Date.now() / 1000)
    });
  }
});

// POST /api/oracle/webhook - Create Hummingbot webhook notification
router.post('/webhook', 
  validateInput(schemas.hummingbotWebhook), 
  async (req, res) => {
    try {
      const { eventType, data } = req.validatedBody;
      
      const webhook = await oracleService.createHummingbotWebhook(eventType, data);
      
      res.json({
        success: true,
        message: 'Hummingbot webhook created successfully',
        data: webhook,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Hummingbot webhook error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create Hummingbot webhook',
        data: {
          error: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// PUT /api/oracle/ltv-ratio - Update LTV ratio
router.put('/ltv-ratio', 
  validateInput(schemas.ltvUpdate), 
  async (req, res) => {
    try {
      const { ltvRatio } = req.validatedBody;
      
      const result = oracleService.updateLTVRatio(ltvRatio);
      
      res.json({
        success: true,
        message: 'LTV ratio updated successfully',
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('LTV ratio update error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update LTV ratio',
        data: {
          error: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// GET /api/oracle/asset-types - Get supported asset types with base prices
router.get('/asset-types', (req, res) => {
  try {
    const assetTypes = [
      {
        type: 'real-estate',
        name: 'Real Estate',
        basePrice: 250,
        unit: 'per sq ft',
        description: 'Residential, commercial, or industrial property'
      },
      {
        type: 'commodities',
        name: 'Commodities',
        basePrice: 2100,
        unit: 'per oz',
        description: 'Gold, silver, oil, agricultural products'
      },
      {
        type: 'art',
        name: 'Art & Collectibles',
        basePrice: 5000,
        unit: 'per piece',
        description: 'Paintings, sculptures, rare collectibles'
      },
      {
        type: 'equipment',
        name: 'Equipment & Machinery',
        basePrice: 15000,
        unit: 'per unit',
        description: 'Industrial equipment, vehicles, machinery'
      },
      {
        type: 'inventory',
        name: 'Inventory',
        basePrice: 50,
        unit: 'per unit',
        description: 'Business inventory and stock'
      },
      {
        type: 'intellectual-property',
        name: 'Intellectual Property',
        basePrice: 25000,
        unit: 'per patent',
        description: 'Patents, trademarks, copyrights'
      },
      {
        type: 'securities',
        name: 'Securities',
        basePrice: 100,
        unit: 'per share',
        description: 'Stocks, bonds, financial instruments'
      },
      {
        type: 'other',
        name: 'Other Assets',
        basePrice: 1000,
        unit: 'per unit',
        description: 'Other tokenizable assets'
      }
    ];
    
    res.json({
      success: true,
      message: 'Asset types retrieved successfully',
      data: {
        assetTypes,
        totalTypes: assetTypes.length,
        ltvRatio: oracleService.LTV_RATIO,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Get asset types error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve asset types',
      data: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

module.exports = router;