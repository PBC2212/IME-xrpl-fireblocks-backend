/**
 * IME Liquidity Router - Unified Multi-Provider Routing System
 * Intelligently routes RWA swaps across Fireblocks, Sologenic, and GateHub
 * 
 * Features:
 * - Smart provider selection based on swap parameters
 * - Multi-provider liquidity aggregation
 * - Fallback routing for failed providers
 * - Cost optimization across providers
 * - Real-time provider monitoring
 * - Performance-based routing decisions
 */

const crypto = require('crypto');
const moment = require('moment');
const winston = require('winston');

class LiquidityRouter {
    constructor(config) {
        this.config = {
            enableSmartRouting: config.enableSmartRouting !== false,
            enableFallbackRouting: config.enableFallbackRouting !== false,
            maxRoutingAttempts: config.maxRoutingAttempts || 3,
            routingTimeoutMs: config.routingTimeoutMs || 30000,
            performanceWindow: config.performanceWindow || 24 * 60 * 60 * 1000, // 24 hours
            ...config
        };

        // Injected liquidity providers
        this.providers = {
            fireblocks: config.fireblocksService,
            sologenic: config.sologenicService,
            gatehub: config.gateHubService
        };

        // Routing thresholds and rules
        this.routingRules = {
            retail: {
                minAmount: 10,
                maxAmount: 50000,
                preferredProviders: ['gatehub', 'sologenic'],
                fallbackProviders: ['fireblocks']
            },
            institutional: {
                minAmount: 10000,
                maxAmount: 1000000,
                preferredProviders: ['fireblocks', 'sologenic'],
                fallbackProviders: ['gatehub']
            },
            enterprise: {
                minAmount: 100000,
                maxAmount: 10000000,
                preferredProviders: ['fireblocks'],
                fallbackProviders: ['sologenic']
            }
        };

        // Provider performance tracking
        this.providerMetrics = new Map();
        this.initializeProviderMetrics();

        // Active routing sessions
        this.activeRoutings = new Map();
        this.routingHistory = new Map();

        // Statistics
        this.stats = {
            totalRoutings: 0,
            successfulRoutings: 0,
            failedRoutings: 0,
            avgRoutingTime: 0,
            providerUsage: {
                fireblocks: 0,
                sologenic: 0,
                gatehub: 0
            },
            fallbackUsage: 0
        };

        // Initialize logger
        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            defaultMeta: { service: 'liquidity-router' },
            transports: [
                new winston.transports.File({ filename: 'logs/router-error.log', level: 'error' }),
                new winston.transports.File({ filename: 'logs/router-combined.log' }),
                new winston.transports.Console({
                    format: winston.format.simple()
                })
            ]
        });
    }

    /**
     * Initialize Liquidity Router
     */
    async initialize() {
        try {
            this.logger.info('Initializing Liquidity Router...');

            // Verify provider availability
            await this.verifyProviders();

            // Start monitoring
            this.startProviderMonitoring();

            this.logger.info('Liquidity Router initialized successfully', {
                availableProviders: Object.keys(this.providers).filter(p => this.providers[p]),
                smartRouting: this.config.enableSmartRouting,
                fallbackRouting: this.config.enableFallbackRouting
            });

        } catch (error) {
            this.logger.error('Failed to initialize Liquidity Router:', error);
            throw error;
        }
    }

    /**
     * Route RWA swap to optimal provider
     * @param {Object} swapRequest - Swap request parameters
     * @returns {Object} Routing and execution result
     */
    async routeSwap(swapRequest) {
        try {
            const {
                rwaToken,
                targetCurrency,
                amount,
                userAddress,
                userType = 'retail',
                maxSlippage = 0.05,
                preferredProvider = null
            } = swapRequest;

            this.logger.info('Routing RWA swap', {
                rwaToken: rwaToken.currency,
                targetCurrency,
                amount,
                userType,
                preferredProvider
            });

            const routingId = crypto.randomUUID();
            const routingSession = {
                id: routingId,
                swapRequest,
                userType,
                status: 'routing',
                startTime: new Date().toISOString(),
                attempts: [],
                selectedProvider: null,
                executionResult: null
            };

            this.activeRoutings.set(routingId, routingSession);

            try {
                // Step 1: Determine routing strategy
                const routingStrategy = await this.determineRoutingStrategy(swapRequest);

                // Step 2: Select optimal provider
                const selectedProvider = await this.selectOptimalProvider(
                    swapRequest,
                    routingStrategy,
                    preferredProvider
                );

                // Step 3: Execute swap with selected provider
                const executionResult = await this.executeWithProvider(
                    routingSession,
                    selectedProvider,
                    swapRequest
                );

                // Step 4: Handle successful routing
                routingSession.status = 'completed';
                routingSession.selectedProvider = selectedProvider;
                routingSession.executionResult = executionResult;
                routingSession.endTime = new Date().toISOString();

                this.updateRoutingStatistics(routingSession, true);

                this.logger.info('Swap routing completed successfully', {
                    routingId,
                    selectedProvider,
                    executionTime: new Date(routingSession.endTime) - new Date(routingSession.startTime)
                });

                return {
                    success: true,
                    routingId,
                    selectedProvider,
                    executionResult,
                    routingTime: new Date(routingSession.endTime) - new Date(routingSession.startTime)
                };

            } catch (error) {
                // Step 5: Handle routing failure with fallback
                if (this.config.enableFallbackRouting) {
                    return await this.handleRoutingFailure(routingSession, error);
                } else {
                    throw error;
                }
            }

        } catch (error) {
            this.logger.error('Swap routing failed:', error);
            throw error;
        }
    }

    /**
     * Determine optimal routing strategy
     */
    async determineRoutingStrategy(swapRequest) {
        try {
            const { amount, userType } = swapRequest;

            // Determine user tier based on amount and type
            let tier = 'retail';
            if (userType === 'institutional' || amount >= 10000) {
                tier = 'institutional';
            }
            if (userType === 'enterprise' || amount >= 100000) {
                tier = 'enterprise';
            }

            const strategy = {
                tier,
                rules: this.routingRules[tier],
                prioritizePerformance: amount > 50000,
                prioritizeCost: amount < 10000,
                allowFallback: this.config.enableFallbackRouting,
                maxAttempts: this.config.maxRoutingAttempts
            };

            this.logger.debug('Routing strategy determined', strategy);
            return strategy;

        } catch (error) {
            this.logger.error('Failed to determine routing strategy:', error);
            throw error;
        }
    }

    /**
     * Select optimal provider based on strategy
     */
    async selectOptimalProvider(swapRequest, strategy, preferredProvider) {
        try {
            const { amount, rwaToken, targetCurrency } = swapRequest;

            // If preferred provider specified and available, use it
            if (preferredProvider && this.providers[preferredProvider]) {
                const providerCheck = await this.checkProviderCapability(
                    preferredProvider,
                    swapRequest
                );
                if (providerCheck.capable) {
                    return preferredProvider;
                }
            }

            // Get provider scores
            const providerScores = await this.scoreProviders(swapRequest, strategy);

            // Sort by score (highest first)
            const sortedProviders = Object.entries(providerScores)
                .sort(([,a], [,b]) => b.totalScore - a.totalScore)
                .filter(([provider, score]) => score.capable);

            if (sortedProviders.length === 0) {
                throw new Error('No capable providers available for this swap');
            }

            const selectedProvider = sortedProviders[0][0];
            const selectedScore = sortedProviders[0][1];

            this.logger.info('Provider selected', {
                selectedProvider,
                score: selectedScore.totalScore,
                alternatives: sortedProviders.slice(1, 3).map(([p, s]) => ({
                    provider: p,
                    score: s.totalScore
                }))
            });

            return selectedProvider;

        } catch (error) {
            this.logger.error('Provider selection failed:', error);
            throw error;
        }
    }

    /**
     * Score all available providers
     */
    async scoreProviders(swapRequest, strategy) {
        const scores = {};

        for (const [providerName, provider] of Object.entries(this.providers)) {
            if (!provider) continue;

            try {
                const score = await this.scoreProvider(providerName, swapRequest, strategy);
                scores[providerName] = score;
            } catch (error) {
                this.logger.debug(`Failed to score provider ${providerName}:`, error);
                scores[providerName] = {
                    capable: false,
                    totalScore: 0,
                    error: error.message
                };
            }
        }

        return scores;
    }

    /**
     * Score individual provider
     */
    async scoreProvider(providerName, swapRequest, strategy) {
        const { amount, rwaToken, targetCurrency } = swapRequest;
        const provider = this.providers[providerName];

        // Check basic capability
        const capability = await this.checkProviderCapability(providerName, swapRequest);
        if (!capability.capable) {
            return {
                capable: false,
                totalScore: 0,
                reason: capability.reason
            };
        }

        let score = 0;
        const factors = {};

        // Factor 1: Liquidity availability (30% weight)
        const liquidityScore = await this.scoreLiquidity(providerName, swapRequest);
        factors.liquidity = liquidityScore;
        score += liquidityScore * 0.3;

        // Factor 2: Cost efficiency (25% weight)
        const costScore = await this.scoreCost(providerName, swapRequest);
        factors.cost = costScore;
        score += costScore * 0.25;

        // Factor 3: Performance history (20% weight)
        const performanceScore = this.scorePerformance(providerName);
        factors.performance = performanceScore;
        score += performanceScore * 0.2;

        // Factor 4: Provider preference for tier (15% weight)
        const tierScore = this.scoreTierPreference(providerName, strategy.tier);
        factors.tierPreference = tierScore;
        score += tierScore * 0.15;

        // Factor 5: Settlement speed (10% weight)
        const speedScore = this.scoreSettlementSpeed(providerName, amount);
        factors.speed = speedScore;
        score += speedScore * 0.1;

        return {
            capable: true,
            totalScore: Math.round(score),
            factors,
            recommendation: this.getProviderRecommendation(score)
        };
    }

    /**
     * Score liquidity availability
     */
    async scoreLiquidity(providerName, swapRequest) {
        try {
            const { rwaToken, targetCurrency, amount } = swapRequest;
            const provider = this.providers[providerName];

            let liquidity;
            const tradingPair = `${rwaToken.currency}/${targetCurrency}`;

            // Check liquidity based on provider type
            switch (providerName) {
                case 'fireblocks':
                    liquidity = await provider.checkLiquidity(targetCurrency, amount);
                    break;
                case 'sologenic':
                    liquidity = await provider.checkLiquidity(tradingPair, amount);
                    break;
                case 'gatehub':
                    liquidity = await provider.checkRetailLiquidity(tradingPair, amount);
                    break;
                default:
                    return 0;
            }

            if (!liquidity.available) return 0;

            // Score based on availability ratio and confidence
            const availabilityRatio = Math.min(liquidity.availableAmount / amount, 1);
            const confidenceScore = liquidity.confidence || 50;

            return Math.round((availabilityRatio * 50) + (confidenceScore / 2));

        } catch (error) {
            this.logger.debug(`Liquidity scoring failed for ${providerName}:`, error);
            return 0;
        }
    }

    /**
     * Score cost efficiency
     */
    async scoreCost(providerName, swapRequest) {
        try {
            const { amount } = swapRequest;

            // Estimate fees for each provider
            const feeEstimates = {
                fireblocks: amount * 0.005, // 0.5% custody + network
                sologenic: amount * 0.0025, // 0.25% + XRPL fees
                gatehub: amount * 0.005     // 0.5% + spread
            };

            const providerFee = feeEstimates[providerName] || amount * 0.01;
            const lowestFee = Math.min(...Object.values(feeEstimates));

            // Score inversely proportional to relative cost
            const costRatio = lowestFee / providerFee;
            return Math.round(costRatio * 100);

        } catch (error) {
            this.logger.debug(`Cost scoring failed for ${providerName}:`, error);
            return 50; // Default score
        }
    }

    /**
     * Score performance history
     */
    scorePerformance(providerName) {
        const metrics = this.providerMetrics.get(providerName);
        if (!metrics) return 50; // Default score

        const { successRate, avgResponseTime, uptime } = metrics;

        // Weighted performance score
        const performanceScore = (
            (successRate * 0.5) +
            (Math.max(0, 100 - (avgResponseTime / 100)) * 0.3) +
            (uptime * 0.2)
        );

        return Math.round(performanceScore);
    }

    /**
     * Score tier preference
     */
    scoreTierPreference(providerName, tier) {
        const preferences = this.routingRules[tier].preferredProviders;
        const fallbacks = this.routingRules[tier].fallbackProviders;

        if (preferences.includes(providerName)) {
            return 100;
        } else if (fallbacks.includes(providerName)) {
            return 60;
        } else {
            return 30;
        }
    }

    /**
     * Score settlement speed
     */
    scoreSettlementSpeed(providerName, amount) {
        const speedEstimates = {
            fireblocks: amount > 100000 ? 300 : 120, // 2-5 minutes for large amounts
            sologenic: 30, // 30 seconds for XRPL native
            gatehub: 60 // 1 minute for retail
        };

        const providerSpeed = speedEstimates[providerName] || 120;
        const fastestSpeed = Math.min(...Object.values(speedEstimates));

        // Score inversely proportional to time
        const speedRatio = fastestSpeed / providerSpeed;
        return Math.round(speedRatio * 100);
    }

    /**
     * Get provider recommendation
     */
    getProviderRecommendation(score) {
        if (score >= 80) return 'excellent';
        if (score >= 70) return 'good';
        if (score >= 60) return 'fair';
        return 'poor';
    }

    /**
     * Check provider capability
     */
    async checkProviderCapability(providerName, swapRequest) {
        try {
            const { amount, userType } = swapRequest;
            const provider = this.providers[providerName];

            if (!provider) {
                return { capable: false, reason: 'Provider not available' };
            }

            // Check provider-specific limits
            switch (providerName) {
                case 'fireblocks':
                    if (amount < 1000) {
                        return { capable: false, reason: 'Amount below institutional minimum' };
                    }
                    break;
                case 'gatehub':
                    if (amount > 50000) {
                        return { capable: false, reason: 'Amount exceeds retail maximum' };
                    }
                    break;
                case 'sologenic':
                    // Sologenic generally capable for all amounts
                    break;
            }

            return { capable: true };

        } catch (error) {
            return { capable: false, reason: error.message };
        }
    }

    /**
     * Execute swap with selected provider
     */
    async executeWithProvider(routingSession, providerName, swapRequest) {
        try {
            const provider = this.providers[providerName];
            const startTime = Date.now();

            this.logger.info('Executing swap with provider', {
                routingId: routingSession.id,
                provider: providerName
            });

            // Record attempt
            const attempt = {
                provider: providerName,
                startTime: new Date().toISOString(),
                status: 'executing'
            };
            routingSession.attempts.push(attempt);

            let result;
            
            // Execute based on provider type
            switch (providerName) {
                case 'fireblocks':
                    // For Fireblocks, use the RWA swap method
                    result = await provider.executeRWASwap({
                        custodyId: swapRequest.custodyId, // Would need to be provided
                        targetCurrency: swapRequest.targetCurrency,
                        targetAmount: swapRequest.amount,
                        maxSlippage: swapRequest.maxSlippage
                    });
                    break;
                    
                case 'sologenic':
                    result = await provider.executeRWASwap(swapRequest);
                    break;
                    
                case 'gatehub':
                    result = await provider.executeRetailSwap(swapRequest);
                    break;
                    
                default:
                    throw new Error(`Unknown provider: ${providerName}`);
            }

            // Record successful attempt
            attempt.status = 'completed';
            attempt.endTime = new Date().toISOString();
            attempt.executionTime = Date.now() - startTime;
            attempt.result = result;

            // Update provider metrics
            this.updateProviderMetrics(providerName, true, Date.now() - startTime);

            // Update usage statistics
            this.stats.providerUsage[providerName]++;

            return result;

        } catch (error) {
            // Record failed attempt
            const attempt = routingSession.attempts[routingSession.attempts.length - 1];
            if (attempt) {
                attempt.status = 'failed';
                attempt.endTime = new Date().toISOString();
                attempt.error = error.message;
            }

            // Update provider metrics
            this.updateProviderMetrics(providerName, false, Date.now() - startTime);

            this.logger.error(`Provider ${providerName} execution failed:`, error);
            throw error;
        }
    }

    /**
     * Handle routing failure with fallback
     */
    async handleRoutingFailure(routingSession, originalError) {
        try {
            this.logger.warn('Primary routing failed, attempting fallback', {
                routingId: routingSession.id,
                error: originalError.message
            });

            const { swapRequest } = routingSession;
            const strategy = await this.determineRoutingStrategy(swapRequest);

            // Get fallback providers
            const fallbackProviders = strategy.rules.fallbackProviders;
            
            for (const providerName of fallbackProviders) {
                if (routingSession.attempts.some(a => a.provider === providerName)) {
                    continue; // Skip already attempted providers
                }

                try {
                    const capability = await this.checkProviderCapability(providerName, swapRequest);
                    if (!capability.capable) continue;

                    const executionResult = await this.executeWithProvider(
                        routingSession,
                        providerName,
                        swapRequest
                    );

                    // Successful fallback
                    routingSession.status = 'completed_fallback';
                    routingSession.selectedProvider = providerName;
                    routingSession.executionResult = executionResult;
                    routingSession.endTime = new Date().toISOString();

                    this.stats.fallbackUsage++;
                    this.updateRoutingStatistics(routingSession, true);

                    this.logger.info('Fallback routing successful', {
                        routingId: routingSession.id,
                        fallbackProvider: providerName
                    });

                    return {
                        success: true,
                        routingId: routingSession.id,
                        selectedProvider: providerName,
                        executionResult,
                        fallbackUsed: true,
                        originalError: originalError.message
                    };

                } catch (fallbackError) {
                    this.logger.debug(`Fallback provider ${providerName} failed:`, fallbackError);
                    continue;
                }
            }

            // All fallbacks failed
            routingSession.status = 'failed';
            routingSession.endTime = new Date().toISOString();
            this.updateRoutingStatistics(routingSession, false);

            throw new Error(`All providers failed. Original error: ${originalError.message}`);

        } catch (error) {
            this.logger.error('Fallback routing failed:', error);
            throw error;
        }
    }

    /**
     * Initialize provider metrics
     */
    initializeProviderMetrics() {
        for (const providerName of Object.keys(this.providers)) {
            this.providerMetrics.set(providerName, {
                successRate: 90, // Default 90%
                avgResponseTime: 5000, // 5 seconds default
                uptime: 99, // 99% uptime default
                totalRequests: 0,
                successfulRequests: 0,
                lastUpdated: new Date().toISOString()
            });
        }
    }

    /**
     * Update provider metrics
     */
    updateProviderMetrics(providerName, success, responseTime) {
        const metrics = this.providerMetrics.get(providerName);
        if (!metrics) return;

        metrics.totalRequests++;
        if (success) {
            metrics.successfulRequests++;
        }

        metrics.successRate = (metrics.successfulRequests / metrics.totalRequests) * 100;
        metrics.avgResponseTime = (metrics.avgResponseTime + responseTime) / 2;
        metrics.lastUpdated = new Date().toISOString();

        // Calculate uptime based on recent performance
        if (metrics.totalRequests > 10) {
            metrics.uptime = Math.min(100, metrics.successRate + 5);
        }
    }

    /**
     * Update routing statistics
     */
    updateRoutingStatistics(routingSession, success) {
        this.stats.totalRoutings++;
        
        if (success) {
            this.stats.successfulRoutings++;
        } else {
            this.stats.failedRoutings++;
        }

        if (routingSession.endTime && routingSession.startTime) {
            const routingTime = new Date(routingSession.endTime) - new Date(routingSession.startTime);
            this.stats.avgRoutingTime = (this.stats.avgRoutingTime + routingTime) / this.stats.totalRoutings;
        }

        // Store in history
        this.routingHistory.set(routingSession.id, {
            ...routingSession,
            success
        });

        // Clean old history (keep last 1000)
        if (this.routingHistory.size > 1000) {
            const oldestKey = this.routingHistory.keys().next().value;
            this.routingHistory.delete(oldestKey);
        }
    }

    /**
     * Verify provider availability
     */
    async verifyProviders() {
        const availableProviders = [];
        
        for (const [name, provider] of Object.entries(this.providers)) {
            if (provider) {
                try {
                    const status = provider.getStatus();
                    if (status.isConnected !== false) {
                        availableProviders.push(name);
                    }
                } catch (error) {
                    this.logger.warn(`Provider ${name} verification failed:`, error);
                }
            }
        }

        if (availableProviders.length === 0) {
            throw new Error('No liquidity providers available');
        }

        this.logger.info('Provider verification complete', {
            availableProviders,
            totalProviders: Object.keys(this.providers).length
        });
    }

    /**
     * Start provider monitoring
     */
    startProviderMonitoring() {
        // Monitor provider health every 5 minutes
        setInterval(() => {
            this.monitorProviderHealth();
        }, 5 * 60 * 1000);

        // Clean up old routing sessions every hour
        setInterval(() => {
            this.cleanupOldSessions();
        }, 60 * 60 * 1000);
    }

    /**
     * Monitor provider health
     */
    async monitorProviderHealth() {
        try {
            for (const [name, provider] of Object.entries(this.providers)) {
                if (!provider) continue;

                try {
                    const status = provider.getStatus();
                    const metrics = this.providerMetrics.get(name);
                    
                    if (metrics) {
                        // Update uptime based on current status
                        if (status.isConnected === false) {
                            metrics.uptime = Math.max(0, metrics.uptime - 5);
                        } else {
                            metrics.uptime = Math.min(100, metrics.uptime + 1);
                        }
                    }
                } catch (error) {
                    this.logger.debug(`Health check failed for ${name}:`, error);
                }
            }
        } catch (error) {
            this.logger.error('Provider health monitoring failed:', error);
        }
    }

    /**
     * Clean up old routing sessions
     */
    cleanupOldSessions() {
        const cutoffTime = Date.now() - this.config.performanceWindow;
        
        for (const [sessionId, session] of this.activeRoutings.entries()) {
            const sessionTime = new Date(session.startTime).getTime();
            if (sessionTime < cutoffTime || session.status === 'completed' || session.status === 'failed') {
                this.activeRoutings.delete(sessionId);
            }
        }
    }

    /**
     * Get router statistics
     */
    getStatistics() {
        return {
            ...this.stats,
            activeRoutings: this.activeRoutings.size,
            providerMetrics: Object.fromEntries(this.providerMetrics),
            routingHistory: this.routingHistory.size
        };
    }

    /**
     * Get routing history
     */
    getRoutingHistory(limit = 10) {
        const history = Array.from(this.routingHistory.values())
            .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
            .slice(0, limit);
        
        return history;
    }

    /**
     * Shutdown Liquidity Router
     */
    async shutdown() {
        try {
            this.logger.info('Shutting down Liquidity Router...');

            // Wait for active routings to complete
            const timeout = 30000; // 30 seconds
            const startTime = Date.now();

            while (this.activeRoutings.size > 0 && (Date.now() - startTime) < timeout) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            this.logger.info('Liquidity Router shutdown complete', {
                remainingActiveSessions: this.activeRoutings.size
            });

        } catch (error) {
            this.logger.error('Error during Liquidity Router shutdown:', error);
        }
    }
}

module.exports = LiquidityRouter;