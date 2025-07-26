/**
 * IME Hummingbot Routes - Liquidity Management and Strategy Configuration
 * Handles Hummingbot integration endpoints for automated liquidity provision
 * 
 * Endpoints:
 * - GET /api/hummingbot/status - Get Hummingbot service status
 * - POST /api/hummingbot/strategy - Create new trading strategy
 * - PUT /api/hummingbot/strategy/:id - Update strategy configuration
 * - DELETE /api/hummingbot/strategy/:id - Stop and remove strategy
 * - GET /api/hummingbot/strategies - List all active strategies
 * - POST /api/hummingbot/swap-request - Handle incoming swap request
 * - GET /api/hummingbot/liquidity/:pair - Check liquidity for trading pair
 * - POST /api/hummingbot/pricing - Update RWA token pricing
 */

const express = require('express');
const joi = require('joi');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');

const router = express.Router();

// Rate limiting for Hummingbot endpoints
const hummingbotLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // 50 requests per window
    message: 'Too many Hummingbot requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
});

const strategyLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 strategy operations per 5 minutes
    message: 'Too many strategy operations, please try again later.'
});

// Validation schemas
const strategySchema = joi.object({
    rwaCategory: joi.string().valid('REAL_ESTATE', 'PRECIOUS_METALS', 'VEHICLES', 'COLLECTIBLES', 'EQUIPMENT').required(),
    targetCurrency: joi.string().valid('XRP', 'USDT', 'USDC').default('XRP'),
    discountRate: joi.number().min(0.1).max(1.0).required(),
    orderSize: joi.number().positive().optional(),
    spreadPercent: joi.number().min(0.1).max(10.0).default(2.0),
    orderLevels: joi.number().integer().min(1).max(5).default(1),
    enabled: joi.boolean().default(true)
});

const swapRequestSchema = joi.object({
    id: joi.string().uuid().required(),
    rwaToken: joi.object({
        currency: joi.string().required(),
        issuer: joi.string().required(),
        amount: joi.number().positive().required()
    }).required(),
    targetCurrency: joi.string().valid('XRP', 'USDT', 'USDC').required(),
    userAddress: joi.string().required(),
    discountRate: joi.number().min(0.1).max(1.0).required(),
    maxSlippage: joi.number().min(0.001).max(0.1).default(0.05),
    timeoutMs: joi.number().min(30000).max(300000).default(120000)
});

const pricingUpdateSchema = joi.object({
    rwaToken: joi.string().required(),
    oraclePrice: joi.number().positive().required(),
    discountRate: joi.number().min(0.1).max(1.0).required(),
    marketAdjustment: joi.number().min(0.1).max(2.0).default(1.0),
    validFor: joi.number().integer().min(60).max(3600).default(300) // seconds
});

/**
 * GET /api/hummingbot/status
 * Get Hummingbot service status and active strategies
 */
