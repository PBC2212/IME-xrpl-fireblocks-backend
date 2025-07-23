const { FireblocksSDK } = require('fireblocks-sdk');

class FireblocksService {
    constructor() {
        this.fireblocks = null;
        this.isInitialized = false;
        this.initialize();
    }

    /**
     * Initialize Fireblocks SDK
     */
    initialize() {
        try {
            this.fireblocks = new FireblocksSDK(
                process.env.FIREBLOCKS_API_SECRET,
                process.env.FIREBLOCKS_API_KEY,
                process.env.FIREBLOCKS_BASE_URL
            );
            this.isInitialized = true;
            console.log("🔥 Fireblocks Service initialized");
        } catch (error) {
            console.error("❌ Failed to initialize Fireblocks:", error.message);
            this.isInitialized = false;
            throw error;
        }
    }

    /**
     * Create a new vault account (wallet) for a user
     */
    async createUserWallet(userId, walletName) {
        try {
            this.ensureInitialized();
            
            console.log(`🏗️ Creating wallet for user ${userId}: ${walletName}`);
            
            // Create vault account
            const vaultAccount = await this.fireblocks.createVaultAccount(
                `${walletName}_${userId}`,
                false // hiddenOnUI
            );

            console.log(`✅ Vault account created: ID ${vaultAccount.id}`);

            // Create XRP asset in the vault
            const xrpAsset = await this.fireblocks.createVaultAsset(
                vaultAccount.id,
                'XRP'
            );

            console.log(`✅ XRP asset created for vault ${vaultAccount.id}`);

            return {
                success: true,
                vaultId: vaultAccount.id,
                walletName: vaultAccount.name,
                xrpAddress: xrpAsset.address,
                assets: [{
                    type: 'XRP',
                    address: xrpAsset.address,
                    balance: '0',
                    available: '0'
                }],
                userId: userId,
                createdAt: new Date().toISOString()
            };

        } catch (error) {
            console.error(`❌ Error creating wallet for user ${userId}:`, error.message);
            throw {
                error: 'WALLET_CREATION_FAILED',
                message: error.message,
                userId: userId
            };
        }
    }

    /**
     * Get vault account information and balances
     */
    async getWalletInfo(vaultId) {
        try {
            this.ensureInitialized();
            
            console.log(`📊 Fetching wallet info for vault: ${vaultId}`);
            
            const vaultAccount = await this.fireblocks.getVaultAccount(vaultId);
            
            if (!vaultAccount) {
                throw new Error(`Vault account ${vaultId} not found`);
            }

            // Get all assets in the vault
            const assets = vaultAccount.assets || [];
            
            // Format assets for frontend consumption
            const formattedAssets = assets.map(asset => ({
                type: asset.id,
                address: asset.address || '',
                balance: asset.balance || '0',
                available: asset.available || '0',
                pending: asset.pending || '0',
                frozen: asset.frozen || '0',
                lockedAmount: asset.lockedAmount || '0'
            }));

            return {
                success: true,
                vaultId: vaultAccount.id,
                walletName: vaultAccount.name,
                assets: formattedAssets,
                isActive: vaultAccount.isActive !== false,
                lastUpdated: new Date().toISOString()
            };

        } catch (error) {
            console.error(`❌ Error fetching wallet info for vault ${vaultId}:`, error.message);
            throw {
                error: 'WALLET_FETCH_FAILED',
                message: error.message,
                vaultId: vaultId
            };
        }
    }

    /**
     * Get all vault accounts (wallets) for management
     */
    async getAllWallets() {
        try {
            this.ensureInitialized();
            
            console.log("📋 Fetching all vault accounts");
            
            const vaultAccounts = await this.fireblocks.getVaultAccounts();
            
            return {
                success: true,
                wallets: vaultAccounts.map(vault => ({
                    vaultId: vault.id,
                    walletName: vault.name,
                    isActive: vault.isActive !== false,
                    assetsCount: vault.assets ? vault.assets.length : 0
                })),
                totalCount: vaultAccounts.length
            };

        } catch (error) {
            console.error("❌ Error fetching all wallets:", error.message);
            throw {
                error: 'WALLETS_FETCH_FAILED',
                message: error.message
            };
        }
    }

    /**
     * Create a transaction (for XRPL operations)
     */
    async createTransaction(vaultId, assetId, operation, destination, amount, memo = null) {
        try {
            this.ensureInitialized();
            
            console.log(`💸 Creating transaction for vault ${vaultId}: ${operation}`);
            
            const transactionRequest = {
                assetId: assetId,
                source: {
                    type: 'VAULT_ACCOUNT',
                    id: vaultId
                },
                destination: {
                    type: 'EXTERNAL_WALLET',
                    oneTimeAddress: {
                        address: destination
                    }
                },
                amount: amount.toString(),
                note: memo || `${operation} transaction`
            };

            // Add operation-specific memo
            if (memo) {
                transactionRequest.extraParameters = {
                    memo: memo
                };
            }

            const transactionResponse = await this.fireblocks.createTransaction(transactionRequest);
            
            console.log(`✅ Transaction created: ${transactionResponse.id}`);
            
            return {
                success: true,
                transactionId: transactionResponse.id,
                status: transactionResponse.status,
                operation: operation,
                vaultId: vaultId,
                destination: destination,
                amount: amount,
                assetId: assetId,
                createdAt: new Date().toISOString()
            };

        } catch (error) {
            console.error(`❌ Error creating transaction for vault ${vaultId}:`, error.message);
            throw {
                error: 'TRANSACTION_CREATION_FAILED',
                message: error.message,
                vaultId: vaultId,
                operation: operation
            };
        }
    }

