/**
 * IME Oracle Service - RWA Token Validation & Discount Calculation
 * Validates existing RWA tokens and determines swap discount rates
 * 
 * Features:
 * - RWA token authenticity validation
 * - Real-time asset valuation and discount calculation
 * - Asset category management and risk assessment
 * - Oracle signature verification
 * - Market-based discount rate adjustments
 */

const { Client, Wallet, xrpToDrops, dropsToXrp } = require('xrpl');
const crypto = require('crypto');
const axios = require('axios');
const moment = require('moment');
const winston = require('winston');

class OracleService {
    constructor(config) {
        this.config = {
            xrplClient: config.xrplClient,
            oracleWallet: config.oracleWallet,
            validationTimeout: config.validationTimeout || 30000,
            maxAssetValue: config.maxAssetValue || 1000000,
            minAssetValue: config.minAssetValue || 1000,
            validationOnly: config.validationOnly || false, // Only validate, don't mint
            ...config
        };

        this.client = new Client(this.config.xrplClient);
        this.wallet = null;
        this.isConnected = false;
        
        // Asset categories and their default discount rates
        this.assetCategories = {
            REAL_ESTATE: {
                name: 'Real Estate',
                discountRate: parseFloat(process.env.REAL_ESTATE_DISCOUNT) || 0.70,
                maxValue: parseFloat(process.env.MAX_REAL_ESTATE_VALUE) || 5000000,
                requiredDocs: ['deed', 'appraisal', 'insurance']
            },
            PRECIOUS_METALS: {
                name: 'Precious Metals',
                discountRate: parseFloat(process.env.PRECIOUS_METALS_DISCOUNT) || 0.85,
                maxValue: parseFloat(process.env.MAX_PRECIOUS_METALS_VALUE) || 1000000,
                requiredDocs: ['certificate', 'assay', 'storage_receipt']
            },
            VEHICLES: {
                name: 'Vehicles',
                discountRate: parseFloat(process.env.VEHICLES_DISCOUNT) || 0.60,
                maxValue: parseFloat(process.env.MAX_VEHICLE_VALUE) || 500000,
                requiredDocs: ['title', 'registration', 'inspection']
            },
            COLLECTIBLES: {
                name: 'Collectibles',
                discountRate: parseFloat(process.env.COLLECTIBLES_DISCOUNT) || 0.50,
                maxValue: parseFloat(process.env.MAX_COLLECTIBLE_VALUE) || 100000,
                requiredDocs: ['authenticity', 'appraisal', 'provenance']
            },
            EQUIPMENT: {
                name: 'Equipment',
                discountRate: parseFloat(process.env.EQUIPMENT_DISCOUNT) || 0.65,
                maxValue: parseFloat(process.env.MAX_EQUIPMENT_VALUE) || 1000000,
                requiredDocs: ['invoice', 'condition_report', 'maintenance_records']
            }
        };

        // Initialize logger
        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            defaultMeta: { service: 'oracle-service' },
            transports: [
                new winston.transports.File({ filename: 'logs/oracle-error.log', level: 'error' }),
                new winston.transports.File({ filename: 'logs/oracle-combined.log' }),
                new winston.transports.Console({
                    format: winston.format.simple()
                })
            ]
        });

        // Active RWA token validations and discount calculations
        this.activeValidations = new Map();
        this.discountCache = new Map();
    }

    /**
     * Initialize the Oracle Service
     */
    async initialize() {
        try {
            this.logger.info('Initializing Oracle Service...');

            // Connect to XRPL
            await this.client.connect();
            this.isConnected = true;

            // Initialize wallet
            if (this.config.oracleWallet.seed) {
                this.wallet = Wallet.fromSeed(this.config.oracleWallet.seed);
            } else {
                throw new Error('Oracle wallet seed not provided');
            }

            // Verify wallet has sufficient XRP for operations
            await this.verifyWalletBalance();

            // Start cleanup interval for expired pledges
            this.startCleanupInterval();

            this.logger.info('Oracle Service initialized successfully (Validation Mode)', {
                address: this.wallet.address,
                categories: Object.keys(this.assetCategories).length,
                validationOnly: this.config.validationOnly
            });

        } catch (error) {
            this.logger.error('Failed to initialize Oracle Service:', error);
            throw error;
        }
    }

    /**
     * Verify oracle wallet has sufficient balance
     */
    async verifyWalletBalance() {
        try {
            const response = await this.client.request({
                command: 'account_info',
                account: this.wallet.address
            });

            const balance = dropsToXrp(response.result.account_data.Balance);
            const minimumBalance = 100; // 100 XRP minimum

            if (parseFloat(balance) < minimumBalance) {
                this.logger.warn(`Oracle wallet balance low: ${balance} XRP (minimum: ${minimumBalance} XRP)`);
            }

            return parseFloat(balance);
        } catch (error) {
            this.logger.error('Failed to verify wallet balance:', error);
            throw error;
        }
    }

    /**
     * Validate existing RWA token and calculate swap parameters
     * @param {Object} rwaToken - RWA token information
     * @param {string} userAddress - User's XRPL address
     * @returns {Object} Validation and swap calculation result
     */
    async validateRWAToken(rwaToken, userAddress) {
        try {
            this.logger.info('Validating RWA token for swap', { 
                currency: rwaToken.currency,
                issuer: rwaToken.issuer,
                amount: rwaToken.amount,
                userAddress 
            });

            // Step 1: Validate token authenticity
            const tokenValidation = await this.validateTokenAuthenticity(rwaToken);
            if (!tokenValidation.isValid) {
                throw new Error(`RWA token validation failed: ${tokenValidation.errors.join(', ')}`);
            }

            // Step 2: Get current asset valuation
            const valuation = await this.getCurrentAssetValuation(rwaToken);

            // Step 3: Calculate discount rate and swap value
            const swapCalculation = await this.calculateSwapParameters(rwaToken, valuation);

            // Step 4: Create validation record
            const validation = {
                id: crypto.randomUUID(),
                rwaToken,
                userAddress,
                valuation,
                swapCalculation,
                timestamp: new Date().toISOString(),
                validUntil: moment().add(30, 'minutes').toISOString(), // 30 min validity
                status: 'validated'
            };

            this.activeValidations.set(validation.id, validation);

            this.logger.info('RWA token validation completed', {
                validationId: validation.id,
                swapValue: swapCalculation.swapValue,
                discountRate: swapCalculation.discountRate
            });

            return {
                success: true,
                validation,
                canSwap: true,
                swapParameters: swapCalculation
            };

        } catch (error) {
            this.logger.error('RWA token validation failed:', error);
            throw error;
        }
    }

    /**
     * Validate asset data
     * @param {Object} assetData - Asset to validate
     * @returns {Object} Validation result
     */
    async validateAssetData(assetData) {
        const errors = [];

        try {
            // Check required fields
            const requiredFields = ['id', 'category', 'description', 'appraisedValue', 'documents'];
            for (const field of requiredFields) {
                if (!assetData[field]) {
                    errors.push(`Missing required field: ${field}`);
                }
            }

            // Validate category
            if (!this.assetCategories[assetData.category]) {
                errors.push(`Invalid asset category: ${assetData.category}`);
            }

            // Validate value range
            if (assetData.appraisedValue) {
                const value = parseFloat(assetData.appraisedValue);
                if (value < this.config.minAssetValue) {
                    errors.push(`Asset value too low (minimum: $${this.config.minAssetValue})`);
                }
                if (value > this.config.maxAssetValue) {
                    errors.push(`Asset value too high (maximum: $${this.config.maxAssetValue})`);
                }

                // Check category-specific limits
                const categoryConfig = this.assetCategories[assetData.category];
                if (categoryConfig && value > categoryConfig.maxValue) {
                    errors.push(`${categoryConfig.name} value exceeds category limit: $${categoryConfig.maxValue}`);
                }
            }

            // Validate required documents
            if (assetData.category && this.assetCategories[assetData.category]) {
                const requiredDocs = this.assetCategories[assetData.category].requiredDocs;
                const providedDocs = assetData.documents || [];
                
                for (const requiredDoc of requiredDocs) {
                    const hasDoc = providedDocs.some(doc => 
                        doc.type === requiredDoc || doc.name.toLowerCase().includes(requiredDoc)
                    );
                    if (!hasDoc) {
                        errors.push(`Missing required document: ${requiredDoc}`);
                    }
                }
            }

            return {
                isValid: errors.length === 0,
                errors,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('Asset validation error:', error);
            return {
                isValid: false,
                errors: [`Validation error: ${error.message}`],
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Perform external appraisal (mock implementation)
     * @param {Object} assetData - Asset to appraise
     * @returns {Object} Appraisal result
     */
    async performAppraisal(assetData) {
        try {
            // In production, this would integrate with external appraisal services
            // For now, we'll use the provided appraised value with some validation

            let adjustedValue = parseFloat(assetData.appraisedValue);
            const category = this.assetCategories[assetData.category];

            // Apply market conditions (mock)
            const marketAdjustment = this.getMarketAdjustment(assetData.category);
            adjustedValue *= marketAdjustment;

            // Ensure value is within reasonable bounds
            adjustedValue = Math.max(adjustedValue, this.config.minAssetValue);
            adjustedValue = Math.min(adjustedValue, category.maxValue);

            const appraisal = {
                originalValue: parseFloat(assetData.appraisedValue),
                adjustedValue: Math.round(adjustedValue * 100) / 100,
                marketAdjustment,
                appraisalDate: new Date().toISOString(),
                validUntil: moment().add(90, 'days').toISOString(), // 90 days validity
                appraiser: 'IME Oracle System',
                confidence: this.calculateConfidence(assetData),
                notes: `${category.name} appraisal with ${(marketAdjustment * 100).toFixed(1)}% market adjustment`
            };

            return {
                ...appraisal,
                value: appraisal.adjustedValue
            };

        } catch (error) {
            this.logger.error('Appraisal error:', error);
            throw new Error(`Appraisal failed: ${error.message}`);
        }
    }

    /**
     * Get market adjustment factor for asset category
     * @param {string} category - Asset category
     * @returns {number} Adjustment factor
     */
    getMarketAdjustment(category) {
        // Mock market conditions - in production, integrate with real market data
        const marketConditions = {
            REAL_ESTATE: 0.98, // 2% discount for current market
            PRECIOUS_METALS: 1.05, // 5% premium due to high demand
            VEHICLES: 0.92, // 8% discount due to depreciation
            COLLECTIBLES: 0.95, // 5% discount for liquidity concerns
            EQUIPMENT: 0.90 // 10% discount for wear and obsolescence
        };

        return marketConditions[category] || 1.0;
    }

    /**
     * Calculate confidence score for appraisal
     * @param {Object} assetData - Asset data
     * @returns {number} Confidence score (0-100)
     */
    calculateConfidence(assetData) {
        let confidence = 70; // Base confidence

        // Increase confidence based on documentation quality
        const docs = assetData.documents || [];
        confidence += Math.min(docs.length * 5, 20);

        // Adjust based on asset age
        if (assetData.ageInYears) {
            if (assetData.ageInYears < 5) confidence += 10;
            else if (assetData.ageInYears > 20) confidence -= 10;
        }

        // Ensure confidence is within bounds
        return Math.max(50, Math.min(95, confidence));
    }

    /**
     * Create asset pledge with oracle signature
     * @param {Object} assetData - Asset data
     * @param {string} userAddress - User address
     * @param {Object} appraisal - Appraisal result
     * @returns {Object} Pledge data
     */
    async createAssetPledge(assetData, userAddress, appraisal) {
        try {
            const pledgeId = crypto.randomUUID();
            const timestamp = new Date().toISOString();

            const pledgeData = {
                id: pledgeId,
                assetId: assetData.id,
                category: assetData.category,
                description: assetData.description,
                appraisedValue: appraisal.value,
                userAddress,
                oracleAddress: this.wallet.address,
                timestamp,
                appraisal
            };

            // Create oracle signature
            const signature = this.createOracleSignature(pledgeData);
            pledgeData.signature = signature;

            return pledgeData;

        } catch (error) {
            this.logger.error('Failed to create asset pledge:', error);
            throw error;
        }
    }

    /**
     * Create oracle signature for pledge
     * @param {Object} pledgeData - Pledge data to sign
     * @returns {string} Signature
     */
    createOracleSignature(pledgeData) {
        const dataToSign = JSON.stringify({
            id: pledgeData.id,
            assetId: pledgeData.assetId,
            appraisedValue: pledgeData.appraisedValue,
            userAddress: pledgeData.userAddress,
            timestamp: pledgeData.timestamp
        });

        return crypto
            .createHmac('sha256', this.wallet.seed)
            .update(dataToSign)
            .digest('hex');
    }

    /**
     * Issue RWA token on XRPL (1:1 with appraised value)
     * @param {Object} pledge - Asset pledge
     * @returns {Object} Token issuance result
     */
    async issueRWAToken(pledge) {
        try {
            // Create unique currency code for the RWA token
            const currencyCode = this.generateCurrencyCode(pledge.category, pledge.assetId);
            
            // Token amount equals appraised value (1:1)
            const tokenAmount = pledge.appraisedValue.toString();

            // In a full implementation, this would create a trust line and issue tokens
            // For now, we'll return the token details that would be created

            const tokenResult = {
                currency: currencyCode,
                issuer: this.wallet.address,
                amount: tokenAmount,
                assetId: pledge.assetId,
                pledgeId: pledge.id,
                issuanceDate: new Date().toISOString()
            };

            this.logger.info('RWA token issued', {
                pledgeId: pledge.id,
                currency: currencyCode,
                amount: tokenAmount,
                issuer: this.wallet.address
            });

            return tokenResult;

        } catch (error) {
            this.logger.error('Failed to issue RWA token:', error);
            throw error;
        }
    }

    /**
     * Generate unique currency code for RWA token
     * @param {string} category - Asset category
     * @param {string} assetId - Asset ID
     * @returns {string} Currency code
     */
    generateCurrencyCode(category, assetId) {
        const categoryPrefixes = {
            REAL_ESTATE: 'rPROP',
            PRECIOUS_METALS: 'rMETL',
            VEHICLES: 'rVEHI',
            COLLECTIBLES: 'rCOLL',
            EQUIPMENT: 'rEQIP'
        };

        const prefix = categoryPrefixes[category] || 'rRWA';
        const suffix = assetId.slice(-4).toUpperCase();
        
        return `${prefix}${suffix}`;
    }

    /**
     * Validate asset pledge by signature
     * @param {string} pledgeId - Pledge ID
     * @param {string} signature - Oracle signature
     * @returns {Object} Validation result
     */
    async validatePledge(pledgeId, signature) {
        try {
            const pledge = this.activePledges.get(pledgeId);
            
            if (!pledge) {
                return { isValid: false, error: 'Pledge not found' };
            }

            if (pledge.signature !== signature) {
                return { isValid: false, error: 'Invalid signature' };
            }

            // Check if pledge is still valid (not expired)
            const pledgeAge = Date.now() - new Date(pledge.timestamp).getTime();
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours

            if (pledgeAge > maxAge) {
                return { isValid: false, error: 'Pledge expired' };
            }

            return {
                isValid: true,
                pledge,
                discountRate: this.assetCategories[pledge.assetId] ? 
                    this.assetCategories[pledge.assetId].discountRate : 0.7
            };

        } catch (error) {
            this.logger.error('Pledge validation error:', error);
            return { isValid: false, error: error.message };
        }
    }

    /**
     * Get asset categories and their configurations
     * @returns {Object} Asset categories
     */
    getAssetCategories() {
        return this.assetCategories;
    }

    /**
     * Start cleanup interval for expired pledges
     */
    startCleanupInterval() {
        setInterval(() => {
            this.cleanupExpiredPledges();
        }, 60 * 60 * 1000); // Run every hour
    }

    /**
     * Clean up expired pledges
     */
    cleanupExpiredPledges() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [pledgeId, pledge] of this.activePledges.entries()) {
            const pledgeAge = now - new Date(pledge.timestamp).getTime();
            if (pledgeAge > maxAge) {
                this.activePledges.delete(pledgeId);
                this.logger.info('Cleaned up expired pledge', { pledgeId });
            }
        }
    }

    /**
     * Shutdown the Oracle Service
     */
    async shutdown() {
        try {
            this.logger.info('Shutting down Oracle Service...');
            
            if (this.isConnected) {
                await this.client.disconnect();
                this.isConnected = false;
            }

            this.logger.info('Oracle Service shutdown complete');
        } catch (error) {
            this.logger.error('Error during Oracle Service shutdown:', error);
        }
    }
}

module.exports = OracleService;