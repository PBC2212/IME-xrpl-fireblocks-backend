const xrplService = require('../services/xrplService');
const fireblocksService = require('../services/fireblocksService');

class AssetController {
    /**
     * Create a new user wallet with XRPL support
     * POST /api/create-wallet
     */
    async createWallet(req, res) {
        try {
            const { userId, walletName } = req.body;
            
            // Validate input
            if (!userId || !walletName) {
                return res.status(400).json({
                    success: false,
                    error: 'MISSING_REQUIRED_FIELDS',
                    message: 'userId and walletName are required',
                    required: ['userId', 'walletName']
                });
            }

            console.log(`🏗️ Creating wallet for user: ${userId}`);

            // Create Fireblocks vault account
            const walletResult = await fireblocksService.createUserWallet(userId, walletName);
            
            if (!walletResult.success) {
                throw new Error('Failed to create Fireblocks wallet');
            }

            // Get XRPL address from the created wallet
            const xrpAddress = walletResult.xrpAddress;
            
            // Check if we need to fund the testnet account
            if (process.env.NODE_ENV === 'development') {
                try {
                    await xrplService.fundTestnetAccount(xrpAddress);
                    console.log(`💰 Testnet account funded: ${xrpAddress}`);
                } catch (fundError) {
                    console.warn(`⚠️ Could not fund testnet account: ${fundError.message}`);
                }
            }

            res.status(201).json({
                success: true,
                message: 'Wallet created successfully',
                data: {
                    wallet: walletResult,
                    xrplInfo: {
                        address: xrpAddress,
                        network: 'testnet',
                        funded: process.env.NODE_ENV === 'development'
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error in createWallet:', error);
            res.status(500).json({
                success: false,
                error: 'WALLET_CREATION_FAILED',
                message: error.message || 'Failed to create wallet',
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Get wallet information and balances
     * GET /api/wallet/:vaultId
     */
    async getWallet(req, res) {
        try {
            const { vaultId } = req.params;
            
            if (!vaultId) {
                return res.status(400).json({
                    success: false,
                    error: 'MISSING_VAULT_ID',
                    message: 'Vault ID is required'
                });
            }

            console.log(`📊 Fetching wallet info for vault: ${vaultId}`);

            // Get Fireblocks wallet info
            const walletInfo = await fireblocksService.getWalletInfo(vaultId);
            
            // Get XRPL account info if XRP address exists
            let xrplInfo = null;
            const xrpAsset = walletInfo.assets.find(asset => asset.type === 'XRP');
            
            if (xrpAsset && xrpAsset.address) {
                try {
                    xrplInfo = await xrplService.getAccountInfo(xrpAsset.address);
                } catch (xrplError) {
                    console.warn(`⚠️ Could not get XRPL info for ${xrpAsset.address}: ${xrplError.message}`);
                    xrplInfo = { error: 'XRPL account not found or not activated' };
                }
            }

            res.json({
                success: true,
                data: {
                    wallet: walletInfo,
                    xrplInfo: xrplInfo,
                    summary: {
                        vaultId: vaultId,
                        totalAssets: walletInfo.assets.length,
                        xrpAddress: xrpAsset?.address || null,
                        isActive: walletInfo.isActive
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`❌ Error in getWallet for vault ${req.params.vaultId}:`, error);
            res.status(500).json({
                success: false,
                error: 'WALLET_FETCH_FAILED',
                message: error.message || 'Failed to fetch wallet information',
                vaultId: req.params.vaultId,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Pledge asset and mint RWA tokens
     * POST /api/pledge
     */
    async pledgeAsset(req, res) {
        try {
            const { vaultId, assetType, assetAmount, assetDescription, tokenSymbol } = req.body;
            
            // Validate input
            if (!vaultId || !assetType || !assetAmount) {
                return res.status(400).json({
                    success: false,
                    error: 'MISSING_REQUIRED_FIELDS',
                    message: 'vaultId, assetType, and assetAmount are required',
                    required: ['vaultId', 'assetType', 'assetAmount']
                });
            }

            console.log(`🏭 Processing pledge for vault ${vaultId}: ${assetAmount} ${assetType}`);

            // Get wallet info to get XRPL address
            const walletInfo = await fireblocksService.getWalletInfo(vaultId);
            const xrpAsset = walletInfo.assets.find(asset => asset.type === 'XRP');
            
            if (!xrpAsset || !xrpAsset.address) {
                throw new Error('XRP address not found for this wallet');
            }

            const xrpAddress = xrpAsset.address;
            const currency = tokenSymbol || process.env.DEFAULT_ASSET_CURRENCY || 'RWA';
            const issuer = process.env.DEFAULT_ASSET_ISSUER;

            // Step 1: Create trust line for the RWA token (if not exists)
            try {
                console.log(`🤝 Creating trust line for ${currency} tokens...`);
                
                // Note: In production, you'd get the wallet secret from Fireblocks
                // For now, we'll create a placeholder trust line
                await xrplService.createTrustLine(
                    xrpAddress,
                    'dummy_secret', // This would come from Fireblocks signing
                    currency,
                    issuer,
                    assetAmount
                );
                
                console.log(`✅ Trust line created for ${currency}`);
            } catch (trustError) {
                console.warn(`⚠️ Trust line may already exist: ${trustError.message}`);
            }

            // Step 2: Mint RWA tokens to user's address
            const mintResult = await xrplService.mintTokens(
                xrpAddress,
                currency,
                assetAmount,
                `Pledged: ${assetDescription || assetType}`
            );

            if (!mintResult.success) {
                throw new Error('Failed to mint RWA tokens');
            }

            // Step 3: Record the pledge in our system
            const pledgeRecord = {
                vaultId: vaultId,
                xrpAddress: xrpAddress,
                assetType: assetType,
                assetAmount: assetAmount,
                assetDescription: assetDescription,
                tokenSymbol: currency,
                tokensIssued: assetAmount,
                txHash: mintResult.txHash,
                status: 'completed',
                pledgedAt: new Date().toISOString()
            };

            console.log(`✅ Pledge completed: ${assetAmount} ${currency} tokens minted`);

            res.status(201).json({
                success: true,
                message: 'Asset pledged and tokens minted successfully',
                data: {
                    pledge: pledgeRecord,
                    mintTransaction: mintResult,
                    summary: {
                        pledgedAsset: `${assetAmount} ${assetType}`,
                        tokensReceived: `${assetAmount} ${currency}`,
                        recipientAddress: xrpAddress,
                        transactionHash: mintResult.txHash
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error in pledgeAsset:', error);
            res.status(500).json({
                success: false,
                error: 'PLEDGE_FAILED',
                message: error.message || 'Failed to process asset pledge',
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Redeem tokens and release pledged assets
     * POST /api/redeem
     */
    async redeemAsset(req, res) {
        try {
            const { vaultId, tokenAmount, tokenSymbol, redemptionAddress } = req.body;
            
            // Validate input
            if (!vaultId || !tokenAmount) {
                return res.status(400).json({
                    success: false,
                    error: 'MISSING_REQUIRED_FIELDS',
                    message: 'vaultId and tokenAmount are required',
                    required: ['vaultId', 'tokenAmount']
                });
            }

            console.log(`🔄 Processing redemption for vault ${vaultId}: ${tokenAmount} tokens`);

            // Get wallet info
            const walletInfo = await fireblocksService.getWalletInfo(vaultId);
            const xrpAsset = walletInfo.assets.find(asset => asset.type === 'XRP');
            
            if (!xrpAsset || !xrpAsset.address) {
                throw new Error('XRP address not found for this wallet');
            }

            const xrpAddress = xrpAsset.address;
            const currency = tokenSymbol || process.env.DEFAULT_ASSET_CURRENCY || 'RWA';

            // Step 1: Burn the RWA tokens (send back to issuer)
            const burnResult = await xrplService.burnTokens(
                xrpAddress,
                'dummy_secret', // This would come from Fireblocks signing
                currency,
                tokenAmount,
                `Redemption: ${tokenAmount} ${currency} tokens`
            );

            if (!burnResult.success) {
                throw new Error('Failed to burn RWA tokens');
            }

            // Step 2: Record the redemption
            const redemptionRecord = {
                vaultId: vaultId,
                xrpAddress: xrpAddress,
                tokenSymbol: currency,
                tokenAmount: tokenAmount,
                burnTxHash: burnResult.txHash,
                redemptionAddress: redemptionAddress || xrpAddress,
                status: 'completed',
                redeemedAt: new Date().toISOString()
            };

            console.log(`✅ Redemption completed: ${tokenAmount} ${currency} tokens burned`);

            res.json({
                success: true,
                message: 'Tokens redeemed successfully',
                data: {
                    redemption: redemptionRecord,
                    burnTransaction: burnResult,
                    summary: {
                        tokensBurned: `${tokenAmount} ${currency}`,
                        fromAddress: xrpAddress,
                        transactionHash: burnResult.txHash,
                        assetsReleased: 'Pending physical asset release'
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error in redeemAsset:', error);
            res.status(500).json({
                success: false,
                error: 'REDEMPTION_FAILED',
                message: error.message || 'Failed to process token redemption',
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Create atomic swap between XRP and RWA tokens
     * POST /api/swap
     */
    async createSwap(req, res) {
        try {
            const { vaultId, fromAsset, toAsset, amount, exchangeRate } = req.body;
            
            // Validate input
            if (!vaultId || !fromAsset || !toAsset || !amount) {
                return res.status(400).json({
                    success: false,
                    error: 'MISSING_REQUIRED_FIELDS',
                    message: 'vaultId, fromAsset, toAsset, and amount are required',
                    required: ['vaultId', 'fromAsset', 'toAsset', 'amount']
                });
            }

            console.log(`💱 Processing swap for vault ${vaultId}: ${amount} ${fromAsset} → ${toAsset}`);

            // Get wallet info
            const walletInfo = await fireblocksService.getWalletInfo(vaultId);
            const xrpAsset = walletInfo.assets.find(asset => asset.type === 'XRP');
            
            if (!xrpAsset || !xrpAsset.address) {
                throw new Error('XRP address not found for this wallet');
            }

            const xrpAddress = xrpAsset.address;
            const rate = exchangeRate || 1.0; // Default 1:1 if no rate provided

            // Prepare swap amounts
            let takerGets, takerPays;
            
            if (fromAsset === 'XRP') {
                // Swapping XRP for RWA tokens
                takerGets = xrpl.xrpToDrops(amount); // XRP in drops
                takerPays = {
                    currency: toAsset,
                    value: (amount * rate).toString(),
                    issuer: process.env.DEFAULT_ASSET_ISSUER
                };
            } else {
                // Swapping RWA tokens for XRP
                takerGets = {
                    currency: fromAsset,
                    value: amount.toString(),
                    issuer: process.env.DEFAULT_ASSET_ISSUER
                };
                takerPays = xrpl.xrpToDrops(amount * rate); // XRP in drops
            }

            // Create swap offer on XRPL
            const swapResult = await xrplService.createSwapOffer(
                xrpAddress,
                'dummy_secret', // This would come from Fireblocks signing
                takerGets,
                takerPays
            );

            if (!swapResult.success) {
                throw new Error('Failed to create swap offer');
            }

            // Record the swap
            const swapRecord = {
                vaultId: vaultId,
                xrpAddress: xrpAddress,
                fromAsset: fromAsset,
                toAsset: toAsset,
                amount: amount,
                exchangeRate: rate,
                offerTxHash: swapResult.txHash,
                status: 'pending',
                createdAt: new Date().toISOString()
            };

            console.log(`✅ Swap offer created: ${amount} ${fromAsset} → ${toAsset}`);

            res.status(201).json({
                success: true,
                message: 'Swap offer created successfully',
                data: {
                    swap: swapRecord,
                    swapTransaction: swapResult,
                    summary: {
                        offering: `${amount} ${fromAsset}`,
                        requesting: `${amount * rate} ${toAsset}`,
                        rate: `1 ${fromAsset} = ${rate} ${toAsset}`,
                        transactionHash: swapResult.txHash
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error in createSwap:', error);
            res.status(500).json({
                success: false,
                error: 'SWAP_FAILED',
                message: error.message || 'Failed to create swap offer',
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Get transaction history for a wallet
     * GET /api/wallet/:vaultId/transactions
     */
    async getTransactionHistory(req, res) {
        try {
            const { vaultId } = req.params;
            const { limit = 20 } = req.query;
            
            if (!vaultId) {
                return res.status(400).json({
                    success: false,
                    error: 'MISSING_VAULT_ID',
                    message: 'Vault ID is required'
                });
            }

            console.log(`📜 Fetching transaction history for vault: ${vaultId}`);

            // Get Fireblocks transactions
            const fireblocksTransactions = await fireblocksService.getWalletTransactions(vaultId, limit);
            
            // Get XRPL transactions if possible
            const walletInfo = await fireblocksService.getWalletInfo(vaultId);
            const xrpAsset = walletInfo.assets.find(asset => asset.type === 'XRP');
            
            let xrplTransactions = [];
            if (xrpAsset && xrpAsset.address) {
                try {
                    xrplTransactions = await xrplService.getTransactionHistory(xrpAsset.address, limit);
                } catch (xrplError) {
                    console.warn(`⚠️ Could not get XRPL transactions: ${xrplError.message}`);
                }
            }

            res.json({
                success: true,
                data: {
                    vaultId: vaultId,
                    fireblocks: fireblocksTransactions,
                    xrpl: xrplTransactions,
                    summary: {
                        fireblocksCount: fireblocksTransactions.transactions?.length || 0,
                        xrplCount: xrplTransactions.length || 0,
                        totalTransactions: (fireblocksTransactions.transactions?.length || 0) + (xrplTransactions.length || 0)
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`❌ Error in getTransactionHistory for vault ${req.params.vaultId}:`, error);
            res.status(500).json({
                success: false,
                error: 'TRANSACTION_HISTORY_FAILED',
                message: error.message || 'Failed to fetch transaction history',
                vaultId: req.params.vaultId,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Get all wallets (for admin/management)
     * GET /api/wallets
     */
    async getAllWallets(req, res) {
        try {
            console.log('📋 Fetching all wallets');
            
            const walletsResult = await fireblocksService.getAllWallets();
            
            res.json({
                success: true,
                data: walletsResult,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error in getAllWallets:', error);
            res.status(500).json({
                success: false,
                error: 'WALLETS_FETCH_FAILED',
                message: error.message || 'Failed to fetch wallets',
                timestamp: new Date().toISOString()
            });
        }
    }
}

module.exports = new AssetController();