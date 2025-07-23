const xrpl = require('xrpl');

class XRPLService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.issuerWallet = null;
        
        // Initialize issuer wallet from environment
        if (process.env.XRPL_ISSUER_SECRET) {
            this.issuerWallet = xrpl.Wallet.fromSeed(process.env.XRPL_ISSUER_SECRET);
            console.log(`🏦 Issuer wallet initialized: ${this.issuerWallet.address}`);
        }
    }

    /**
     * Connect to XRPL network
     */
    async connect() {
        try {
            if (this.isConnected && this.client) {
                return true;
            }

            this.client = new xrpl.Client(process.env.XRPL_ENDPOINT);
            await this.client.connect();
            this.isConnected = true;
            
            console.log("🔗 XRPL Service connected successfully");
            return true;
        } catch (error) {
            console.error("❌ Failed to connect to XRPL:", error.message);
            this.isConnected = false;
            throw error;
        }
    }

    /**
     * Disconnect from XRPL network
     */
    async disconnect() {
        try {
            if (this.client && this.isConnected) {
                await this.client.disconnect();
                this.isConnected = false;
                console.log("✅ XRPL Service disconnected");
            }
        } catch (error) {
            console.error("❌ Error disconnecting from XRPL:", error.message);
        }
    }

    /**
     * Get account information and balances
     */
    async getAccountInfo(address) {
        try {
            await this.ensureConnected();
            
            // Get account info
            const accountInfo = await this.client.request({
                command: 'account_info',
                account: address,
                ledger_index: 'validated'
            });

            // Get account lines (trust lines for issued currencies)
            const accountLines = await this.client.request({
                command: 'account_lines',
                account: address,
                ledger_index: 'validated'
            });

            return {
                address: address,
                xrpBalance: xrpl.dropsToXrp(accountInfo.result.account_data.Balance),
                sequence: accountInfo.result.account_data.Sequence,
                trustLines: accountLines.result.lines || [],
                account: accountInfo.result.account_data
            };
        } catch (error) {
            console.error(`❌ Error getting account info for ${address}:`, error.message);
            throw error;
        }
    }

    /**
     * Create a trust line for issued currency
     */
    async createTrustLine(walletAddress, walletSecret, currency, issuer, limit = "1000000") {
        try {
            await this.ensureConnected();
            
            const wallet = xrpl.Wallet.fromSeed(walletSecret);
            
            const trustSetTx = {
                TransactionType: "TrustSet",
                Account: walletAddress,
                LimitAmount: {
                    currency: currency,
                    issuer: issuer,
                    value: limit
                }
            };

            const prepared = await this.client.autofill(trustSetTx);
            const signed = wallet.sign(prepared);
            const result = await this.client.submitAndWait(signed.tx_blob);

            if (result.result.meta.TransactionResult === "tesSUCCESS") {
                console.log(`✅ Trust line created: ${walletAddress} trusts ${issuer} for ${currency}`);
                return {
                    success: true,
                    txHash: result.result.hash,
                    currency: currency,
                    issuer: issuer,
                    limit: limit
                };
            } else {
                throw new Error(`Trust line creation failed: ${result.result.meta.TransactionResult}`);
            }
        } catch (error) {
            console.error("❌ Error creating trust line:", error.message);
            throw error;
        }
    }

    /**
     * Issue/Mint tokens to a specific address
     */
    async mintTokens(recipientAddress, currency, amount, memo = null) {
        try {
            await this.ensureConnected();
            
            if (!this.issuerWallet) {
                throw new Error("Issuer wallet not initialized");
            }

            const paymentTx = {
                TransactionType: "Payment",
                Account: this.issuerWallet.address,
                Destination: recipientAddress,
                Amount: {
                    currency: currency,
                    value: amount.toString(),
                    issuer: this.issuerWallet.address
                }
            };

            // Add memo if provided
            if (memo) {
                paymentTx.Memos = [{
                    Memo: {
                        MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase(),
                        MemoType: Buffer.from('pledge', 'utf8').toString('hex').toUpperCase()
                    }
                }];
            }

            const prepared = await this.client.autofill(paymentTx);
            const signed = this.issuerWallet.sign(prepared);
            const result = await this.client.submitAndWait(signed.tx_blob);

            if (result.result.meta.TransactionResult === "tesSUCCESS") {
                console.log(`✅ Tokens minted: ${amount} ${currency} to ${recipientAddress}`);
                return {
                    success: true,
                    txHash: result.result.hash,
                    amount: amount,
                    currency: currency,
                    recipient: recipientAddress,
                    issuer: this.issuerWallet.address
                };
            } else {
                throw new Error(`Token minting failed: ${result.result.meta.TransactionResult}`);
            }
        } catch (error) {
            console.error("❌ Error minting tokens:", error.message);
            throw error;
        }
    }

    /**
     * Burn tokens (send back to issuer)
     */
    async burnTokens(holderAddress, holderSecret, currency, amount, memo = null) {
        try {
            await this.ensureConnected();
            
            if (!this.issuerWallet) {
                throw new Error("Issuer wallet not initialized");
            }

            const holderWallet = xrpl.Wallet.fromSeed(holderSecret);

            const paymentTx = {
                TransactionType: "Payment",
                Account: holderAddress,
                Destination: this.issuerWallet.address,
                Amount: {
                    currency: currency,
                    value: amount.toString(),
                    issuer: this.issuerWallet.address
                }
            };

            // Add memo if provided
            if (memo) {
                paymentTx.Memos = [{
                    Memo: {
                        MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase(),
                        MemoType: Buffer.from('redeem', 'utf8').toString('hex').toUpperCase()
                    }
                }];
            }

            const prepared = await this.client.autofill(paymentTx);
            const signed = holderWallet.sign(prepared);
            const result = await this.client.submitAndWait(signed.tx_blob);

            if (result.result.meta.TransactionResult === "tesSUCCESS") {
                console.log(`✅ Tokens burned: ${amount} ${currency} from ${holderAddress}`);
                return {
                    success: true,
                    txHash: result.result.hash,
                    amount: amount,
                    currency: currency,
                    holder: holderAddress,
                    issuer: this.issuerWallet.address
                };
            } else {
                throw new Error(`Token burning failed: ${result.result.meta.TransactionResult}`);
            }
        } catch (error) {
            console.error("❌ Error burning tokens:", error.message);
            throw error;
        }
    }

    /**
     * Create atomic swap offer
     */
    async createSwapOffer(walletAddress, walletSecret, takerGets, takerPays, expiration = null) {
        try {
            await this.ensureConnected();
            
            const wallet = xrpl.Wallet.fromSeed(walletSecret);

            const offerCreateTx = {
                TransactionType: "OfferCreate",
                Account: walletAddress,
                TakerGets: takerGets,
                TakerPays: takerPays
            };

            // Add expiration if provided (seconds since Ripple Epoch)
            if (expiration) {
                offerCreateTx.Expiration = expiration;
            }

            const prepared = await this.client.autofill(offerCreateTx);
            const signed = wallet.sign(prepared);
            const result = await this.client.submitAndWait(signed.tx_blob);

            if (result.result.meta.TransactionResult === "tesSUCCESS") {
                console.log(`✅ Swap offer created by ${walletAddress}`);
                return {
                    success: true,
                    txHash: result.result.hash,
                    takerGets: takerGets,
                    takerPays: takerPays,
                    account: walletAddress
                };
            } else {
                throw new Error(`Swap offer creation failed: ${result.result.meta.TransactionResult}`);
            }
        } catch (error) {
            console.error("❌ Error creating swap offer:", error.message);
            throw error;
        }
    }

    /**
     * Get transaction history for an account
     */
    async getTransactionHistory(address, limit = 20) {
        try {
            await this.ensureConnected();
            
            const response = await this.client.request({
                command: 'account_tx',
                account: address,
                limit: limit,
                ledger_index_min: -1,
                ledger_index_max: -1
            });

            return response.result.transactions.map(tx => ({
                hash: tx.tx.hash,
                type: tx.tx.TransactionType,
                account: tx.tx.Account,
                destination: tx.tx.Destination,
                amount: tx.tx.Amount,
                date: tx.tx.date,
                ledger_index: tx.tx.ledger_index,
                meta: tx.meta
            }));
        } catch (error) {
            console.error(`❌ Error getting transaction history for ${address}:`, error.message);
            throw error;
        }
    }

    /**
     * Validate XRPL address
     */
    isValidAddress(address) {
        try {
            return xrpl.isValidClassicAddress(address);
        } catch (error) {
            return false;
        }
    }

    /**
     * Generate new XRPL wallet
     */
    generateWallet() {
        try {
            const wallet = xrpl.Wallet.generate();
            return {
                address: wallet.address,
                seed: wallet.seed,
                publicKey: wallet.publicKey,
                privateKey: wallet.privateKey
            };
        } catch (error) {
            console.error("❌ Error generating wallet:", error.message);
            throw error;
        }
    }

    /**
     * Ensure XRPL connection is active
     */
    async ensureConnected() {
        if (!this.isConnected || !this.client) {
            await this.connect();
        }
    }

    /**
     * Fund account with testnet XRP (for testing only)
     */
    async fundTestnetAccount(address) {
        try {
            await this.ensureConnected();
            
            // Use XRPL testnet faucet
            const fundWallet = await this.client.fundWallet(null, {
                faucetHost: 'faucet.altnet.rippletest.net',
                amount: '1000'
            });

            if (fundWallet && fundWallet.wallet) {
                console.log(`✅ Testnet account funded: ${address}`);
                return {
                    success: true,
                    address: fundWallet.wallet.address,
                    balance: fundWallet.balance
                };
            }
        } catch (error) {
            console.error(`❌ Error funding testnet account ${address}:`, error.message);
            throw error;
        }
    }

    /**
     * Get current network info
     */
    async getNetworkInfo() {
        try {
            await this.ensureConnected();
            
            const serverInfo = await this.client.request({
                command: 'server_info'
            });

            return {
                networkId: serverInfo.result.info.network_id,
                ledgerVersion: serverInfo.result.info.validated_ledger.seq,
                fee: serverInfo.result.info.validated_ledger.base_fee_xrp,
                reserve: serverInfo.result.info.validated_ledger.reserve_base_xrp
            };
        } catch (error) {
            console.error("❌ Error getting network info:", error.message);
            throw error;
        }
    }
}

module.exports = new XRPLService();