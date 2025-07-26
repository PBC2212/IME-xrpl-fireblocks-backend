/**
 * IME Oracle Routes - RWA Token Validation and Pricing API Endpoints
 * Handles Oracle-related endpoints for RWA token validation and discount calculations
 * 
 * Endpoints:
 * - POST /api/oracle/validate - Validate RWA token for swap eligibility
 * - GET /api/oracle/discount/:category - Get discount rates for RWA categories
 * - GET /api/oracle/price/:tradingPair - Get Oracle pricing for Hummingbot external price source
 * - GET /api/oracle/categories - Get all supported RWA asset categories
 * - POST /api/oracle/valuation - Get current asset valuation with market adjustments
 * - GET /api/oracle/confidence/:tokenId - Get confidence score for RWA token
 */

const express = require('express');
const joi = require('joi');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');

const router = express.Router();

// Rate limiting for oracle endpoints
const oracleLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: 'Too many oracle requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
});

const priceLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 price requests per minute (for Hummingbot)
    message: 'Too many price requests, please try again later.'
});

// Validation schemas
const validateTokenSchema = joi.object({
    rwaToken: joi.object({
        currency: joi.string().required(),
        issuer: joi.string().required(),
        amount: joi.number().positive().required()
    }).required(),
    userAddress: joi.string().required(),
    includeValuation: joi.boolean().default(true),
    skipCache: joi.boolean().default(false)
});

const valuationSchema = joi.object({
    assetData: joi.object({
        id: joi.string().required(),
        category: joi.string().valid('REAL_ESTATE', 'PRECIOUS_METALS', 'VEHICLES', 'COLLECTIBLES', 'EQUIPMENT').required(),
        description: joi.string().required(),
        originalValue: joi.number().positive().required(),
        lastAppraisal: joi.date().iso().optional(),
        location: joi.string().optional(),
        condition: joi.string().valid('excellent', 'good', 'fair', 'poor').optional()
    }).required(),
    marketConditions: joi.object({
        useRealTime: joi.boolean().default(true),
        overrideAdjustment: joi.number().min(0.1).max(2.0).optional()
    }).optional()
});

/**
 * POST /api/oracle/validate
 * Validate RWA token for swap eligibility and calculate swap parameters
 */
