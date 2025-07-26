/**
 * IME Swap Routes - RWA Token Swap API Endpoints
 * Handles all API endpoints for RWA token swap operations
 * 
 * Endpoints:
 * - POST /api/swap/quote - Generate swap quote
 * - POST /api/swap/execute - Execute swap
 * - GET /api/swap/status/:swapId - Get swap status
 * - GET /api/swap/history/:userAddress - Get user swap history
 * - GET /api/swap/stats - Get platform swap statistics
 * - POST /api/swap/estimate - Get fee estimate
 */

const express = require('express');
const joi = require('joi');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');

const router = express.Router();

// Rate limiting for swap endpoints
const swapLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 swaps per window
    message: 'Too many swap requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
});

const quoteLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 quotes per minute
    message: 'Too many quote requests, please try again later.'
});

// Validation schemas
const quoteRequestSchema = joi.object({
    rwaToken: joi.object({
        currency: joi.string().required(),
        issuer: joi.string().required(),
        amount: joi.number().positive().required()
    }).required(),
    targetCurrency: joi.string().valid('XRP', 'USDT', 'USDC', 'USD').required(),
    userAddress: joi.string().required(),
    slippageTolerance: joi.number().min(0.001).max(0.1).default(0.05),
    preferredSources: joi.array().items(joi.string().valid('hummingbot', 'xrpl_dex', 'fireblocks')).optional()
});

const executeSwapSchema = joi.object({
    quoteId: joi.string().uuid().required(),
    userWallet: joi.object({
        address: joi.string().required(),
        publicKey: joi.string().required()
    }).required(),
    maxSlippage: joi.number().min(0.001).max(0.1).default(0.05),
    timeoutMs: joi.number().min(30000).max(300000).default(60000)
});

const estimateSchema = joi.object({
    swapAmount: joi.number().positive().required(),
    userAddress: joi.string().required(),
    rwaCategory: joi.string().valid('REAL_ESTATE', 'PRECIOUS_METALS', 'VEHICLES', 'COLLECTIBLES', 'EQUIPMENT').optional(),
    targetCurrency: joi.string().valid('XRP', 'USDT', 'USDC', 'USD').default('XRP'),
    isInstitutional: joi.boolean().default(false)
});

/**
 * POST /api/swap/quote
 * Generate a swap quote for RWA token → Crypto
 */
