// controllers/liquidityController.js
const CircleLiquidityService = require('../services/liquidityService');
const { xrplClient } = require('../config/xrpl');
const { validateRequest, handleError } = require('../middleware/validation');

class LiquidityController {
    constructor() {
        this.liquidityService = new CircleLiquidityService();
        this.legacyLiquidityEngineUrl = process.env.LIQUIDITY_ENGINE_URL;
        this.legacyApiKey = process.env.LIQUIDITY_ENGINE_API_KEY;
    }

    /**
     * Check available liquidity for RWA token
     * GET /api/liquidity/check
     */
    async checkLiquidity(req, res) {
        try {
            const { tokenId, amount, assetType, walletAddress } = req.query;

            if (!tokenId || !amount || !assetType) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required parameters: tokenId, amount, assetType'
                });
            }

            // Get RWA token details from your existing system
            const rwaTokenDetails = await this.getRWATokenDetails(tokenId);
            if (!rwaTokenDetails) {
                return res.status(404).json({
                    success: false,
                    error: 'RWA token not found'
                });
            }

            // Check instant liquidity availability via Circle
            const circleAvailability = await this.liquidityService.checkLiquidityAvailability({
                tokenId,
                amount: parseFloat(amount),
                assetType,
                valuation: rwaTokenDetails.valuation
            });

            // Check fallback liquidity via existing engine
            const fallbackAvailability = await this.checkLegacyLiquidityEngine({
                tokenId,
                amount: parseFloat(amount),
                assetType
            });

            res.json({
                success: true,
                liquidity: {
                    instant: {
                        available: circleAvailability.available,
                        maxAmount: circleAvailability.maxAmount,
                        provider: 'Circle',
                        processingTime: circleAvailability.estimatedProcessingTime,
                        fees: circleAvailability.fees
                    },
                    standard: {
                        available: fallbackAvailability.available,
                        maxAmount: fallbackAvailability.maxAmount,
                        provider: 'Legacy Engine',
                        processingTime: fallbackAvailability.processingTime,
                        fees: fallbackAvailability.fees
                    },
                    recommended: circleAvailability.available ? 'instant' : 'standard'
                }
            });

        } catch (error) {
            console.error('Liquidity check error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to check liquidity availability'
            });
        }
    }

    /**
     * Request instant liquidity against RWA collateral
     * POST /api/liquidity/request
     */
    async requestLiquidity(req, res) {
        try {
            const {
                userWalletAddress,
                rwaTokenId,
                requestedAmount,
                liquidityType = 'instant', // 'instant' or 'standard'
                userKYCStatus = 'pending'
            } = req.body;

            // Validate required fields
            if (!userWalletAddress || !rwaTokenId || !requestedAmount) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields'
                });
            }

            // Get RWA asset details
            const assetDetails = await this.getRWATokenDetails(rwaTokenId);
            if (!assetDetails) {
                return res.status(404).json({
                    success: false,
                    error: 'RWA token not found'
                });
            }

            let liquidityResult;

            if (liquidityType === 'instant' && process.env.CIRCLE_PRIMARY_LIQUIDITY_PROVIDER === 'true') {
                // Try Circle instant liquidity first
                try {
                    liquidityResult = await this.liquidityService.requestInstantLiquidity({
                        userWalletAddress,
                        rwaTokenId,
                        requestedAmount: parseFloat(requestedAmount),
                        assetDetails,
                        userKYCStatus
                    });

                    if (liquidityResult.success) {
                        // Create XRPL transaction for USDC transfer
                        const xrplResult = await this.executeXRPLLiquidityTransfer({
                            userWalletAddress,
                            amount: requestedAmount,
                            liquidityPosition: liquidityResult.liquidityPosition
                        });

                        liquidityResult.xrplTransaction = xrplResult;
                    }
                } catch (circleError) {
                    console.log('Circle liquidity failed, falling back to legacy engine:', circleError.message);
                    liquidityResult = await this.requestLegacyLiquidity({
                        userWalletAddress,
                        rwaTokenId,
                        requestedAmount: parseFloat(requestedAmount),
                        assetDetails
                    });
                }
            } else {
                // Use legacy liquidity engine
                liquidityResult = await this.requestLegacyLiquidity({
                    userWalletAddress,
                    rwaTokenId,
                    requestedAmount: parseFloat(requestedAmount),
                    assetDetails
                });
            }

            // Store liquidity position in database
            if (liquidityResult.success) {
                await this.storeLiquidityPosition(liquidityResult);
            }

            res.json(liquidityResult);

        } catch (error) {
            console.error('Liquidity request error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to process liquidity request'
            });
        }
    }

    /**
     * Process asset swap for immediate liquidity
     * POST /api/liquidity/swap
     */
    async swapAsset(req, res) {
        try {
            const {
                fromAsset,
                toAsset = 'USDC',
                amount,
                userWallet,
                slippageTolerance = 0.02
            } = req.body;

            if (!fromAsset || !amount || !userWallet) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields: fromAsset, amount, userWallet'
                });
            }

            // Execute asset swap via Circle
            const swapResult = await this.liquidityService.processAssetSwap({
                fromAsset,
                toAsset,
                amount: parseFloat(amount),
                userWallet,
                slippageTolerance: parseFloat(slippageTolerance)
            });

            if (swapResult.success) {
                // Execute corresponding XRPL transactions
                const xrplSwapResult = await this.executeXRPLAssetSwap({
                    fromAsset,
                    toAsset,
                    amount: parseFloat(amount),
                    userWallet,
                    swapDetails: swapResult
                });

                swapResult.xrplTransaction = xrplSwapResult;
            }

            res.json(swapResult);

        } catch (error) {
            console.error('Asset swap error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to process asset swap'
            });
        }
    }

    /**
     * Get liquidity position status
     * GET /api/liquidity/position/:positionId
     */
    async getLiquidityPosition(req, res) {
        try {
            const { positionId } = req.params;

            if (!positionId) {
                return res.status(400).json({
                    success: false,
                    error: 'Position ID required'
                });
            }

            // Get position from Circle API
            const positionStatus = await this.liquidityService.monitorLiquidityPosition(positionId);

            // Get local position data from database
            const localPosition = await this.getLocalLiquidityPosition(positionId);

            res.json({
                success: true,
                position: {
                    ...positionStatus,
                    localData: localPosition,
                    lastUpdated: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('Position lookup error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve position status'
            });
        }
    }

    /**
     * List all user liquidity positions
     * GET /api/liquidity/positions/:walletAddress
     */
    async getUserPositions(req, res) {
        try {
            const { walletAddress } = req.params;
            const { status, limit = 50, offset = 0 } = req.query;

            if (!walletAddress) {
                return res.status(400).json({
                    success: false,
                    error: 'Wallet address required'
                });
            }

            const positions = await this.getUserLiquidityPositions({
                walletAddress,
                status,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });

            res.json({
                success: true,
                positions,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    total: positions.length
                }
            });

        } catch (error) {
            console.error('User positions error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve user positions'
            });
        }
    }

    /**
     * Handle Circle webhook notifications
     * POST /api/webhooks/circle
     */
    async handleCircleWebhook(req, res) {
        try {
            const signature = req.headers['x-signature'];
            const webhookSecret = process.env.CIRCLE_WEBHOOK_SECRET;

            // Verify webhook signature
            if (!this.verifyWebhookSignature(req.body, signature, webhookSecret)) {
                return res.status(401).json({ error: 'Invalid signature' });
            }

            const { type, data } = req.body;

            switch (type) {
                case 'transfers':
                    await this.handleTransferWebhook(data);
                    break;
                case 'payments':
                    await this.handlePaymentWebhook(data);
                    break;
                case 'otc.trades':
                    await this.handleTradeWebhook(data);
                    break;
                default:
                    console.log('Unknown webhook type:', type);
            }

            res.json({ success: true });

        } catch (error) {
            console.error('Webhook error:', error);
            res.status(500).json({
                success: false,
                error: 'Webhook processing failed'
            });
        }
    }

    // Helper Methods

    async getRWATokenDetails(tokenId) {
        // Interface with your existing RWA token system
        // This should connect to your existing token management logic
        try {
            // Example implementation - replace with your actual token lookup
            const tokenQuery = `
                SELECT token_id, asset_type, valuation, status, metadata
                FROM rwa_tokens 
                WHERE token_id = $1 AND status = 'active'
            `;
            
            // Assuming you have a database connection available
            // Replace with your actual database query method
            const result = await this.queryDatabase(tokenQuery, [tokenId]);
            
            if (result.length > 0) {
                return {
                    tokenId: result[0].token_id,
                    type: result[0].asset_type,
                    valuation: parseFloat(result[0].valuation),
                    status: result[0].status,
                    metadata: result[0].metadata
                };
            }
            
            return null;
        } catch (error) {
            console.error('Error fetching RWA token details:', error);
            return null;
        }
    }

    async checkLegacyLiquidityEngine(params) {
        try {
            const response = await fetch(`${this.legacyLiquidityEngineUrl}/api/liquidity/check`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.legacyApiKey}`
                },
                body: JSON.stringify(params)
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    available: data.available || false,
                    maxAmount: data.maxAmount || 0,
                    processingTime: data.processingTime || '1-2 hours',
                    fees: data.fees || { rate: 0.03, amount: 0 }
                };
            }

            return { available: false, maxAmount: 0, processingTime: 'N/A', fees: { rate: 0, amount: 0 } };
        } catch (error) {
            console.error('Legacy liquidity check failed:', error);
            return { available: false, maxAmount: 0, processingTime: 'N/A', fees: { rate: 0, amount: 0 } };
        }
    }

    async requestLegacyLiquidity(params) {
        try {
            const response = await fetch(`${this.legacyLiquidityEngineUrl}/api/liquidity/request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.legacyApiKey}`
                },
                body: JSON.stringify(params)
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    provider: 'Legacy Engine',
                    processingTime: '1-2 hours',
                    liquidityPosition: data,
                    instructions: 'Liquidity request submitted to legacy engine'
                };
            }

            throw new Error('Legacy engine request failed');
        } catch (error) {
            console.error('Legacy liquidity request failed:', error);
            return {
                success: false,
                error: 'Legacy liquidity engine unavailable',
                fallbackOptions: []
            };
        }
    }

    async executeXRPLLiquidityTransfer({ userWalletAddress, amount, liquidityPosition }) {
        try {
            // Create USDC trust line if needed
            if (process.env.AUTO_CREATE_TRUSTLINES === 'true') {
                await this.createUSDCTrustLine(userWalletAddress);
            }

            // Send USDC to user wallet
            const payment = {
                TransactionType: 'Payment',
                Account: process.env.XRPL_ISSUER_ADDRESS,
                Destination: userWalletAddress,
                Amount: {
                    currency: process.env.USDC_CURRENCY_CODE || 'USD',
                    value: amount.toString(),
                    issuer: process.env.USDC_ISSUER_ADDRESS || process.env.XRPL_ISSUER_ADDRESS
                },
                DestinationTag: parseInt(process.env.LIQUIDITY_XRPL_DESTINATION_TAG || '12345'),
                Memos: [{
                    Memo: {
                        MemoType: Buffer.from('liquidity-transfer', 'utf8').toString('hex').toUpperCase(),
                        MemoData: Buffer.from(liquidityPosition.positionId, 'utf8').toString('hex').toUpperCase()
                    }
                }]
            };

            const prepared = await xrplClient.autofill(payment);
            const signed = xrplClient.sign(prepared, process.env.XRPL_ISSUER_SECRET);
            const result = await xrplClient.submitAndWait(signed.tx_blob);

            return {
                success: true,
                txHash: result.hash,
                ledgerIndex: result.ledger_index,
                amount: amount,
                currency: 'USDC'
            };

        } catch (error) {
            console.error('XRPL liquidity transfer failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async createUSDCTrustLine(userWalletAddress) {
        // Implementation would depend on your existing trust line creation logic
        // This is a placeholder for the trust line creation process
        console.log(`Creating USDC trust line for ${userWalletAddress}`);
    }

    async executeXRPLAssetSwap(params) {
        // Implementation for XRPL-based asset swapping
        // This would handle the on-chain portion of asset swaps
        console.log('Executing XRPL asset swap:', params);
        return { success: true, txHash: 'placeholder' };
    }

    async storeLiquidityPosition(liquidityResult) {
        // Store position in your existing database
        const query = `
            INSERT INTO liquidity_positions 
            (position_id, user_wallet, rwa_token_id, amount, provider, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        
        const values = [
            liquidityResult.liquidityPosition?.positionId || liquidityResult.id,
            liquidityResult.liquidityPosition?.userWallet,
            liquidityResult.liquidityPosition?.rwaTokenId,
            liquidityResult.liquidityPosition?.liquidityAmount,
            liquidityResult.provider || 'Circle',
            'active',
            new Date().toISOString()
        ];

        await this.queryDatabase(query, values);
    }

    async getLocalLiquidityPosition(positionId) {
        const query = `
            SELECT * FROM liquidity_positions 
            WHERE position_id = $1
        `;
        
        const result = await this.queryDatabase(query, [positionId]);
        return result[0] || null;
    }

    async getUserLiquidityPositions({ walletAddress, status, limit, offset }) {
        let query = `
            SELECT * FROM liquidity_positions 
            WHERE user_wallet = $1
        `;
        const params = [walletAddress];

        if (status) {
            query += ` AND status = $${params.length + 1}`;
            params.push(status);
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        return await this.queryDatabase(query, params);
    }

    verifyWebhookSignature(body, signature, secret) {
        // Implement Circle webhook signature verification
        const crypto = require('crypto');
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(JSON.stringify(body));
        const expectedSignature = hmac.digest('hex');
        
        return crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    }

    async handleTransferWebhook(data) {
        console.log('Processing transfer webhook:', data);
        // Update local position status based on Circle transfer updates
    }

    async handlePaymentWebhook(data) {
        console.log('Processing payment webhook:', data);
        // Handle payment status updates
    }

    async handleTradeWebhook(data) {
        console.log('Processing trade webhook:', data);
        // Handle asset swap completion updates
    }

    async queryDatabase(query, params) {
        // Placeholder for your database query method
        // Replace with your actual database connection/query logic
        console.log('Database query:', query, params);
        return [];
    }
}

module.exports = new LiquidityController();