    /**
     * Get transaction status and details
     */
    async getTransactionStatus(transactionId) {
        try {
            this.ensureInitialized();
            
            const transaction = await this.fireblocks.getTransactionById(transactionId);
            
            return {
                success: true,
                transactionId: transaction.id,
                status: transaction.status,
                subStatus: transaction.subStatus,
                txHash: transaction.txHash,
                sourceAddress: transaction.sourceAddress,
                destAddress: transaction.destAddress,
                amount: transaction.amount,
                assetId: transaction.assetId,
                fee: transaction.fee,
                createdAt: transaction.createdAt,
                lastUpdated: transaction.lastUpdated
            };

        } catch (error) {
            console.error(`❌ Error getting transaction status ${transactionId}:`, error.message);
            throw {
                error: 'TRANSACTION_STATUS_FAILED',
                message: error.message,
                transactionId: transactionId
            };
        }
    }

    /**
     * Get transaction history for a vault
     */
    async getWalletTransactions(vaultId, limit = 20) {
        try {
            this.ensureInitialized();
            
            console.log(`📜 Fetching transaction history for vault: ${vaultId}`);
            
            const transactions = await this.fireblocks.getTransactions({
                sourceType: 'VAULT_ACCOUNT',
                sourceId: vaultId,
                limit: limit
            });

            return {
                success: true,
                vaultId: vaultId,
                transactions: transactions.map(tx => ({
                    id: tx.id,
                    status: tx.status,
                    txHash: tx.txHash,
                    operation: tx.operation,
                    amount: tx.amount,
                    assetId: tx.assetId,
                    sourceAddress: tx.sourceAddress,
                    destAddress: tx.destAddress,
                    createdAt: tx.createdAt,
                    lastUpdated: tx.lastUpdated
                })),
                totalCount: transactions.length
            };

        } catch (error) {
            console.error(`❌ Error fetching transactions for vault ${vaultId}:`, error.message);
            throw {
                error: 'TRANSACTIONS_FETCH_FAILED',
                message: error.message,
                vaultId: vaultId
            };
        }
    }

    /**
     * Create internal transfer between vaults
     */
    async createInternalTransfer(fromVaultId, toVaultId, assetId, amount, note = null) {
        try {
            this.ensureInitialized();
            
            console.log(`🔄 Creating internal transfer: ${fromVaultId} → ${toVaultId}`);
            
            const transferRequest = {
                assetId: assetId,
                source: {
                    type: 'VAULT_ACCOUNT',
                    id: fromVaultId
                },
                destination: {
                    type: 'VAULT_ACCOUNT',
                    id: toVaultId
                },
                amount: amount.toString(),
                note: note || 'Internal transfer'
            };

            const transferResponse = await this.fireblocks.createTransaction(transferRequest);
            
            console.log(`✅ Internal transfer created: ${transferResponse.id}`);
            
            return {
                success: true,
                transactionId: transferResponse.id,
                status: transferResponse.status,
                fromVaultId: fromVaultId,
                toVaultId: toVaultId,
                amount: amount,
                assetId: assetId,
                createdAt: new Date().toISOString()
            };

        } catch (error) {
            console.error(`❌ Error creating internal transfer:`, error.message);
            throw {
                error: 'INTERNAL_TRANSFER_FAILED',
                message: error.message,
                fromVaultId: fromVaultId,
                toVaultId: toVaultId
            };
        }
    }

    /**
     * Generate deposit address for a vault asset
     */
    async generateDepositAddress(vaultId, assetId) {
        try {
            this.ensureInitialized();
            
            const depositAddress = await this.fireblocks.generateNewAddress(vaultId, assetId);
            
            return {
                success: true,
                vaultId: vaultId,
                assetId: assetId,
                address: depositAddress.address,
                tag: depositAddress.tag,
                createdAt: new Date().toISOString()
            };

        } catch (error) {
            console.error(`❌ Error generating deposit address for vault ${vaultId}:`, error.message);
            throw {
                error: 'DEPOSIT_ADDRESS_FAILED',
                message: error.message,
                vaultId: vaultId,
                assetId: assetId
            };
        }
    }

    /**
     * Get supported assets
     */
    async getSupportedAssets() {
        try {
            this.ensureInitialized();
            
            const assets = await this.fireblocks.getSupportedAssets();
            
            return {
                success: true,
                assets: assets.filter(asset => 
                    // Filter for relevant assets for RWA platform
                    ['XRP', 'BTC', 'ETH', 'USDC', 'USDT'].includes(asset.id)
                ).map(asset => ({
                    id: asset.id,
                    name: asset.name,
                    symbol: asset.symbol,
                    decimals: asset.decimals,
                    isActive: asset.isActive
                }))
            };

        } catch (error) {
            console.error("❌ Error fetching supported assets:", error.message);
            throw {
                error: 'ASSETS_FETCH_FAILED',
                message: error.message
            };
        }
    }

    /**
     * Validate if Fireblocks service is properly initialized
     */
    ensureInitialized() {
        if (!this.isInitialized || !this.fireblocks) {
            throw new Error('Fireblocks service not initialized');
        }
    }

    /**
     * Health check for Fireblocks service
     */
    async healthCheck() {
        try {
            this.ensureInitialized();
            
            // Test connection by getting vault accounts
            const vaultAccounts = await this.fireblocks.getVaultAccounts();
            
            return {
                success: true,
                status: 'healthy',
                vaultCount: vaultAccounts.length,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error("❌ Fireblocks health check failed:", error.message);
            return {
                success: false,
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = new FireblocksService();