router.get('/status', async (req, res) => {
    try {
        const { hummingbotService } = req.services;
        
        if (!hummingbotService) {
            return res.status(503).json({
                success: false,
                message: 'Hummingbot service not available',
                status: 'disabled'
            });
        }

        const status = hummingbotService.getStatus();
        const strategies = hummingbotService.getActiveStrategies();

        res.json({
            success: true,
            status: {
                isRunning: status.isRunning,
                activeStrategies: status.activeStrategies,
                runningStrategies: status.runningStrategies,
                pendingSwaps: status.pendingSwaps,
                configPath: status.configPath
            },
            strategies: strategies.map(strategy => ({
                name: strategy.name,
                rwaCategory: strategy.rwaCategory,
                tradingPair: strategy.tradingPair,
                status: strategy.status,
                createdAt: strategy.createdAt,
                startedAt: strategy.startedAt
            })),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Hummingbot status check failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get Hummingbot status',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/hummingbot/strategy
 * Create new Hummingbot trading strategy for RWA category
 */
router.post('/strategy', strategyLimiter, async (req, res) => {
    try {
        // Validate request
        const { error, value } = strategySchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid strategy parameters',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { hummingbotService } = req.services;
        
        if (!hummingbotService) {
            return res.status(503).json({
                success: false,
                message: 'Hummingbot service not available'
            });
        }

        // Create strategy
        const strategy = await hummingbotService.createRWAStrategy(value);

        res.json({
            success: true,
            strategy: {
                name: strategy.name,
                configFile: strategy.configFile,
                rwaCategory: strategy.rwaCategory,
                tradingPair: strategy.tradingPair,
                discountRate: strategy.discountRate,
                status: strategy.status,
                createdAt: strategy.createdAt
            },
            message: 'Strategy created successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Strategy creation failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create strategy',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * PUT /api/hummingbot/strategy/:strategyName
 * Update existing strategy configuration
 */
router.put('/strategy/:strategyName', strategyLimiter, [
    param('strategyName').isString().isLength({ min: 1, max: 64 }).withMessage('Invalid strategy name')
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

        const { strategyName } = req.params;
        const { hummingbotService } = req.services;
        
        if (!hummingbotService) {
            return res.status(503).json({
                success: false,
                message: 'Hummingbot service not available'
            });
        }

        // Validate update parameters
        const updateSchema = joi.object({
            discountRate: joi.number().min(0.1).max(1.0).optional(),
            spreadPercent: joi.number().min(0.1).max(10.0).optional(),
            orderSize: joi.number().positive().optional(),
            enabled: joi.boolean().optional()
        });

        const { error, value } = updateSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid update parameters',
                errors: error.details.map(detail => detail.message)
            });
        }

        // Update strategy (this would update the YAML config and restart if needed)
        const updateResult = await hummingbotService.updateStrategy(strategyName, value);

        res.json({
            success: true,
            strategyName,
            updatedFields: Object.keys(value),
            status: updateResult.status,
            message: 'Strategy updated successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Strategy update failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update strategy',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * DELETE /api/hummingbot/strategy/:strategyName
 * Stop and remove trading strategy
 */
router.delete('/strategy/:strategyName', strategyLimiter, [
    param('strategyName').isString().isLength({ min: 1, max: 64 }).withMessage('Invalid strategy name')
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

        const { strategyName } = req.params;
        const { hummingbotService } = req.services;
        
        if (!hummingbotService) {
            return res.status(503).json({
                success: false,
                message: 'Hummingbot service not available'
            });
        }

        // Stop and remove strategy
        await hummingbotService.stopStrategy(strategyName);
        const removeResult = await hummingbotService.removeStrategy(strategyName);

        res.json({
            success: true,
            strategyName,
            message: 'Strategy stopped and removed successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Strategy removal failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to remove strategy',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/hummingbot/strategies
 * List all active strategies with performance data
 */
router.get('/strategies', async (req, res) => {
    try {
        const { hummingbotService } = req.services;
        
        if (!hummingbotService) {
            return res.status(503).json({
                success: false,
                message: 'Hummingbot service not available'
            });
        }

        const strategies = hummingbotService.getActiveStrategies();
        const detailedStrategies = strategies.map(strategy => ({
            name: strategy.name,
            rwaCategory: strategy.rwaCategory,
            tradingPair: strategy.tradingPair,
            discountRate: strategy.discountRate,
            status: strategy.status,
            createdAt: strategy.createdAt,
            startedAt: strategy.startedAt,
            performance: strategy.performance || {
                trades: 0,
                volume: 0,
                pnl: 0
            },
            lastActivity: strategy.lastActivity
        }));

        res.json({
            success: true,
            strategies: detailedStrategies,
            totalStrategies: detailedStrategies.length,
            runningStrategies: detailedStrategies.filter(s => s.status === 'running').length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Strategies listing failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to list strategies',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/hummingbot/swap-request
 * Handle incoming swap request for Hummingbot liquidity provision
 */
router.post('/swap-request', hummingbotLimiter, async (req, res) => {
    try {
        // Validate request
        const { error, value } = swapRequestSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid swap request parameters',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { hummingbotService } = req.services;
        
        if (!hummingbotService) {
            return res.status(503).json({
                success: false,
                message: 'Hummingbot service not available'
            });
        }

        // Handle swap request
        const swapResult = await hummingbotService.handleSwapRequest(value);

        res.json({
            success: true,
            swapId: value.id,
            strategyName: swapResult.strategyName,
            estimatedFillTime: swapResult.estimatedFillTime,
            status: 'processing',
            message: 'Swap request submitted to Hummingbot',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Swap request handling failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to handle swap request',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/hummingbot/liquidity/:tradingPair
 * Check available liquidity for trading pair
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
        const { hummingbotService } = req.services;
        
        if (!hummingbotService) {
            return res.status(503).json({
                success: false,
                message: 'Hummingbot service not available'
            });
        }

        // Check liquidity
        const liquidityCheck = await hummingbotService.checkLiquidity(tradingPair, parseFloat(amount));

        res.json({
            success: true,
            tradingPair,
            requestedAmount: parseFloat(amount),
            liquidity: {
                available: liquidityCheck.available,
                availableAmount: liquidityCheck.availableAmount,
                rate: liquidityCheck.rate,
                confidence: liquidityCheck.confidence,
                estimatedFillTime: liquidityCheck.estimatedFillTime || 30
            },
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

/**
 * POST /api/hummingbot/pricing
 * Update RWA token pricing for Hummingbot strategies
 */
router.post('/pricing', hummingbotLimiter, async (req, res) => {
    try {
        // Validate request
        const { error, value } = pricingUpdateSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid pricing parameters',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { hummingbotService } = req.services;
        
        if (!hummingbotService) {
            return res.status(503).json({
                success: false,
                message: 'Hummingbot service not available'
            });
        }

        // Update pricing
        await hummingbotService.updateRWAPricing(
            value.rwaToken,
            value.oraclePrice,
            value.discountRate
        );

        res.json({
            success: true,
            rwaToken: value.rwaToken,
            oraclePrice: value.oraclePrice,
            discountRate: value.discountRate,
            swapPrice: value.oraclePrice * value.discountRate,
            validFor: value.validFor,
            message: 'Pricing updated successfully',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Pricing update failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update pricing',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/hummingbot/performance
 * Get performance statistics for all Hummingbot strategies
 */
router.get('/performance', async (req, res) => {
    try {
        const { hummingbotService } = req.services;
        
        if (!hummingbotService) {
            return res.status(503).json({
                success: false,
                message: 'Hummingbot service not available'
            });
        }

        const strategies = hummingbotService.getActiveStrategies();
        const performanceData = {
            totalStrategies: strategies.length,
            runningStrategies: strategies.filter(s => s.status === 'running').length,
            totalTrades: 0,
            totalVolume: 0,
            totalPnL: 0,
            byCategory: {},
            topPerformers: []
        };

        // Aggregate performance data
        strategies.forEach(strategy => {
            const perf = strategy.performance || { trades: 0, volume: 0, pnl: 0 };
            
            performanceData.totalTrades += perf.trades;
            performanceData.totalVolume += perf.volume;
            performanceData.totalPnL += perf.pnl;

            // By category
            if (!performanceData.byCategory[strategy.rwaCategory]) {
                performanceData.byCategory[strategy.rwaCategory] = {
                    trades: 0,
                    volume: 0,
                    pnl: 0,
                    strategies: 0
                };
            }
            
            const categoryData = performanceData.byCategory[strategy.rwaCategory];
            categoryData.trades += perf.trades;
            categoryData.volume += perf.volume;
            categoryData.pnl += perf.pnl;
            categoryData.strategies++;
        });

        // Top performers
        performanceData.topPerformers = strategies
            .filter(s => s.performance)
            .sort((a, b) => (b.performance.pnl || 0) - (a.performance.pnl || 0))
            .slice(0, 5)
            .map(s => ({
                name: s.name,
                category: s.rwaCategory,
                pnl: s.performance.pnl,
                volume: s.performance.volume,
                trades: s.performance.trades
            }));

        res.json({
            success: true,
            performance: performanceData,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Performance data retrieval failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get performance data',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * POST /api/hummingbot/emergency-stop
 * Emergency stop all Hummingbot strategies
 */
router.post('/emergency-stop', strategyLimiter, async (req, res) => {
    try {
        const { hummingbotService } = req.services;
        
        if (!hummingbotService) {
            return res.status(503).json({
                success: false,
                message: 'Hummingbot service not available'
            });
        }

        const strategies = hummingbotService.getActiveStrategies();
        const stopResults = [];

        // Stop all running strategies
        for (const strategy of strategies) {
            if (strategy.status === 'running') {
                try {
                    await hummingbotService.stopStrategy(strategy.name);
                    stopResults.push({
                        name: strategy.name,
                        status: 'stopped',
                        stoppedAt: new Date().toISOString()
                    });
                } catch (error) {
                    stopResults.push({
                        name: strategy.name,
                        status: 'error',
                        error: error.message
                    });
                }
            }
        }

        res.json({
            success: true,
            message: 'Emergency stop executed',
            stoppedStrategies: stopResults.length,
            results: stopResults,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        req.logger?.error('Emergency stop failed:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to execute emergency stop',
            timestamp: new Date().toISOString()
        });
    }
});

// Error handling middleware for this router
router.use((error, req, res, next) => {
    req.logger?.error('Hummingbot route error:', error);
    
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