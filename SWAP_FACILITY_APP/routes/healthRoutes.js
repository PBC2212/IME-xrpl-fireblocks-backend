/**
 * IME Health Routes - System Health Monitoring and Status Checks
 * Provides comprehensive health monitoring for all swap facility components
 * 
 * Endpoints:
 * - GET /api/health - Basic health check
 * - GET /api/health/detailed - Detailed system status
 * - GET /api/health/services - Individual service health
 * - GET /api/health/dependencies - External dependency status
 * - GET /api/health/metrics - System performance metrics
 * - GET /api/health/alerts - Active system alerts
 */

const express = require('express');
const os = require('os');
const { performance } = require('perf_hooks');

const router = express.Router();

// Cache for health data to avoid excessive checks
const healthCache = {
    lastCheck: null,
    data: null,
    ttl: 30000 // 30 seconds TTL
};

/**
 * GET /api/health
 * Basic health check endpoint
 */
router.get('/', async (req, res) => {
    try {
        const startTime = performance.now();
        
        // Basic checks
        const basicHealth = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'development',
            version: process.env.npm_package_version || '1.0.0'
        };

        // Quick service availability check
        const { swapEngine, oracleService, hummingbotService } = req.services || {};
        
        if (!swapEngine || !oracleService) {
            basicHealth.status = 'degraded';
            basicHealth.issues = ['Core services unavailable'];
        }

        basicHealth.responseTime = Math.round(performance.now() - startTime);

        res.status(basicHealth.status === 'healthy' ? 200 : 503).json({
            success: basicHealth.status === 'healthy',
            health: basicHealth
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            health: {
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error.message
            }
        });
    }
});

/**
 * GET /api/health/detailed
 * Comprehensive system health status
 */
router.get('/detailed', async (req, res) => {
    try {
        const startTime = performance.now();

        // Check cache first
        const now = Date.now();
        if (healthCache.lastCheck && (now - healthCache.lastCheck) < healthCache.ttl) {
            return res.json({
                success: true,
                health: {
                    ...healthCache.data,
                    cached: true,
                    cacheAge: now - healthCache.lastCheck
                }
            });
        }

        const services = req.services || {};
        const detailedHealth = await performDetailedHealthCheck(services);

        // Update cache
        healthCache.lastCheck = now;
        healthCache.data = detailedHealth;

        detailedHealth.responseTime = Math.round(performance.now() - startTime);
        detailedHealth.cached = false;

        const overallStatus = determineOverallStatus(detailedHealth);
        const statusCode = overallStatus === 'healthy' ? 200 : 
                          overallStatus === 'degraded' ? 503 : 500;

        res.status(statusCode).json({
            success: overallStatus !== 'unhealthy',
            health: detailedHealth
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            health: {
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error.message
            }
        });
    }
});

/**
 * GET /api/health/services
 * Individual service health status
 */
