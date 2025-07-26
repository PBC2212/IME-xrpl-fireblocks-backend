/**
 * IME Fireblocks Service - Enhanced RWA Token Custody & Liquidity
 * Provides enterprise-grade custody for RWA tokens and liquidity sourcing
 * 
 * Features:
 * - RWA token custody and vault management
 * - Multi-vault architecture for different asset types
 * - Enhanced liquidity provision for RWA swaps
 * - Institutional custody workflows
 * - Cross-exchange settlement with custody verification
 * - Compliance and audit trail for institutional clients
 */

const { FireblocksSDK } = require('fireblocks-sdk');
const crypto = require('crypto');
const moment = require('moment');
const winston = require('winston');

class FireblocksService {
    constructor(config) {
        this.config = {
            apiKey: config.apiKey,
            secretKey: config.secretKey,
            baseUrl: config.baseUrl || 'https://api.fireblocks.io',
            vaultAccountId: config.vaultAccountId || '0',
            enableAutoLiquidity: config.enableAutoLiquidity !== false,
            liquidityThreshold: config.liquidityThreshold || 10000, // $10k minimum
            maxPositionSize: config.maxPositionSize || 1000000, // $1M max position
            settlementTimeoutMs: config.settlementTimeoutMs || 300000, // 5 minutes
            ...config
        };

        // Initialize Fireblocks SDK
        this.fireblocks = null;
        this.isConnected = false;

        // Asset mappings for Fireblocks
        this.assetMappings = {
            'XRP': 'XRP',
            'USDT': 'USDT',
            'USDC': 'USDC',
            'USD': 'USD',
            'BTC': 'BTC',
            'ETH': 'ETH'
        };

        // Vault accounts for different purposes
        this.vaultAccounts = {
            main: this.config.vaultAccountId,
            trading: '1',
            settlement: '2',
            treasury: '3',
            rwa_custody: '4',        // NEW: RWA token custody
            rwa_real_estate: '5',    // NEW: Real estate tokens
            rwa_metals: '6',         // NEW: Precious metals tokens
            rwa_vehicles: '7',       // NEW: Vehicle tokens
            rwa_collectibles: '8',   // NEW: Collectibles tokens
            rwa_equipment: '9'       // NEW: Equipment tokens
        };

        // Active transactions and settlements
        this.activeTransactions = new Map();
        this.pendingSettlements = new Map();
        this.liquidityReserves = new Map();
        
        // NEW: RWA token custody tracking
        this.rwaTokenCustody = new Map();
        this.custodyAgreements = new Map();
        this.assetValuations = new Map();

        // Performance tracking
        this.stats = {
            totalTransactions: 0,
            totalVolume: 0,
            successRate: 0,
            avgSettlementTime: 0,
            liquidityProvided: 0,
            custodyTransactions: 0,
            rwaSwapsExecuted: 0
        };

        // Initialize logger
        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            defaultMeta: { service: 'fireblocks-service' },
            transports: [
                new winston.transports.File({ filename: 'logs/fireblocks-error.log', level: 'error' }),
                new winston.transports.File({ filename: 'logs/fireblocks-combined.log' }),
                new winston.transports.Console({
                    format: winston.format.simple()
                })
            ]
        });
    }

    /**
     * Initialize Fireblocks Service
     */
    async initialize() {
        try {
            this.logger.info('Initializing Fireblocks Service...');

            // Initialize Fireblocks SDK
            this.fireblocks = new FireblocksSDK(
                this.config.secretKey,
                this.config.apiKey,
                this.config.baseUrl
            );

            // Test connection
            await this.testConnection();

            // Load vault information
            await this.loadVaultInformation();

            // Initialize liquidity monitoring
            await this.initializeLiquidityMonitoring();

            // Start settlement monitoring
            this.startSettlementMonitoring();

            this.logger.info('Fireblocks Service initialized successfully', {
                vaultAccountId: this.config.vaultAccountId,
                autoLiquidity: this.config.enableAutoLiquidity
            });

        } catch (error) {
            this.logger.error('Failed to initialize Fireblocks Service:', error);
            throw error;
        }
    }

    /**
     * Test Fireblocks connection
     */
    async testConnection() {
        try {
            const vaultAccounts = await this.fireblocks.getVaultAccounts();
            this.isConnected = true;
            
            this.logger.info('Fireblocks connection successful', {
                vaultAccountsCount: vaultAccounts.length
            });

        } catch (error) {
            this.logger.error('Fireblocks connection test failed:', error);
            throw new Error(`Failed to connect to Fireblocks: ${error.message}`);
        }
    }

    /**
     * Load vault account information
     */
    async loadVaultInformation() {
        try {
            this.vaultInfo = new Map();

            for (const [purpose, vaultId] of Object.entries(this.vaultAccounts)) {
                const vaultAccount = await this.fireblocks.getVaultAccountById(vaultId);
                
                this.vaultInfo.set(purpose, {
                    id: vaultId,
                    name: vaultAccount.name,
                    assets: vaultAccount.assets || [],
                    purpose,
                    lastUpdated: new Date().toISOString()
                });

                this.logger.debug(`Loaded vault info for ${purpose}`, {
                    vaultId,
                    assetCount: vaultAccount.assets?.length || 0
                });
            }

        } catch (error) {
            this.logger.error('Failed to load vault information:', error);
            throw error;
        }
    }

    /**
     * Initialize liquidity monitoring for major assets
     */
    async initializeLiquidityMonitoring() {
        try {
            const monitoredAssets = ['XRP', 'USDT', 'USDC', 'USD'];
            
            for (const asset of monitoredAssets) {
                const balance = await this.getAssetBalance(asset);
                
                this.liquidityReserves.set(asset, {
                    asset,
                    availableBalance: balance,
                    reservedBalance: 0,
                    lastUpdated: new Date().toISOString(),
                    thresholdAlert: balance < this.config.liquidityThreshold
                });
            }

            this.logger.info('Liquidity monitoring initialized', {
                monitoredAssets: monitoredAssets.length,
                totalLiquidity: Array.from(this.liquidityReserves.values())
                    .reduce((sum, reserve) => sum + reserve.availableBalance, 0)
            });

        } catch (error) {
            this.logger.error('Failed to initialize liquidity monitoring:', error);
        }
    }

    /**
     * Check available liquidity for a specific asset
     * @param {string} asset - Asset symbol (XRP, USDT, etc.)
     * @param {number} amount - Required amount
     * @returns {Object} Liquidity availability
     */
    async checkLiquidity(asset, amount) {
        try {
            const fireblocksAsset = this.assetMappings[asset] || asset;
            const balance = await this.getAssetBalance(fireblocksAsset);
            
            // Check reserved amounts
            const reserved = this.getReservedAmount(asset);
            const availableAmount = balance - reserved;

            const liquidityCheck = {
                asset,
                requestedAmount: amount,
                totalBalance: balance,
                reservedAmount: reserved,
                availableAmount,
                available: availableAmount >= amount,
                utilizationRatio: amount / availableAmount,
                estimatedSettlementTime: this.estimateSettlementTime(asset, amount)
            };

            this.logger.debug('Liquidity check completed', liquidityCheck);

            return liquidityCheck;

        } catch (error) {
            this.logger.error('Liquidity check failed:', error);
            return {
                asset,
                available: false,
                availableAmount: 0,
                error: error.message
            };
        }
    }

    /**
     * Custody RWA token in Fireblocks vault
     * @param {Object} custodyRequest - RWA custody request
     * @returns {Object} Custody result
     */
    async custodyRWAToken(custodyRequest) {
        try {
            const { 
                rwaToken, 
                userAddress, 
                custodyAgreement,
                assetValuation,
                swapId 
            } = custodyRequest;

            this.logger.info('Initiating RWA token custody', {
                rwaToken: rwaToken.currency,
                amount: rwaToken.amount,
                userAddress,
                swapId
            });

            // Step 1: Validate custody agreement
            const agreementValidation = await this.validateCustodyAgreement(custodyAgreement);
            if (!agreementValidation.isValid) {
                throw new Error(`Custody agreement invalid: ${agreementValidation.errors.join(', ')}`);
            }

            // Step 2: Determine appropriate vault based on RWA category
            const vaultId = this.determineRWAVault(rwaToken.currency);

            // Step 3: Create custody record
            const custodyId = crypto.randomUUID();
            const custodyRecord = {
                id: custodyId,
                rwaToken,
                userAddress,
                vaultId,
                custodyAgreement,
                assetValuation,
                swapId,
                status: 'custody_pending',
                custodyDate: new Date().toISOString(),
                releaseConditions: {
                    swapCompletion: true,
                    feePayment: true,
                    complianceCheck: true
                }
            };

            // Step 4: Transfer RWA token to custody vault
            const custodyResult = await this.transferToCustody(custodyRecord);

            // Step 5: Store custody record
            this.rwaTokenCustody.set(custodyId, custodyRecord);
            this.custodyAgreements.set(custodyId, custodyAgreement);
            this.assetValuations.set(custodyId, assetValuation);

            custodyRecord.status = 'in_custody';
            custodyRecord.custodyTransactionId = custodyResult.transactionId;

            this.stats.custodyTransactions++;

            this.logger.info('RWA token custody completed', {
                custodyId,
                vaultId,
                transactionId: custodyResult.transactionId
            });

            return {
                success: true,
                custodyId,
                vaultId,
                custodyRecord,
                transactionId: custodyResult.transactionId
            };

        } catch (error) {
            this.logger.error('RWA token custody failed:', error);
            throw error;
        }
    }

    /**
     * Execute RWA token swap with custody verification
     * @param {Object} swapRequest - Enhanced swap request with custody
     * @returns {Object} Swap execution result
     */
    async executeRWASwap(swapRequest) {
        try {
            const {
                custodyId,
                targetCurrency,
                targetAmount,
                liquidityProvider = 'internal',
                maxSlippage = 0.05
            } = swapRequest;

            this.logger.info('Executing RWA swap with custody', {
                custodyId,
                targetCurrency,
                targetAmount,
                liquidityProvider
            });

            // Step 1: Verify custody
            const custodyRecord = this.rwaTokenCustody.get(custodyId);
            if (!custodyRecord || custodyRecord.status !== 'in_custody') {
                throw new Error('RWA token not in custody or invalid custody ID');
            }

            // Step 2: Verify release conditions
            const releaseVerification = await this.verifyReleaseConditions(custodyRecord);
            if (!releaseVerification.canRelease) {
                throw new Error(`Release conditions not met: ${releaseVerification.blockers.join(', ')}`);
            }

            // Step 3: Execute liquidity sourcing
            const liquidityResult = await this.sourceLiquidityForRWA(
                custodyRecord.rwaToken,
                targetCurrency,
                targetAmount,
                liquidityProvider
            );

            // Step 4: Execute atomic swap
            const swapResult = await this.executeAtomicSwapWithCustody(
                custodyRecord,
                liquidityResult,
                maxSlippage
            );

            // Step 5: Release custody and transfer to user
            await this.releaseCustodyAndTransfer(custodyRecord, swapResult);

            // Step 6: Update custody status
            custodyRecord.status = 'released';
            custodyRecord.releaseDate = new Date().toISOString();
            custodyRecord.swapResult = swapResult;

            this.stats.rwaSwapsExecuted++;

            this.logger.info('RWA swap with custody completed', {
                custodyId,
                swapTransactionId: swapResult.transactionId,
                outputAmount: swapResult.outputAmount
            });

            return {
                success: true,
                custodyId,
                swapResult,
                custodyReleased: true
            };

        } catch (error) {
            this.logger.error('RWA swap with custody failed:', error);
            throw error;
        }
    }

    /**
     * Execute liquidity provision for swap
     * @param {Object} liquidityRequest - Liquidity provision request
     * @returns {Object} Liquidity provision result
     */
    async provideLiquidity(liquidityRequest) {
        try {
            const { 
                swapId, 
                asset, 
                amount, 
                destinationAddress, 
                swapParams 
            } = liquidityRequest;

            this.logger.info('Providing liquidity via Fireblocks', {
                swapId,
                asset,
                amount,
                destinationAddress
            });

            // Check liquidity availability
            const liquidityCheck = await this.checkLiquidity(asset, amount);
            if (!liquidityCheck.available) {
                throw new Error('Insufficient liquidity available');
            }

            // Reserve the amount
            this.reserveAmount(asset, amount, swapId);

            // Create Fireblocks transaction
            const transactionResult = await this.createTransaction({
                asset,
                amount,
                destinationAddress,
                note: `Liquidity provision for swap ${swapId}`,
                swapId
            });

            // Track the transaction
            this.activeTransactions.set(transactionResult.id, {
                ...transactionResult,
                type: 'liquidity_provision',
                swapId,
                amount,
                asset,
                status: 'pending',
                createdAt: new Date().toISOString()
            });

            this.logger.info('Liquidity provision initiated', {
                transactionId: transactionResult.id,
                swapId,
                amount,
                asset
            });

            return {
                success: true,
                transactionId: transactionResult.id,
                estimatedSettlementTime: liquidityCheck.estimatedSettlementTime,
                status: 'pending'
            };

        } catch (error) {
            this.logger.error('Liquidity provision failed:', error);
            throw error;
        }
    }

    /**
     * Validate custody agreement for RWA token
     */
    async validateCustodyAgreement(agreement) {
        try {
            const errors = [];

            // Required fields validation
            const requiredFields = ['userSignature', 'assetDescription', 'valuationDate', 'custodyTerms'];
            for (const field of requiredFields) {
                if (!agreement[field]) {
                    errors.push(`Missing required field: ${field}`);
                }
            }

            // Signature validation
            if (agreement.userSignature && !this.verifyDigitalSignature(agreement.userSignature)) {
                errors.push('Invalid user signature');
            }

            // Valuation recency check
            if (agreement.valuationDate) {
                const valuationAge = Date.now() - new Date(agreement.valuationDate).getTime();
                const maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days
                if (valuationAge > maxAge) {
                    errors.push('Asset valuation too old (>90 days)');
                }
            }

            return {
                isValid: errors.length === 0,
                errors,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('Custody agreement validation failed:', error);
            return {
                isValid: false,
                errors: [`Validation error: ${error.message}`],
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Determine appropriate vault for RWA category
     */
    determineRWAVault(rwaTokenCurrency) {
        const categoryMap = {
            'rPROP': 'rwa_real_estate',
            'rMETL': 'rwa_metals',
            'rVEHI': 'rwa_vehicles',
            'rCOLL': 'rwa_collectibles',
            'rEQIP': 'rwa_equipment'
        };

        const prefix = rwaTokenCurrency.substring(0, 5);
        const vaultType = categoryMap[prefix] || 'rwa_custody';
        
        return this.vaultAccounts[vaultType];
    }

    /**
     * Transfer RWA token to custody vault
     */
    async transferToCustody(custodyRecord) {
        try {
            const { rwaToken, vaultId, id: custodyId } = custodyRecord;

            // Create custody transfer transaction
            const transferRequest = {
                assetId: rwaToken.currency,
                source: {
                    type: 'EXTERNAL_WALLET',
                    oneTimeAddress: {
                        address: custodyRecord.userAddress
                    }
                },
                destination: {
                    type: 'VAULT_ACCOUNT',
                    id: vaultId
                },
                amount: rwaToken.amount.toString(),
                note: `RWA custody transfer - ${custodyId}`,
                externalTxId: custodyId
            };

            const result = await this.fireblocks.createTransaction(transferRequest);

            return {
                transactionId: result.id,
                status: result.status,
                custodyVault: vaultId,
                amount: rwaToken.amount
            };

        } catch (error) {
            this.logger.error('Custody transfer failed:', error);
            throw new Error(`Failed to transfer to custody: ${error.message}`);
        }
    }

    /**
     * Verify release conditions for custody
     */
    async verifyReleaseConditions(custodyRecord) {
        try {
            const blockers = [];
            const { releaseConditions, swapId } = custodyRecord;

            // Check swap completion
            if (releaseConditions.swapCompletion && !swapId) {
                blockers.push('Swap not initiated');
            }

            // Check fee payment (simplified check)
            if (releaseConditions.feePayment) {
                // In real implementation, verify fees paid
                // For now, assume fees are handled separately
            }

            // Check compliance
            if (releaseConditions.complianceCheck) {
                const complianceCheck = await this.performComplianceCheck(custodyRecord);
                if (!complianceCheck.passed) {
                    blockers.push(`Compliance check failed: ${complianceCheck.reason}`);
                }
            }

            return {
                canRelease: blockers.length === 0,
                blockers,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('Release condition verification failed:', error);
            return {
                canRelease: false,
                blockers: [`Verification error: ${error.message}`],
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Source liquidity for RWA token swap
     */
    async sourceLiquidityForRWA(rwaToken, targetCurrency, targetAmount, provider) {
        try {
            this.logger.info('Sourcing liquidity for RWA swap', {
                rwaToken: rwaToken.currency,
                targetCurrency,
                targetAmount,
                provider
            });

            // Check internal liquidity first
            const internalLiquidity = await this.checkLiquidity(targetCurrency, targetAmount);
            
            if (internalLiquidity.available && provider === 'internal') {
                return {
                    provider: 'fireblocks_internal',
                    availableAmount: internalLiquidity.availableAmount,
                    rate: this.calculateSwapRate(rwaToken, targetCurrency),
                    source: 'internal_reserves'
                };
            }

            // External liquidity sourcing
            if (provider === 'external' || !internalLiquidity.available) {
                return await this.sourceExternalLiquidity(rwaToken, targetCurrency, targetAmount);
            }

            throw new Error('No liquidity available for RWA swap');

        } catch (error) {
            this.logger.error('Liquidity sourcing failed:', error);
            throw error;
        }
    }

    /**
     * Execute atomic swap with custody verification
     */
    async executeAtomicSwapWithCustody(custodyRecord, liquidityResult, maxSlippage) {
        try {
            const { rwaToken, vaultId } = custodyRecord;
            const { provider, availableAmount, rate } = liquidityResult;

            // Calculate swap parameters
            const outputAmount = rwaToken.amount * rate;
            const slippage = Math.abs(outputAmount - availableAmount) / outputAmount;

            if (slippage > maxSlippage) {
                throw new Error(`Slippage too high: ${slippage.toFixed(4)} > ${maxSlippage}`);
            }

            // Execute the swap transaction
            const swapTransaction = {
                assetId: rwaToken.currency,
                source: {
                    type: 'VAULT_ACCOUNT',
                    id: vaultId
                },
                destination: {
                    type: 'VAULT_ACCOUNT',
                    id: this.vaultAccounts.settlement
                },
                amount: rwaToken.amount.toString(),
                note: `RWA atomic swap - ${custodyRecord.id}`,
                externalTxId: `swap-${custodyRecord.id}`
            };

            const result = await this.fireblocks.createTransaction(swapTransaction);

            return {
                transactionId: result.id,
                outputAmount,
                actualSlippage: slippage,
                swapRate: rate,
                provider,
                executedAt: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('Atomic swap execution failed:', error);
            throw error;
        }
    }

    /**
     * Release custody and transfer to user
     */
    async releaseCustodyAndTransfer(custodyRecord, swapResult) {
        try {
            const { userAddress } = custodyRecord;
            const { outputAmount } = swapResult;

            // Transfer swapped assets to user
            const transferRequest = {
                assetId: 'XRP', // Or target currency
                source: {
                    type: 'VAULT_ACCOUNT',
                    id: this.vaultAccounts.settlement
                },
                destination: {
                    type: 'EXTERNAL_WALLET',
                    oneTimeAddress: {
                        address: userAddress
                    }
                },
                amount: outputAmount.toString(),
                note: `RWA swap completion - ${custodyRecord.id}`,
                externalTxId: `release-${custodyRecord.id}`
            };

            const result = await this.fireblocks.createTransaction(transferRequest);

            this.logger.info('Custody released and assets transferred', {
                custodyId: custodyRecord.id,
                userAddress,
                outputAmount,
                transactionId: result.id
            });

            return result;

        } catch (error) {
            this.logger.error('Custody release failed:', error);
            throw error;
        }
    }

    /**
     * Create Fireblocks transaction
     */
    async createTransaction(transactionParams) {
        try {
            const { asset, amount, destinationAddress, note, swapId } = transactionParams;
            
            const fireblocksAsset = this.assetMappings[asset] || asset;
            
            const transactionRequest = {
                assetId: fireblocksAsset,
                source: {
                    type: 'VAULT_ACCOUNT',
                    id: this.vaultAccounts.trading
                },
                destination: {
                    type: 'EXTERNAL_WALLET',
                    oneTimeAddress: {
                        address: destinationAddress
                    }
                },
                amount: amount.toString(),
                note: note || `RWA Swap ${swapId}`,
                externalTxId: swapId
            };

            const response = await this.fireblocks.createTransaction(transactionRequest);

            return {
                id: response.id,
                status: response.status,
                asset: fireblocksAsset,
                amount: amount,
                txHash: response.txHash,
                destinationAddress,
                createdAt: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('Failed to create Fireblocks transaction:', error);
            throw error;
        }
    }

    /**
     * Get asset balance from Fireblocks vault
     */
    async getAssetBalance(asset) {
        try {
            const fireblocksAsset = this.assetMappings[asset] || asset;
            
            const vaultAccount = await this.fireblocks.getVaultAccountById(
                this.vaultAccounts.trading
            );

            const assetInfo = vaultAccount.assets?.find(a => a.id === fireblocksAsset);
            
            if (!assetInfo) {
                return 0;
            }

            return parseFloat(assetInfo.available) || 0;

        } catch (error) {
            this.logger.error(`Failed to get ${asset} balance:`, error);
            return 0;
        }
    }

    /**
     * Reserve amount for pending transaction
     */
    reserveAmount(asset, amount, swapId) {
        const reserve = this.liquidityReserves.get(asset);
        if (reserve) {
            reserve.reservedBalance += amount;
            reserve.reservations = reserve.reservations || new Map();
            reserve.reservations.set(swapId, {
                amount,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Release reserved amount
     */
    releaseReservedAmount(asset, swapId) {
        const reserve = this.liquidityReserves.get(asset);
        if (reserve && reserve.reservations) {
            const reservation = reserve.reservations.get(swapId);
            if (reservation) {
                reserve.reservedBalance -= reservation.amount;
                reserve.reservations.delete(swapId);
            }
        }
    }

    /**
     * Get total reserved amount for asset
     */
    getReservedAmount(asset) {
        const reserve = this.liquidityReserves.get(asset);
        return reserve ? reserve.reservedBalance : 0;
    }

    /**
     * Estimate settlement time based on asset and network conditions
     */
    estimateSettlementTime(asset, amount) {
        const baseTimes = {
            'XRP': 5, // 5 seconds
            'USDT': 600, // 10 minutes (Ethereum)
            'USDC': 600, // 10 minutes (Ethereum)
            'BTC': 3600, // 1 hour
            'ETH': 300 // 5 minutes
        };

        const baseTime = baseTimes[asset] || 300; // Default 5 minutes
        
        // Adjust for amount size
        const sizeMultiplier = amount > 100000 ? 1.5 : 1.0;
        
        return Math.round(baseTime * sizeMultiplier);
    }

    /**
     * Get transaction status from Fireblocks
     */
    async getTransactionStatus(transactionId) {
        try {
            const transaction = await this.fireblocks.getTransactionById(transactionId);
            
            return {
                id: transactionId,
                status: transaction.status,
                txHash: transaction.txHash,
                networkFee: transaction.networkFee,
                lastUpdated: transaction.lastUpdated,
                subStatus: transaction.subStatus
            };

        } catch (error) {
            this.logger.error('Failed to get transaction status:', error);
            return {
                id: transactionId,
                status: 'UNKNOWN',
                error: error.message
            };
        }
    }

    /**
     * Handle settlement confirmation
     */
    async handleSettlement(transactionId, settlementData) {
        try {
            const transaction = this.activeTransactions.get(transactionId);
            if (!transaction) {
                this.logger.warn('Settlement for unknown transaction', { transactionId });
                return;
            }

            // Release reserved amounts
            this.releaseReservedAmount(transaction.asset, transaction.swapId);

            // Update statistics
            this.updateStatistics(transaction, settlementData);

            // Mark as settled
            transaction.status = 'settled';
            transaction.settledAt = new Date().toISOString();
            transaction.settlementData = settlementData;

            // Move to pending settlements for final processing
            this.pendingSettlements.set(transactionId, transaction);
            this.activeTransactions.delete(transactionId);

            this.logger.info('Settlement processed', {
                transactionId,
                swapId: transaction.swapId,
                asset: transaction.asset,
                amount: transaction.amount
            });

        } catch (error) {
            this.logger.error('Settlement handling failed:', error);
        }
    }

    /**
     * Helper methods
     */
    verifyDigitalSignature(signature) {
        // Simplified signature verification
        // In production, use proper cryptographic verification
        return signature && signature.length > 50;
    }

    async performComplianceCheck(custodyRecord) {
        // Simplified compliance check
        // In production, integrate with KYC/AML providers
        return {
            passed: true,
            reason: 'Compliance check passed',
            timestamp: new Date().toISOString()
        };
    }

    calculateSwapRate(rwaToken, targetCurrency) {
        // Simplified rate calculation
        // In production, use real market rates and Oracle pricing
        const baseRates = {
            'XRP': 0.5,    // $1 RWA = 2 XRP
            'USDT': 0.7,   // $1 RWA = $0.70 USDT (30% discount)
            'USDC': 0.7
        };
        return baseRates[targetCurrency] || 0.7;
    }

    async sourceExternalLiquidity(rwaToken, targetCurrency, targetAmount) {
        // Placeholder for external liquidity sourcing
        // Would integrate with Sologenic, GateHub, etc.
        return {
            provider: 'external_partner',
            availableAmount: targetAmount,
            rate: this.calculateSwapRate(rwaToken, targetCurrency),
            source: 'partner_liquidity'
        };
    }

    /**
     * Update service statistics
     */
    updateStatistics(transaction, settlementData) {
        this.stats.totalTransactions++;
        this.stats.totalVolume += transaction.amount;
        this.stats.liquidityProvided += transaction.amount;

        // Calculate settlement time
        const settlementTime = new Date(settlementData.settledAt) - new Date(transaction.createdAt);
        this.stats.avgSettlementTime = 
            (this.stats.avgSettlementTime + settlementTime) / this.stats.totalTransactions;

        // Update success rate
        const successfulTransactions = this.stats.totalTransactions * (this.stats.successRate / 100) + 1;
        this.stats.successRate = (successfulTransactions / this.stats.totalTransactions) * 100;
    }

    /**
     * Start settlement monitoring
     */
    startSettlementMonitoring() {
        // Check transaction statuses every 30 seconds
        setInterval(async () => {
            await this.monitorActiveTransactions();
        }, 30 * 1000);

        // Update liquidity reserves every 5 minutes
        setInterval(async () => {
            await this.updateLiquidityReserves();
        }, 5 * 60 * 1000);
    }

    /**
     * Monitor active transactions for status updates
     */
    async monitorActiveTransactions() {
        try {
            for (const [transactionId, transaction] of this.activeTransactions.entries()) {
                const status = await this.getTransactionStatus(transactionId);
                
                if (status.status === 'COMPLETED') {
                    await this.handleSettlement(transactionId, {
                        settledAt: new Date().toISOString(),
                        txHash: status.txHash,
                        networkFee: status.networkFee
                    });
                } else if (status.status === 'FAILED' || status.status === 'REJECTED') {
                    this.handleFailedTransaction(transactionId, status);
                }
            }
        } catch (error) {
            this.logger.error('Transaction monitoring error:', error);
        }
    }

    /**
     * Handle failed transaction
     */
    handleFailedTransaction(transactionId, status) {
        const transaction = this.activeTransactions.get(transactionId);
        if (transaction) {
            // Release reserved amounts
            this.releaseReservedAmount(transaction.asset, transaction.swapId);
            
            transaction.status = 'failed';
            transaction.failureReason = status.subStatus || status.status;
            transaction.failedAt = new Date().toISOString();

            this.activeTransactions.delete(transactionId);

            this.logger.error('Transaction failed', {
                transactionId,
                swapId: transaction.swapId,
                reason: transaction.failureReason
            });
        }
    }

    /**
     * Update liquidity reserve information
     */
    async updateLiquidityReserves() {
        try {
            for (const [asset, reserve] of this.liquidityReserves.entries()) {
                const currentBalance = await this.getAssetBalance(asset);
                
                reserve.availableBalance = currentBalance;
                reserve.lastUpdated = new Date().toISOString();
                reserve.thresholdAlert = currentBalance < this.config.liquidityThreshold;

                if (reserve.thresholdAlert) {
                    this.logger.warn('Low liquidity alert', {
                        asset,
                        currentBalance,
                        threshold: this.config.liquidityThreshold
                    });
                }
            }
        } catch (error) {
            this.logger.error('Liquidity reserve update failed:', error);
        }
    }

    /**
     * Get liquidity status for all monitored assets
     */
    getLiquidityStatus() {
        return {
            reserves: Object.fromEntries(this.liquidityReserves),
            activeTransactions: this.activeTransactions.size,
            pendingSettlements: this.pendingSettlements.size,
            custodyRecords: this.rwaTokenCustody.size,
            totalLiquidity: Array.from(this.liquidityReserves.values())
                .reduce((sum, reserve) => sum + reserve.availableBalance, 0),
            alerts: Array.from(this.liquidityReserves.values())
                .filter(reserve => reserve.thresholdAlert)
                .map(reserve => ({
                    asset: reserve.asset,
                    balance: reserve.availableBalance,
                    threshold: this.config.liquidityThreshold
                }))
        };
    }

    /**
     * Get RWA custody status
     */
    getRWACustodyStatus() {
        const custodyRecords = Array.from(this.rwaTokenCustody.values());
        
        return {
            totalCustodyRecords: custodyRecords.length,
            activeCustody: custodyRecords.filter(record => record.status === 'in_custody').length,
            pendingCustody: custodyRecords.filter(record => record.status === 'custody_pending').length,
            releasedCustody: custodyRecords.filter(record => record.status === 'released').length,
            custodyByCategory: this.getCustodyByCategory(custodyRecords),
            totalValueInCustody: custodyRecords
                .filter(record => record.status === 'in_custody')
                .reduce((sum, record) => sum + (record.assetValuation?.currentValue || 0), 0)
        };
    }

    /**
     * Get custody breakdown by RWA category
     */
    getCustodyByCategory(custodyRecords) {
        const categories = {};
        
        custodyRecords.forEach(record => {
            const category = this.getRWACategory(record.rwaToken.currency);
            if (!categories[category]) {
                categories[category] = {
                    count: 0,
                    totalValue: 0,
                    active: 0
                };
            }
            
            categories[category].count++;
            categories[category].totalValue += record.assetValuation?.currentValue || 0;
            if (record.status === 'in_custody') {
                categories[category].active++;
            }
        });
        
        return categories;
    }

    /**
     * Get RWA category from currency code
     */
    getRWACategory(currency) {
        const categoryMap = {
            'rPROP': 'REAL_ESTATE',
            'rMETL': 'PRECIOUS_METALS',
            'rVEHI': 'VEHICLES',
            'rCOLL': 'COLLECTIBLES',
            'rEQIP': 'EQUIPMENT'
        };
        
        const prefix = currency.substring(0, 5);
        return categoryMap[prefix] || 'UNKNOWN';
    }

    /**
     * Get service statistics
     */
    getStatistics() {
        return {
            ...this.stats,
            activeTransactions: this.activeTransactions.size,
            pendingSettlements: this.pendingSettlements.size,
            vaultAccounts: Object.keys(this.vaultAccounts).length,
            monitoredAssets: this.liquidityReserves.size,
            custodyStatus: this.getRWACustodyStatus()
        };
    }

    /**
     * Shutdown Fireblocks Service
     */
    async shutdown() {
        try {
            this.logger.info('Shutting down Fireblocks Service...');

            // Wait for active transactions to complete or timeout
            const timeoutMs = 60000; // 1 minute timeout
            const startTime = Date.now();

            while (this.activeTransactions.size > 0 && (Date.now() - startTime) < timeoutMs) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                await this.monitorActiveTransactions();
            }

            // Release all reserved amounts
            for (const [asset, reserve] of this.liquidityReserves.entries()) {
                reserve.reservedBalance = 0;
                if (reserve.reservations) {
                    reserve.reservations.clear();
                }
            }

            this.logger.info('Fireblocks Service shutdown complete', {
                remainingActiveTransactions: this.activeTransactions.size,
                custodyRecords: this.rwaTokenCustody.size
            });

        } catch (error) {
            this.logger.error('Error during Fireblocks Service shutdown:', error);
        }
    }
}

module.exports = FireblocksService;