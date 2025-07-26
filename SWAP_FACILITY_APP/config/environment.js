/**
 * Environment Configuration Validation
 * Validates required environment variables and provides defaults
 */

require('dotenv').config();

/**
 * Validate required environment variables
 */
function validateEnvironment() {
    const errors = [];
    const warnings = [];

    // Required variables
    const required = {
        'JWT_SECRET': process.env.JWT_SECRET,
        'ORACLE_WALLET_SEED': process.env.ORACLE_WALLET_SEED,
        'DB_NAME': process.env.DB_NAME,
        'DB_USER': process.env.DB_USER,
        'DB_PASSWORD': process.env.DB_PASSWORD
    };

    // Check required variables
    for (const [key, value] of Object.entries(required)) {
        if (!value) {
            errors.push(`Missing required environment variable: ${key}`);
        }
    }

    // Optional but recommended variables
    const recommended = {
        'API_BASE_URL': process.env.API_BASE_URL,
        'CORS_ORIGIN': process.env.CORS_ORIGIN,
        'LOG_LEVEL': process.env.LOG_LEVEL
    };

    // Check recommended variables
    for (const [key, value] of Object.entries(recommended)) {
        if (!value) {
            warnings.push(`Missing recommended environment variable: ${key}`);
        }
    }

    // Validate JWT secret strength
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
        warnings.push('JWT_SECRET should be at least 32 characters long');
    }

    // Validate discount rates
    const discountRates = [
        'REAL_ESTATE_DISCOUNT',
        'PRECIOUS_METALS_DISCOUNT',
        'VEHICLES_DISCOUNT',
        'COLLECTIBLES_DISCOUNT',
        'EQUIPMENT_DISCOUNT'
    ];

    discountRates.forEach(rate => {
        const value = parseFloat(process.env[rate]);
        if (value && (value < 0.1 || value > 1.0)) {
            warnings.push(`${rate} should be between 0.1 and 1.0`);
        }
    });

    return { errors, warnings };
}

/**
 * Get validated configuration object
 */
function getConfig() {
    const { errors, warnings } = validateEnvironment();

    // Log warnings
    if (warnings.length > 0) {
        console.warn('⚠️  Environment warnings:');
        warnings.forEach(warning => console.warn(`   - ${warning}`));
    }

    // Throw errors
    if (errors.length > 0) {
        console.error('❌ Environment validation failed:');
        errors.forEach(error => console.error(`   - ${error}`));
        throw new Error('Invalid environment configuration');
    }

    return {
        // Server configuration
        server: {
            port: parseInt(process.env.PORT) || 3000,
            nodeEnv: process.env.NODE_ENV || 'development',
            apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
            corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3001'
        },

        // Security configuration
        security: {
            jwtSecret: process.env.JWT_SECRET,
            jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
            rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
            rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100
        },

        // XRPL configuration
        xrpl: {
            server: process.env.XRPL_SERVER || 'wss://s.altnet.rippletest.net:51233',
            oracleWalletSeed: process.env.ORACLE_WALLET_SEED,
            tradingWalletSeed: process.env.TRADING_WALLET_SEED
        },

        // Database configuration
        database: {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 5432,
            name: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            ssl: process.env.DB_SSL === 'true',
            forcSync: process.env.DB_FORCE_SYNC === 'true',
            alterSync: process.env.DB_ALTER_SYNC === 'true'
        },

        // Redis configuration
        redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT) || 6379,
            password: process.env.REDIS_PASSWORD || null
        },

        // RWA configuration
        rwa: {
            discountRates: {
                realEstate: parseFloat(process.env.REAL_ESTATE_DISCOUNT) || 0.70,
                preciousMetals: parseFloat(process.env.PRECIOUS_METALS_DISCOUNT) || 0.85,
                vehicles: parseFloat(process.env.VEHICLES_DISCOUNT) || 0.60,
                collectibles: parseFloat(process.env.COLLECTIBLES_DISCOUNT) || 0.50,
                equipment: parseFloat(process.env.EQUIPMENT_DISCOUNT) || 0.65
            },
            valueLimits: {
                maxRealEstate: parseFloat(process.env.MAX_REAL_ESTATE_VALUE) || 5000000,
                maxPreciousMetals: parseFloat(process.env.MAX_PRECIOUS_METALS_VALUE) || 1000000,
                maxVehicle: parseFloat(process.env.MAX_VEHICLE_VALUE) || 500000,
                maxCollectible: parseFloat(process.env.MAX_COLLECTIBLE_VALUE) || 100000,
                maxEquipment: parseFloat(process.env.MAX_EQUIPMENT_VALUE) || 1000000
            }
        },

        // Fee configuration
        fees: {
            platformFeePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT) || 2.5,
            minimumFee: parseFloat(process.env.MINIMUM_FEE) || 1,
            maximumFee: parseFloat(process.env.MAXIMUM_FEE) || 1000
        },

        // External services configuration
        services: {
            fireblocks: {
                apiKey: process.env.FIREBLOCKS_API_KEY,
                secretKey: process.env.FIREBLOCKS_SECRET_KEY,
                vaultAccountId: process.env.FIREBLOCKS_VAULT_ACCOUNT_ID || '0'
            },
            gatehub: {
                apiKey: process.env.GATEHUB_API_KEY,
                apiSecret: process.env.GATEHUB_API_SECRET
            },
            sologenic: {
                apiKey: process.env.SOLOGENIC_API_KEY,
                apiSecret: process.env.SOLOGENIC_API_SECRET
            },
            hummingbot: {
                path: process.env.HUMMINGBOT_PATH,
                configPath: process.env.HUMMINGBOT_CONFIG_PATH
            }
        },

        // Logging configuration
        logging: {
            level: process.env.LOG_LEVEL || 'info',
            filePath: process.env.LOG_FILE_PATH || './logs'
        }
    };
}

/**
 * Check if we're in production environment
 */
function isProduction() {
    return process.env.NODE_ENV === 'production';
}

/**
 * Check if we're in development environment
 */
function isDevelopment() {
    return process.env.NODE_ENV === 'development';
}

/**
 * Check if we're in test environment
 */
function isTest() {
    return process.env.NODE_ENV === 'test';
}

/**
 * Get environment-specific database URL
 */
function getDatabaseUrl() {
    const config = getConfig().database;
    return `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.name}`;
}

/**
 * Print configuration summary
 */
function printConfigSummary() {
    const config = getConfig();
    
    console.log('\n📋 Configuration Summary:');
    console.log(`   Environment: ${config.server.nodeEnv}`);
    console.log(`   Port: ${config.server.port}`);
    console.log(`   Database: ${config.database.host}:${config.database.port}/${config.database.name}`);
    console.log(`   XRPL: ${config.xrpl.server}`);
    console.log(`   Log Level: ${config.logging.level}`);
    
    // Services summary
    const enabledServices = [];
    if (config.services.fireblocks.apiKey) enabledServices.push('Fireblocks');
    if (config.services.gatehub.apiKey) enabledServices.push('GateHub');
    if (config.services.sologenic.apiKey) enabledServices.push('Sologenic');
    if (config.services.hummingbot.path) enabledServices.push('Hummingbot');
    
    console.log(`   Services: ${enabledServices.length > 0 ? enabledServices.join(', ') : 'Core only'}`);
    console.log('');
}

module.exports = {
    validateEnvironment,
    getConfig,
    isProduction,
    isDevelopment,
    isTest,
    getDatabaseUrl,
    printConfigSummary
};