router.get('/services', async (req, res) => {
    try {
        const services = req.services || {};
        const serviceHealth = {};

        // Check each service individually
        for (const [serviceName, service] of Object.entries(services)) {
            serviceHealth[serviceName] = await checkServiceHealth(serviceName, service);
        }

        const healthyServices = Object.values(serviceHealth).filter(s => s.status === 'healthy').length;
        const totalServices = Object.keys(serviceHealth).length;
        
        const overallStatus = healthyServices === totalServices ? 'healthy' :
                             healthyServices > totalServices / 2 ? 'degraded' : 'unhealthy';

        res.json({
            success: overallStatus !== 'unhealthy',
            services: serviceHealth,
            summary: {
                total: totalServices,
                healthy: healthyServices,
                degraded: Object.values(serviceHealth).filter(s => s.status === 'degraded').length,
                unhealthy: Object.values(serviceHealth).filter(s => s.status === 'unhealthy').length,
                overallStatus
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to check service health',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/health/dependencies
 * External dependency status (XRPL, Fireblocks, etc.)
 */
router.get('/dependencies', async (req, res) => {
    try {
        const dependencies = await checkExternalDependencies(req.services);

        const healthyDeps = Object.values(dependencies).filter(d => d.status === 'healthy').length;
        const totalDeps = Object.keys(dependencies).length;
        
        const overallStatus = healthyDeps === totalDeps ? 'healthy' :
                             healthyDeps > totalDeps / 2 ? 'degraded' : 'unhealthy';

        res.json({
            success: overallStatus !== 'unhealthy',
            dependencies,
            summary: {
                total: totalDeps,
                healthy: healthyDeps,
                unhealthy: totalDeps - healthyDeps,
                overallStatus
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to check dependencies',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/health/metrics
 * System performance metrics
 */
router.get('/metrics', async (req, res) => {
    try {
        const metrics = await collectSystemMetrics(req.services);

        res.json({
            success: true,
            metrics,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to collect metrics',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/health/alerts
 * Active system alerts and warnings
 */
router.get('/alerts', async (req, res) => {
    try {
        const alerts = await collectSystemAlerts(req.services);

        const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;
        const warningAlerts = alerts.filter(a => a.severity === 'warning').length;

        res.json({
            success: true,
            alerts,
            summary: {
                total: alerts.length,
                critical: criticalAlerts,
                warning: warningAlerts,
                info: alerts.length - criticalAlerts - warningAlerts
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to collect alerts',
            timestamp: new Date().toISOString()
        });
    }
});

// Helper functions

async function performDetailedHealthCheck(services) {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        system: getSystemInfo(),
        services: {},
        dependencies: {},
        metrics: {},
        alerts: []
    };

    // Check all services
    for (const [serviceName, service] of Object.entries(services)) {
        health.services[serviceName] = await checkServiceHealth(serviceName, service);
    }

    // Check external dependencies
    health.dependencies = await checkExternalDependencies(services);

    // Collect basic metrics
    health.metrics = await collectBasicMetrics(services);

    // Collect alerts
    health.alerts = await collectSystemAlerts(services);

    return health;
}

async function checkServiceHealth(serviceName, service) {
    const startTime = performance.now();
    
    try {
        const healthCheck = {
            name: serviceName,
            status: 'unknown',
            responseTime: 0,
            details: {},
            lastCheck: new Date().toISOString()
        };

        // Service-specific health checks
        switch (serviceName) {
            case 'swapEngine':
                healthCheck.details = {
                    activeSwaps: service.activeSwaps?.size || 0,
                    activeQuotes: service.activeQuotes?.size || 0,
                    statistics: service.getStatistics ? service.getStatistics() : null
                };
                healthCheck.status = 'healthy';
                break;

            case 'oracleService':
                healthCheck.details = {
                    isConnected: service.isConnected || false,
                    activeValidations: service.activeValidations?.size || 0,
                    assetCategories: service.getAssetCategories ? 
                        Object.keys(service.getAssetCategories()).length : 0
                };
                healthCheck.status = service.isConnected ? 'healthy' : 'unhealthy';
                break;

            case 'hummingbotService':
                if (service.getStatus) {
                    const status = service.getStatus();
                    healthCheck.details = {
                        isRunning: status.isRunning,
                        activeStrategies: status.activeStrategies,
                        runningStrategies: status.runningStrategies
                    };
                    healthCheck.status = status.isRunning ? 'healthy' : 'degraded';
                } else {
                    healthCheck.status = 'unhealthy';
                    healthCheck.details.error = 'Service methods not available';
                }
                break;

            case 'dexRouter':
                if (service.getStatistics) {
                    const stats = service.getStatistics();
                    healthCheck.details = {
                        isConnected: service.isConnected || false,
                        activeOrders: stats.activeOrders,
                        cachedAMMs: stats.cachedAMMs
                    };
                    healthCheck.status = service.isConnected ? 'healthy' : 'unhealthy';
                } else {
                    healthCheck.status = 'degraded';
                }
                break;

            case 'fireblocksService':
                if (service.getStatistics) {
                    const stats = service.getStatistics();
                    healthCheck.details = {
                        isConnected: service.isConnected || false,
                        activeTransactions: stats.activeTransactions,
                        pendingSettlements: stats.pendingSettlements
                    };
                    healthCheck.status = service.isConnected ? 'healthy' : 'degraded';
                } else {
                    healthCheck.status = 'degraded';
                    healthCheck.details.note = 'Optional service';
                }
                break;

            case 'feeManager':
                if (service.getRevenueAnalytics) {
                    const analytics = service.getRevenueAnalytics();
                    healthCheck.details = {
                        totalFeesCollected: analytics.totalFeesCollected,
                        activeUsers: analytics.activeUsers
                    };
                    healthCheck.status = 'healthy';
                } else {
                    healthCheck.status = 'degraded';
                }
                break;

            default:
                healthCheck.status = 'unknown';
                healthCheck.details.error = 'Unknown service type';
        }

        healthCheck.responseTime = Math.round(performance.now() - startTime);
        return healthCheck;

    } catch (error) {
        return {
            name: serviceName,
            status: 'unhealthy',
            responseTime: Math.round(performance.now() - startTime),
            error: error.message,
            lastCheck: new Date().toISOString()
        };
    }
}

async function checkExternalDependencies(services) {
    const dependencies = {};

    // XRPL Connection
    try {
        if (services.oracleService?.client || services.dexRouter?.client) {
            const client = services.oracleService?.client || services.dexRouter?.client;
            dependencies.xrpl = {
                name: 'XRPL Network',
                status: client.isConnected() ? 'healthy' : 'unhealthy',
                url: client.connection?.getUrl() || 'unknown',
                lastCheck: new Date().toISOString()
            };
        }
    } catch (error) {
        dependencies.xrpl = {
            name: 'XRPL Network',
            status: 'unhealthy',
            error: error.message,
            lastCheck: new Date().toISOString()
        };
    }

    // Fireblocks API
    try {
        if (services.fireblocksService?.fireblocks) {
            // Simple connectivity check
            dependencies.fireblocks = {
                name: 'Fireblocks API',
                status: services.fireblocksService.isConnected ? 'healthy' : 'degraded',
                note: 'Optional enterprise service',
                lastCheck: new Date().toISOString()
            };
        }
    } catch (error) {
        dependencies.fireblocks = {
            name: 'Fireblocks API',
            status: 'degraded',
            error: error.message,
            note: 'Optional service',
            lastCheck: new Date().toISOString()
        };
    }

    // Hummingbot Process
    try {
        if (services.hummingbotService) {
            const status = services.hummingbotService.getStatus();
            dependencies.hummingbot = {
                name: 'Hummingbot Process',
                status: status.isRunning ? 'healthy' : 'degraded',
                configPath: status.configPath,
                lastCheck: new Date().toISOString()
            };
        }
    } catch (error) {
        dependencies.hummingbot = {
            name: 'Hummingbot Process',
            status: 'unhealthy',
            error: error.message,
            lastCheck: new Date().toISOString()
        };
    }

    return dependencies;
}

async function collectBasicMetrics(services) {
    return {
        system: {
            memory: {
                used: process.memoryUsage().heapUsed / 1024 / 1024, // MB
                total: process.memoryUsage().heapTotal / 1024 / 1024, // MB
                free: os.freemem() / 1024 / 1024, // MB
                usage: (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100
            },
            cpu: {
                loadAverage: os.loadavg(),
                usage: process.cpuUsage()
            },
            uptime: {
                process: process.uptime(),
                system: os.uptime()
            }
        },
        platform: {
            swaps: services.swapEngine?.getStatistics ? services.swapEngine.getStatistics() : null,
            fees: services.feeManager?.getRevenueAnalytics ? services.feeManager.getRevenueAnalytics() : null
        }
    };
}

async function collectSystemMetrics(services) {
    const basicMetrics = await collectBasicMetrics(services);
    
    // Add more detailed metrics
    return {
        ...basicMetrics,
        performance: {
            eventLoopDelay: await measureEventLoopDelay(),
            gcStats: process.memoryUsage(),
            activeHandles: process._getActiveHandles().length,
            activeRequests: process._getActiveRequests().length
        },
        connections: {
            xrpl: services.oracleService?.isConnected || services.dexRouter?.isConnected || false,
            fireblocks: services.fireblocksService?.isConnected || false,
            hummingbot: services.hummingbotService?.getStatus()?.isRunning || false
        }
    };
}

async function collectSystemAlerts(services) {
    const alerts = [];

    // Memory usage alerts
    const memUsage = (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100;
    if (memUsage > 90) {
        alerts.push({
            id: 'memory-critical',
            severity: 'critical',
            message: `High memory usage: ${memUsage.toFixed(1)}%`,
            timestamp: new Date().toISOString()
        });
    } else if (memUsage > 75) {
        alerts.push({
            id: 'memory-warning',
            severity: 'warning',
            message: `Elevated memory usage: ${memUsage.toFixed(1)}%`,
            timestamp: new Date().toISOString()
        });
    }

    // Service connectivity alerts
    if (services.oracleService && !services.oracleService.isConnected) {
        alerts.push({
            id: 'oracle-disconnected',
            severity: 'critical',
            message: 'Oracle service not connected to XRPL',
            timestamp: new Date().toISOString()
        });
    }

    // Liquidity alerts
    if (services.fireblocksService?.getLiquidityStatus) {
        const liquidityStatus = services.fireblocksService.getLiquidityStatus();
        if (liquidityStatus.alerts?.length > 0) {
            liquidityStatus.alerts.forEach(alert => {
                alerts.push({
                    id: `liquidity-${alert.asset}`,
                    severity: 'warning',
                    message: `Low ${alert.asset} liquidity: ${alert.balance}`,
                    timestamp: new Date().toISOString()
                });
            });
        }
    }

    return alerts;
}

function getSystemInfo() {
    return {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        memory: {
            rss: process.memoryUsage().rss,
            heapTotal: process.memoryUsage().heapTotal,
            heapUsed: process.memoryUsage().heapUsed,
            external: process.memoryUsage().external
        }
    };
}

function determineOverallStatus(health) {
    const serviceStatuses = Object.values(health.services).map(s => s.status);
    const dependencyStatuses = Object.values(health.dependencies).map(d => d.status);
    
    const allStatuses = [...serviceStatuses, ...dependencyStatuses];
    
    if (allStatuses.includes('unhealthy')) {
        // Critical services down
        const criticalServices = ['swapEngine', 'oracleService'];
        const criticalDown = Object.entries(health.services)
            .filter(([name, service]) => criticalServices.includes(name) && service.status === 'unhealthy')
            .length > 0;
        
        return criticalDown ? 'unhealthy' : 'degraded';
    }
    
    if (allStatuses.includes('degraded')) {
        return 'degraded';
    }
    
    return 'healthy';
}

async function measureEventLoopDelay() {
    return new Promise((resolve) => {
        const start = performance.now();
        setImmediate(() => {
            resolve(performance.now() - start);
        });
    });
}

module.exports = router;