router.post('/validate', oracleLimiter, async (req, res) => {
    try {
        // Validate request
        const { error, value } = validateTokenSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid validation parameters',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { oracleService } = req.services;
        
        // Validate RWA token
        const validationResult = await oracleService.validateRWAToken(
            value.rwaToken,
            value.userAddress
        );

        if (!validationResult.success) {
            return res.status(422).json({
                success: false,
                message: 'RWA token validation failed',
                validationErrors: validationResult.errors || ['Token validation failed'],
                timestamp: new Date().toISOString()
            });
        }

        const response = {
            success: true,
            validation: {
                isValid: true,
                validationId: validationResult.validation.id,
                swapEligible: validationResult.canSwap,
                validUntil: validationResult.validation.validUntil
            },
            swapParameters: validationResult.swapParameters,
            timestamp: new Date().toISOString()
        };

        // Include valuation data if requested
        if (value.includeValuation && validationResult.validation.valuation) {
            response.valuation = {
                currentValue: validationResult.validation.valuation.currentValue,
                marketAdjustment: validationResult.validation.valuation.marketAdjustment,
                confidence: validationResult.validation.valuation.confidence,
                lastUpdated: validationResult.validation.valuation.lastUpdated
            };
        }

        res.json(response);

    } catch (error) {
        req.logger?.error('Token validation failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to validate RWA token',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/oracle/discount/:category
 * Get current discount rates for RWA asset categories
 */
router.get('/discount/:category', [
    param('category').isIn(['REAL_ESTATE', 'PRECIOUS_METALS', 'VEHICLES', 'COLLECTIBLES', 'EQUIPMENT', 'ALL'])
        .withMessage('Invalid asset category')
], async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Invalid parameters',
                errors: errors.array()
            });
        }

        const { category } = req.params;
        const { oracleService } = req.services;
        
        const assetCategories = oracleService.getAssetCategories();

        if (category === 'ALL') {
            // Return all discount rates
            const allDiscounts = Object.entries(assetCategories).map(([cat, config]) => ({
                category: cat,
                name: config.name,
                discountRate: config.discountRate,
                maxValue: config.maxValue,
                lastUpdated: new Date().toISOString()
            }));

            res.json({
                success: true,
                discountRates: allDiscounts,
                timestamp: new Date().toISOString()
            });
        } else {
            // Return specific category
            const categoryConfig = assetCategories[category];
            if (!categoryConfig) {
                return res.status(404).json({
                    success: false,
                    message: 'Asset category not found',
                    category
                });
            }

            res.json({
                success: true,
                category,
                name: categoryConfig.name,
                discountRate: categoryConfig.discountRate,
                maxValue: categoryConfig.maxValue,
                marketConditions: await getMarketConditions(category),
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        req.logger?.error('Discount rate retrieval failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get discount rates',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/oracle/price/:tradingPair
 * Get Oracle pricing for trading pair (used by Hummingbot external price source)
 */
router.get('/price/:tradingPair', priceLimiter, [
    param('tradingPair').matches(/^[A-Z0-9]+\/[A-Z0-9]+$/).withMessage('Invalid trading pair format'),
    query('discount').optional().isFloat({ min: 0.1, max: 1.0 }).withMessage('Discount must be between 0.1 and 1.0')
], async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Invalid parameters',
                errors: errors.array()
            });
        }

        const { tradingPair } = req.params;
        const { discount } = req.query;
        const { oracleService } = req.services;

        const [baseCurrency, quoteCurrency] = tradingPair.split('/');

        // Determine RWA category from base currency
        const rwaCategory = getRWACategoryFromCurrency(baseCurrency);
        if (!rwaCategory) {
            return res.status(400).json({
                success: false,
                message: 'Not an RWA token pair',
                tradingPair
            });
        }

        const assetCategories = oracleService.getAssetCategories();
        const categoryConfig = assetCategories[rwaCategory];

        if (!categoryConfig) {
            return res.status(404).json({
                success: false,
                message: 'RWA category not supported',
                category: rwaCategory
            });
        }

        // Calculate effective discount rate
        const effectiveDiscount = discount ? parseFloat(discount) : categoryConfig.discountRate;
        
        // Get market conditions
        const marketAdjustment = await getMarketAdjustment(rwaCategory);
        
        // Base price calculation (simplified - in reality would use real asset valuations)
        const basePrice = 1.0; // 1:1 for RWA tokens
        const adjustedPrice = basePrice * marketAdjustment * effectiveDiscount;

        // Get quote currency rate (if not XRP)
        let quoteCurrencyRate = 1.0;
        if (quoteCurrency !== 'XRP') {
            quoteCurrencyRate = await getQuoteCurrencyRate(quoteCurrency);
        }

        const finalPrice = adjustedPrice * quoteCurrencyRate;

        res.json({
            success: true,
            tradingPair,
            price: finalPrice,
            basePrice,
            marketAdjustment,
            discountRate: effectiveDiscount,
            quoteCurrencyRate,
            category: rwaCategory,
            timestamp: new Date().toISOString(),
            validFor: 300 // Valid for 5 minutes
        });

    } catch (error) {
        req.logger?.error('Price retrieval failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get Oracle price',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/oracle/categories
 * Get all supported RWA asset categories with their configurations
 */
router.get('/categories', async (req, res) => {
    try {
        const { oracleService } = req.services;
        const assetCategories = oracleService.getAssetCategories();

        const categories = Object.entries(assetCategories).map(([category, config]) => ({
            category,
            name: config.name,
            discountRate: config.discountRate,
            maxValue: config.maxValue,
            requiredDocuments: config.requiredDocs || [],
            currencyPrefix: getCurrencyPrefix(category),
            description: getCategoryDescription(category),
            riskLevel: getCategoryRiskLevel(category),
            liquidityScore: getCategoryLiquidityScore(category)
        }));

        res.json({
            success: true,
            categories,
            totalCategories: categories.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Categories retrieval failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get asset categories',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/oracle/valuation
 * Get current asset valuation with market adjustments
 */
router.post('/valuation', oracleLimiter, async (req, res) => {
    try {
        // Validate request
        const { error, value } = valuationSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid valuation parameters',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { oracleService } = req.services;
        const { assetData, marketConditions = {} } = value;

        // Perform asset valuation
        const valuation = await performAssetValuation(assetData, marketConditions, oracleService);

        res.json({
            success: true,
            assetId: assetData.id,
            valuation: {
                originalValue: assetData.originalValue,
                currentValue: valuation.currentValue,
                marketAdjustment: valuation.marketAdjustment,
                ageAdjustment: valuation.ageAdjustment,
                conditionAdjustment: valuation.conditionAdjustment,
                finalValue: valuation.finalValue,
                confidence: valuation.confidence,
                swapValue: valuation.swapValue,
                discountRate: valuation.discountRate
            },
            marketData: valuation.marketData,
            validUntil: valuation.validUntil,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Asset valuation failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to perform asset valuation',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/oracle/confidence/:tokenId
 * Get confidence score for RWA token valuation
 */
router.get('/confidence/:tokenId', [
    param('tokenId').isString().isLength({ min: 1, max: 64 }).withMessage('Invalid token ID format')
], async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Invalid parameters',
                errors: errors.array()
            });
        }

        const { tokenId } = req.params;
        const { oracleService } = req.services;

        // Get confidence score (this would normally query a database or cache)
        const confidenceData = await getTokenConfidenceScore(tokenId, oracleService);

        if (!confidenceData) {
            return res.status(404).json({
                success: false,
                message: 'Token confidence data not found',
                tokenId
            });
        }

        res.json({
            success: true,
            tokenId,
            confidence: {
                score: confidenceData.score,
                factors: confidenceData.factors,
                lastUpdate: confidenceData.lastUpdate,
                dataQuality: confidenceData.dataQuality,
                marketLiquidity: confidenceData.marketLiquidity,
                verificationLevel: confidenceData.verificationLevel
            },
            recommendations: confidenceData.recommendations,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Confidence score retrieval failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get confidence score',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/oracle/market-conditions
 * Get current market conditions affecting RWA valuations
 */
router.get('/market-conditions', async (req, res) => {
    try {
        const marketConditions = await getCurrentMarketConditions();

        res.json({
            success: true,
            marketConditions: {
                general: marketConditions.general,
                byCategory: marketConditions.byCategory,
                indicators: marketConditions.indicators,
                alerts: marketConditions.alerts
            },
            lastUpdated: marketConditions.lastUpdated,
            nextUpdate: marketConditions.nextUpdate,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Market conditions retrieval failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get market conditions',
            timestamp: new Date().toISOString()
        });
    }
});

// Helper functions

function getRWACategoryFromCurrency(currency) {
    const categoryMap = {
        'rPROP': 'REAL_ESTATE',
        'rMETL': 'PRECIOUS_METALS',
        'rVEHI': 'VEHICLES',
        'rCOLL': 'COLLECTIBLES',
        'rEQIP': 'EQUIPMENT'
    };
    
    const prefix = currency.substring(0, 5);
    return categoryMap[prefix];
}

function getCurrencyPrefix(category) {
    const prefixes = {
        REAL_ESTATE: 'rPROP',
        PRECIOUS_METALS: 'rMETL',
        VEHICLES: 'rVEHI',
        COLLECTIBLES: 'rCOLL',
        EQUIPMENT: 'rEQIP'
    };
    return prefixes[category] || 'rRWA';
}

function getCategoryDescription(category) {
    const descriptions = {
        REAL_ESTATE: 'Residential and commercial real estate properties',
        PRECIOUS_METALS: 'Gold, silver, platinum and other precious metals',
        VEHICLES: 'Automobiles, motorcycles, boats and aircraft',
        COLLECTIBLES: 'Art, antiques, collectibles and memorabilia',
        EQUIPMENT: 'Industrial equipment, machinery and tools'
    };
    return descriptions[category] || 'Real-world asset category';
}

function getCategoryRiskLevel(category) {
    const riskLevels = {
        REAL_ESTATE: 'medium',
        PRECIOUS_METALS: 'low',
        VEHICLES: 'high',
        COLLECTIBLES: 'high',
        EQUIPMENT: 'medium'
    };
    return riskLevels[category] || 'medium';
}

function getCategoryLiquidityScore(category) {
    const liquidityScores = {
        REAL_ESTATE: 60,
        PRECIOUS_METALS: 85,
        VEHICLES: 50,
        COLLECTIBLES: 40,
        EQUIPMENT: 55
    };
    return liquidityScores[category] || 50;
}

async function getMarketConditions(category) {
    // Mock market conditions - in production would fetch from real data sources
    return {
        trend: 'stable',
        volatility: 'low',
        liquidityIndex: 75,
        lastUpdated: new Date().toISOString()
    };
}

async function getMarketAdjustment(category) {
    // Mock market adjustment - in production would calculate from real market data
    const adjustments = {
        REAL_ESTATE: 0.98,
        PRECIOUS_METALS: 1.05,
        VEHICLES: 0.92,
        COLLECTIBLES: 0.95,
        EQUIPMENT: 0.90
    };
    return adjustments[category] || 1.0;
}

async function getQuoteCurrencyRate(quoteCurrency) {
    // Mock exchange rates - in production would fetch from price feeds
    const rates = {
        'USDT': 0.5, // 1 XRP = $0.50 (example)
        'USDC': 0.5,
        'USD': 0.5
    };
    return rates[quoteCurrency] || 1.0;
}

async function performAssetValuation(assetData, marketConditions, oracleService) {
    // Simplified valuation logic
    const marketAdjustment = marketConditions.overrideAdjustment || 
        await getMarketAdjustment(assetData.category);
    
    const ageAdjustment = calculateAgeAdjustment(assetData.lastAppraisal);
    const conditionAdjustment = calculateConditionAdjustment(assetData.condition);
    
    const finalValue = assetData.originalValue * marketAdjustment * ageAdjustment * conditionAdjustment;
    
    const assetCategories = oracleService.getAssetCategories();
    const discountRate = assetCategories[assetData.category].discountRate;
    
    return {
        currentValue: finalValue,
        marketAdjustment,
        ageAdjustment,
        conditionAdjustment,
        finalValue,
        confidence: 85,
        swapValue: finalValue * discountRate,
        discountRate,
        marketData: await getMarketConditions(assetData.category),
        validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
    };
}

function calculateAgeAdjustment(lastAppraisal) {
    if (!lastAppraisal) return 0.95; // 5% discount for no recent appraisal
    
    const monthsOld = (Date.now() - new Date(lastAppraisal).getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (monthsOld < 6) return 1.0;
    if (monthsOld < 12) return 0.98;
    if (monthsOld < 24) return 0.95;
    return 0.90;
}

function calculateConditionAdjustment(condition) {
    const adjustments = {
        excellent: 1.05,
        good: 1.0,
        fair: 0.9,
        poor: 0.7
    };
    return adjustments[condition] || 1.0;
}

async function getTokenConfidenceScore(tokenId, oracleService) {
    // Mock confidence data - in production would query actual token data
    return {
        score: 85,
        factors: {
            documentationQuality: 90,
            appraisalRecency: 80,
            marketLiquidity: 85,
            verificationLevel: 90
        },
        lastUpdate: new Date().toISOString(),
        dataQuality: 'high',
        marketLiquidity: 'medium',
        verificationLevel: 'verified',
        recommendations: [
            'Consider updating appraisal within 6 months',
            'Maintain current documentation standards'
        ]
    };
}

async function getCurrentMarketConditions() {
    // Mock market conditions - in production would aggregate from multiple data sources
    return {
        general: {
            trend: 'stable',
            volatility: 'low',
            liquidityIndex: 78
        },
        byCategory: {
            REAL_ESTATE: { trend: 'stable', adjustment: 0.98 },
            PRECIOUS_METALS: { trend: 'bullish', adjustment: 1.05 },
            VEHICLES: { trend: 'bearish', adjustment: 0.92 },
            COLLECTIBLES: { trend: 'stable', adjustment: 0.95 },
            EQUIPMENT: { trend: 'bearish', adjustment: 0.90 }
        },
        indicators: {
            interestRates: 'stable',
            inflation: 'moderate',
            commodityPrices: 'mixed'
        },
        alerts: [],
        lastUpdated: new Date().toISOString(),
        nextUpdate: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
    };
}

// Error handling middleware for this router
router.use((error, req, res, next) => {
    req.logger?.error('Oracle route error:', error);
    
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({
            success: false,
            message: 'Invalid JSON format'
        });
    }

    res.status(500).json({
        success: false,
        message: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;