router.post('/quote', quoteLimiter, async (req, res) => {
    try {
        // Validate request
        const { error, value } = quoteRequestSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid request parameters',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { swapEngine } = req.services;
        
        // Generate quote
        const quoteResult = await swapEngine.generateQuote(value);

        res.json({
            success: true,
            quote: quoteResult.quote,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Quote generation failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate quote',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/swap/execute
 * Execute a swap based on a quote
 */
router.post('/execute', swapLimiter, async (req, res) => {
    try {
        // Validate request
        const { error, value } = executeSwapSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid execution parameters',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { swapEngine } = req.services;
        
        // Execute swap
        const executionResult = await swapEngine.executeSwap(value.quoteId, value);

        res.json({
            success: true,
            swapId: executionResult.swapId,
            transactionHash: executionResult.transactionHash,
            outputAmount: executionResult.outputAmount,
            estimatedCompletionTime: new Date(Date.now() + 60000).toISOString(), // 1 min estimate
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Swap execution failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to execute swap',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/swap/status/:swapId
 * Get the status of a specific swap
 */
router.get('/status/:swapId', [
    param('swapId').isUUID().withMessage('Invalid swap ID format')
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

        const { swapId } = req.params;
        const { swapEngine } = req.services;
        
        // Get swap status
        const statusResult = swapEngine.getSwapStatus(swapId);
        
        if (!statusResult.found) {
            return res.status(404).json({
                success: false,
                message: 'Swap not found',
                swapId
            });
        }

        res.json({
            success: true,
            swapId,
            status: statusResult.status,
            progress: statusResult.progress,
            steps: statusResult.steps,
            transactionHash: statusResult.transactionHash,
            executionTimeMs: statusResult.executionTimeMs,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Status check failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get swap status',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/swap/history/:userAddress
 * Get swap history for a user
 */
router.get('/history/:userAddress', [
    param('userAddress').isString().isLength({ min: 25, max: 34 }).withMessage('Invalid XRPL address format'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
    query('status').optional().isIn(['pending', 'completed', 'failed', 'cancelled']).withMessage('Invalid status filter')
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

        const { userAddress } = req.params;
        const { limit = 20, offset = 0, status } = req.query;
        const { swapEngine } = req.services;

        // Get user swap history
        const history = swapEngine.getUserSwapHistory(userAddress, {
            limit: parseInt(limit),
            offset: parseInt(offset),
            statusFilter: status
        });

        res.json({
            success: true,
            userAddress,
            swaps: history.swaps,
            totalCount: history.totalCount,
            limit: parseInt(limit),
            offset: parseInt(offset),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('History retrieval failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get swap history',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/swap/stats
 * Get platform swap statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const { swapEngine, feeManager, hummingbotService, dexRouter } = req.services;

        // Aggregate statistics from all services
        const swapStats = swapEngine.getStatistics();
        const feeStats = feeManager.getRevenueAnalytics();
        const hummingbotStats = hummingbotService ? hummingbotService.getStatus() : null;
        const dexStats = dexRouter.getStatistics();

        const platformStats = {
            swaps: {
                total: swapStats.activeSwaps + swapStats.swapHistorySize,
                active: swapStats.activeSwaps,
                completed: swapStats.swapHistorySize,
                successRate: swapStats.successRate || 0,
                avgExecutionTime: swapStats.avgSwapTime || 0
            },
            volume: {
                total: feeStats.totalSwapVolume,
                monthly: feeStats.monthlyRecurring,
                avgTransactionSize: feeStats.avgTransactionSize
            },
            fees: {
                totalCollected: feeStats.totalFeesCollected,
                avgFeePercent: feeStats.avgFeePercent,
                monthlyRevenue: feeStats.monthlyRecurring
            },
            liquidity: {
                hummingbot: hummingbotStats ? {
                    connected: hummingbotStats.connected,
                    activeStrategies: hummingbotStats.activeStrategies
                } : null,
                dex: {
                    cachedAMMs: dexStats.cachedAMMs,
                    activeOrders: dexStats.activeOrders
                }
            },
            timestamp: new Date().toISOString()
        };

        res.json({
            success: true,
            stats: platformStats
        });

    } catch (error) {
        req.logger?.error('Stats retrieval failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get platform statistics',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/swap/estimate
 * Get fee estimate for a potential swap
 */
router.post('/estimate', async (req, res) => {
    try {
        // Validate request
        const { error, value } = estimateSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid estimate parameters',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { feeManager } = req.services;
        
        // Get fee estimate
        const estimate = feeManager.getFeeEstimate(
            value.swapAmount,
            value.userAddress,
            {
                rwaCategory: value.rwaCategory,
                targetCurrency: value.targetCurrency,
                isInstitutional: value.isInstitutional
            }
        );

        res.json({
            success: true,
            estimate: {
                swapAmount: value.swapAmount,
                estimatedFee: estimate.estimatedFee,
                effectiveFeePercent: estimate.effectiveFeePercent,
                netAmount: value.swapAmount - estimate.estimatedFee,
                userTier: estimate.userTier,
                appliedDiscounts: estimate.appliedDiscounts,
                breakdown: estimate.breakdown
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Estimate calculation failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to calculate estimate',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/swap/supported-assets
 * Get list of supported RWA token types and target currencies
 */
router.get('/supported-assets', async (req, res) => {
    try {
        const { oracleService } = req.services;
        
        const assetCategories = oracleService.getAssetCategories();
        const supportedAssets = Object.entries(assetCategories).map(([category, config]) => ({
            category,
            name: config.name,
            discountRate: config.discountRate,
            maxValue: config.maxValue,
            currencyPrefix: getCurrencyPrefix(category)
        }));

        const targetCurrencies = [
            { symbol: 'XRP', name: 'XRP', type: 'native' },
            { symbol: 'USDT', name: 'Tether USD', type: 'stablecoin' },
            { symbol: 'USDC', name: 'USD Coin', type: 'stablecoin' },
            { symbol: 'USD', name: 'US Dollar', type: 'fiat' }
        ];

        res.json({
            success: true,
            supportedAssets,
            targetCurrencies,
            defaultDiscountRates: Object.fromEntries(
                Object.entries(assetCategories).map(([category, config]) => [
                    category, 
                    config.discountRate
                ])
            ),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Supported assets retrieval failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get supported assets',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/swap/liquidity/:tradingPair
 * Check available liquidity for a trading pair
 */
router.get('/liquidity/:tradingPair', [
    param('tradingPair').matches(/^[A-Z0-9]+\/[A-Z0-9]+$/).withMessage('Invalid trading pair format'),
    query('amount').optional().isFloat({ min: 0.01 }).withMessage('Amount must be positive')
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
        const { amount = 1000 } = req.query;
        const { dexRouter, hummingbotService, fireblocksService } = req.services;

        const [fromCurrency, toCurrency] = tradingPair.split('/');

        // Check liquidity from all sources
        const liquiditySources = [];

        // DEX Router (XRPL native)
        const dexLiquidity = await dexRouter.checkLiquidity(fromCurrency, toCurrency, parseFloat(amount));
        if (dexLiquidity.available) {
            liquiditySources.push({
                source: 'xrpl_dex',
                available: dexLiquidity.availableAmount,
                rate: dexLiquidity.rate,
                slippage: dexLiquidity.slippage
            });
        }

        // Hummingbot
        if (hummingbotService) {
            const hbLiquidity = await hummingbotService.checkLiquidity(tradingPair, parseFloat(amount));
            if (hbLiquidity.available) {
                liquiditySources.push({
                    source: 'hummingbot',
                    available: hbLiquidity.availableAmount,
                    rate: hbLiquidity.rate,
                    confidence: hbLiquidity.confidence
                });
            }
        }

        // Fireblocks
        if (fireblocksService && toCurrency !== fromCurrency) {
            const fbLiquidity = await fireblocksService.checkLiquidity(toCurrency, parseFloat(amount));
            if (fbLiquidity.available) {
                liquiditySources.push({
                    source: 'fireblocks',
                    available: fbLiquidity.availableAmount,
                    estimatedSettlementTime: fbLiquidity.estimatedSettlementTime
                });
            }
        }

        const totalLiquidity = liquiditySources.reduce((sum, source) => sum + source.available, 0);
        const bestRate = Math.max(...liquiditySources.map(source => source.rate || 0));

        res.json({
            success: true,
            tradingPair,
            requestedAmount: parseFloat(amount),
            totalLiquidity,
            bestRate,
            hasSufficientLiquidity: totalLiquidity >= parseFloat(amount),
            sources: liquiditySources,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Liquidity check failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to check liquidity',
            timestamp: new Date().toISOString()
        });
    }
});

// Helper function to get currency prefix for asset category
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

// Error handling middleware for this router
router.use((error, req, res, next) => {
    req.logger?.error('Swap route error:', error);
    
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