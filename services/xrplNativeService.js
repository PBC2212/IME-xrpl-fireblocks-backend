const { Client, Wallet, xrpToDrops, dropsToXrp } = require('xrpl');
const { createTrustLineMemo } = require('../utils/trustLineHelpers');

class XRPLNativeService {
  constructor() {
    this.client = null;
    this.issuerWallet = null;
    this.isConnected = false;
  }

  // Initialize XRPL connection
  async initialize() {
    try {
      if (!this.client) {
        this.client = new Client(process.env.XRPL_ENDPOINT);
      }
      
      if (!this.isConnected) {
        await this.client.connect();
        this.isConnected = true;
        console.log('✅ Connected to XRPL network:', process.env.XRPL_ENDPOINT);
      }

      // Initialize issuer wallet if provided
      if (process.env.XRPL_ISSUER_SECRET && !this.issuerWallet) {
        this.issuerWallet = Wallet.fromSeed(process.env.XRPL_ISSUER_SECRET);
        console.log('✅ Issuer wallet initialized:', this.issuerWallet.address);
      }

      return true;
    } catch (error) {
      console.error('❌ XRPL initialization failed:', error);
      throw new Error(`Failed to connect to XRPL: ${error.message}`);
    }
  }

  // Ensure connection before operations
  async ensureConnection() {
    if (!this.isConnected || !this.client) {
      await this.initialize();
    }
  }

  // Get platform statistics
  async getPlatformStats() {
    await this.ensureConnection();
    
    try {
      const serverInfo = await this.client.request({
        command: 'server_info'
      });

      const ledgerInfo = await this.client.request({
        command: 'ledger',
        ledger_index: 'validated'
      });

      return {
        network: process.env.XRPL_ENDPOINT.includes('altnet') ? 'testnet' : 'mainnet',
        serverState: serverInfo.result.info.server_state,
        ledgerIndex: ledgerInfo.result.ledger.ledger_index,
        totalCoins: dropsToXrp(ledgerInfo.result.ledger.total_coins),
        reserveBase: serverInfo.result.info.validated_ledger.reserve_base_xrp || '10',
        reserveIncrement: serverInfo.result.info.validated_ledger.reserve_inc_xrp || '2',
        defaultTokenIssuer: process.env.DEFAULT_ASSET_ISSUER,
        defaultTokenCurrency: process.env.DEFAULT_ASSET_CURRENCY,
        platformVersion: '1.0.0'
      };
    } catch (error) {
      throw new Error(`Failed to get platform stats: ${error.message}`);
    }
  }

  // Create new XRPL wallet
  async createWallet(userId, walletName) {
    await this.ensureConnection();
    
    try {
      // Generate new wallet
      const wallet = Wallet.generate();
      
      // Fund wallet on testnet
      if (process.env.XRPL_ENDPOINT.includes('altnet')) {
        await this.client.fundWallet(wallet);
      }

      // Get wallet info
      const accountInfo = await this.client.request({
        command: 'account_info',
        account: wallet.address,
        ledger_index: 'validated'
      });

      return {
        address: wallet.address,
        seed: wallet.seed,
        balance: dropsToXrp(accountInfo.result.account_data.Balance),
        sequence: accountInfo.result.account_data.Sequence,
        network: process.env.XRPL_ENDPOINT.includes('altnet') ? 'testnet' : 'mainnet',
        userId,
        walletName,
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Failed to create wallet: ${error.message}`);
    }
  }

  // Get wallet information and balances
  async getWalletInfo(address) {
    await this.ensureConnection();
    
    try {
      const accountInfo = await this.client.request({
        command: 'account_info',
        account: address,
        ledger_index: 'validated'
      });

      // Get trust lines (token balances)
      const trustLines = await this.client.request({
        command: 'account_lines',
        account: address,
        ledger_index: 'validated'
      });

      return {
        address,
        balance: dropsToXrp(accountInfo.result.account_data.Balance),
        sequence: accountInfo.result.account_data.Sequence,
        ownerCount: accountInfo.result.account_data.OwnerCount || 0,
        reserve: dropsToXrp(accountInfo.result.account_data.Reserve || '0'),
        trustLines: trustLines.result.lines.map(line => ({
          currency: line.currency,
          issuer: line.account,
          balance: line.balance,
          limit: line.limit,
          limitPeer: line.limit_peer
        })),
        network: process.env.XRPL_ENDPOINT.includes('altnet') ? 'testnet' : 'mainnet'
      };
    } catch (error) {
      throw new Error(`Failed to get wallet info: ${error.message}`);
    }
  }

  // Get transaction history
  async getTransactionHistory(address, limit = 10) {
    await this.ensureConnection();
    
    try {
      const transactions = await this.client.request({
        command: 'account_tx',
        account: address,
        limit,
        ledger_index_min: -1,
        ledger_index_max: -1,
        binary: false,
        forward: false
      });

      return transactions.result.transactions.map(tx => ({
        hash: tx.tx.hash,
        type: tx.tx.TransactionType,
        date: tx.tx.date ? new Date((tx.tx.date + 946684800) * 1000).toISOString() : null,
        fee: dropsToXrp(tx.tx.Fee),
        sequence: tx.tx.Sequence,
        account: tx.tx.Account,
        destination: tx.tx.Destination,
        amount: tx.tx.Amount ? (typeof tx.tx.Amount === 'string' ? dropsToXrp(tx.tx.Amount) : tx.tx.Amount) : null,
        ledgerIndex: tx.ledger_index,
        meta: tx.meta,
        validated: tx.validated
      }));
    } catch (error) {
      throw new Error(`Failed to get transaction history: ${error.message}`);
    }
  }

  // Validate XRPL address
  async validateAddress(address) {
    try {
      // Basic format validation
      const isValidFormat = /^r[a-zA-Z0-9]{25,34}$/.test(address);
      
      if (!isValidFormat) {
        return {
          address,
          isValid: false,
          exists: false,
          reason: 'Invalid address format'
        };
      }

      await this.ensureConnection();

      // Check if account exists on ledger
      try {
        const accountInfo = await this.client.request({
          command: 'account_info',
          account: address,
          ledger_index: 'validated'
        });

        return {
          address,
          isValid: true,
          exists: true,
          balance: dropsToXrp(accountInfo.result.account_data.Balance),
          sequence: accountInfo.result.account_data.Sequence
        };
      } catch (error) {
        if (error.data && error.data.error === 'actNotFound') {
          return {
            address,
            isValid: true,
            exists: false,
            reason: 'Account not found on ledger'
          };
        }
        throw error;
      }
    } catch (error) {
      return {
        address,
        isValid: false,
        exists: false,
        reason: error.message
      };
    }
  }

  // Enhanced create trust line with metadata
  async createTrustLineEnhanced(walletSeed, tokenSymbol = 'RWA', limit = '1000000', metadata = {}) {
    await this.ensureConnection();
    
    try {
      const wallet = Wallet.fromSeed(walletSeed);
      const issuer = process.env.DEFAULT_ASSET_ISSUER || this.issuerWallet?.address;
      
      if (!issuer) {
        throw new Error('No token issuer configured');
      }

      const trustSet = {
        TransactionType: 'TrustSet',
        Account: wallet.address,
        LimitAmount: {
          currency: tokenSymbol,
          issuer: issuer,
          value: limit
        },
        Memos: [
          createTrustLineMemo('create_trustline', {
            tokenSymbol,
            limit,
            issuer,
            metadata
          })
        ]
      };

      const prepared = await this.client.autofill(trustSet);
      const signed = wallet.sign(prepared);
      const result = await this.client.submitAndWait(signed.tx_blob);

      return {
        txHash: result.result.hash,
        currency: tokenSymbol,
        issuer: issuer,
        limit: limit,
        account: wallet.address,
        validated: result.result.validated,
        ledgerIndex: result.result.ledger_index,
        fee: result.result.Fee ? dropsToXrp(result.result.Fee) : '0',
        metadata,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Failed to create enhanced trust line: ${error.message}`);
    }
  }

  // Original create trust line method (for backward compatibility)
  async createTrustLine(walletSeed, tokenSymbol = 'RWA', limit = '1000000') {
    await this.ensureConnection();
    
    try {
      const wallet = Wallet.fromSeed(walletSeed);
      const issuer = process.env.DEFAULT_ASSET_ISSUER || this.issuerWallet?.address;
      
      if (!issuer) {
        throw new Error('No token issuer configured');
      }

      const trustSet = {
        TransactionType: 'TrustSet',
        Account: wallet.address,
        LimitAmount: {
          currency: tokenSymbol,
          issuer: issuer,
          value: limit
        }
      };

      const prepared = await this.client.autofill(trustSet);
      const signed = wallet.sign(prepared);
      const result = await this.client.submitAndWait(signed.tx_blob);

      return {
        txHash: result.result.hash,
        currency: tokenSymbol,
        issuer: issuer,
        limit: limit,
        account: wallet.address,
        validated: result.result.validated,
        ledgerIndex: result.result.ledger_index
      };
    } catch (error) {
      throw new Error(`Failed to create trust line: ${error.message}`);
    }
  }

  // Enhanced pledge asset and mint tokens with metadata
  async pledgeAssetEnhanced(userAddress, assetType, assetAmount, assetDescription, tokenSymbol = 'RWA', metadata = {}) {
    await this.ensureConnection();
    
    try {
      if (!this.issuerWallet) {
        throw new Error('Issuer wallet not configured');
      }

      // Create enhanced memo with metadata
      const enhancedMemoData = {
        assetType,
        assetAmount,
        assetDescription,
        tokenSymbol,
        metadata,
        timestamp: new Date().toISOString(),
        platform: 'XRPL-Native-RWA',
        version: '1.0.0'
      };

      // Create payment to mint tokens
      const payment = {
        TransactionType: 'Payment',
        Account: this.issuerWallet.address,
        Destination: userAddress,
        Amount: {
          currency: tokenSymbol,
          issuer: this.issuerWallet.address,
          value: assetAmount
        },
        Memos: [
          {
            Memo: {
              MemoType: Buffer.from('AssetTokenization', 'utf8').toString('hex').toUpperCase(),
              MemoData: Buffer.from(JSON.stringify(enhancedMemoData), 'utf8').toString('hex').toUpperCase()
            }
          }
        ]
      };

      const prepared = await this.client.autofill(payment);
      const signed = this.issuerWallet.sign(prepared);
      const result = await this.client.submitAndWait(signed.tx_blob);

      return {
        tokensMinted: assetAmount,
        tokenSymbol,
        txHash: result.result.hash,
        recipientAddress: userAddress,
        assetDetails: {
          type: assetType,
          amount: assetAmount,
          description: assetDescription
        },
        metadata,
        validated: result.result.validated,
        ledgerIndex: result.result.ledger_index,
        fee: result.result.Fee ? dropsToXrp(result.result.Fee) : '0',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Failed to tokenize asset: ${error.message}`);
    }
  }

  // Original pledge asset method (for backward compatibility)
  async pledgeAsset(userAddress, assetType, assetAmount, assetDescription, tokenSymbol = 'RWA') {
    await this.ensureConnection();
    
    try {
      if (!this.issuerWallet) {
        throw new Error('Issuer wallet not configured');
      }

      // Create payment to mint tokens
      const payment = {
        TransactionType: 'Payment',
        Account: this.issuerWallet.address,
        Destination: userAddress,
        Amount: {
          currency: tokenSymbol,
          issuer: this.issuerWallet.address,
          value: assetAmount
        },
        Memos: [
          {
            Memo: {
              MemoType: Buffer.from('AssetPledge', 'utf8').toString('hex').toUpperCase(),
              MemoData: Buffer.from(JSON.stringify({
                assetType,
                assetAmount,
                assetDescription,
                timestamp: new Date().toISOString()
              }), 'utf8').toString('hex').toUpperCase()
            }
          }
        ]
      };

      const prepared = await this.client.autofill(payment);
      const signed = this.issuerWallet.sign(prepared);
      const result = await this.client.submitAndWait(signed.tx_blob);

      return {
        tokensMinted: assetAmount,
        tokenSymbol,
        txHash: result.result.hash,
        recipientAddress: userAddress,
        assetDetails: {
          type: assetType,
          amount: assetAmount,
          description: assetDescription
        },
        validated: result.result.validated,
        ledgerIndex: result.result.ledger_index
      };
    } catch (error) {
      throw new Error(`Failed to pledge asset: ${error.message}`);
    }
  }

  // Redeem tokens (burn)
  async redeemTokens(walletSeed, tokenAmount, tokenSymbol = 'RWA') {
    await this.ensureConnection();
    
    try {
      const wallet = Wallet.fromSeed(walletSeed);
      const issuer = process.env.DEFAULT_ASSET_ISSUER || this.issuerWallet?.address;
      
      if (!issuer) {
        throw new Error('No token issuer configured');
      }

      // Send tokens back to issuer (burns them)
      const payment = {
        TransactionType: 'Payment',
        Account: wallet.address,
        Destination: issuer,
        Amount: {
          currency: tokenSymbol,
          issuer: issuer,
          value: tokenAmount
        },
        Memos: [
          {
            Memo: {
              MemoType: Buffer.from('TokenRedemption', 'utf8').toString('hex').toUpperCase(),
              MemoData: Buffer.from(JSON.stringify({
                tokenAmount,
                tokenSymbol,
                timestamp: new Date().toISOString()
              }), 'utf8').toString('hex').toUpperCase()
            }
          }
        ]
      };

      const prepared = await this.client.autofill(payment);
      const signed = wallet.sign(prepared);
      const result = await this.client.submitAndWait(signed.tx_blob);

      return {
        tokensBurned: tokenAmount,
        tokenSymbol,
        txHash: result.result.hash,
        fromAddress: wallet.address,
        validated: result.result.validated,
        ledgerIndex: result.result.ledger_index
      };
    } catch (error) {
      throw new Error(`Failed to redeem tokens: ${error.message}`);
    }
  }

  // Create DEX swap offer
  async createSwapOffer(walletSeed, fromAsset, toAsset, amount, exchangeRate) {
    await this.ensureConnection();
    
    try {
      const wallet = Wallet.fromSeed(walletSeed);
      
      // Parse assets
      const takerGets = this.parseAsset(fromAsset, amount);
      const takerPays = this.parseAsset(toAsset, exchangeRate ? (parseFloat(amount) * parseFloat(exchangeRate)).toString() : amount);

      const offer = {
        TransactionType: 'OfferCreate',
        Account: wallet.address,
        TakerGets: takerGets,
        TakerPays: takerPays
      };

      const prepared = await this.client.autofill(offer);
      const signed = wallet.sign(prepared);
      const result = await this.client.submitAndWait(signed.tx_blob);

      return {
        offering: `${amount} ${fromAsset}`,
        requesting: `${takerPays.value || dropsToXrp(takerPays)} ${toAsset}`,
        txHash: result.result.hash,
        account: wallet.address,
        validated: result.result.validated,
        ledgerIndex: result.result.ledger_index
      };
    } catch (error) {
      throw new Error(`Failed to create swap offer: ${error.message}`);
    }
  }

  // Get order book
  async getOrderBook(base, counter) {
    await this.ensureConnection();
    
    try {
      const baseAsset = this.parseAssetForOrderbook(base);
      const counterAsset = this.parseAssetForOrderbook(counter);

      const orderBook = await this.client.request({
        command: 'book_offers',
        taker_gets: baseAsset,
        taker_pays: counterAsset,
        limit: 20
      });

      return {
        base,
        counter,
        offers: orderBook.result.offers.map(offer => ({
          account: offer.Account,
          sequence: offer.Sequence,
          takerGets: offer.TakerGets,
          takerPays: offer.TakerPays,
          quality: offer.quality
        })),
        ledgerIndex: orderBook.result.ledger_index
      };
    } catch (error) {
      throw new Error(`Failed to get order book: ${error.message}`);
    }
  }

  // Helper function to parse asset format
  parseAsset(asset, amount) {
    if (asset === 'XRP') {
      return xrpToDrops(amount);
    } else {
      const issuer = process.env.DEFAULT_ASSET_ISSUER || this.issuerWallet?.address;
      return {
        currency: asset,
        issuer: issuer,
        value: amount
      };
    }
  }

  // Helper function to parse asset for orderbook
  parseAssetForOrderbook(asset) {
    if (asset === 'XRP') {
      return { currency: 'XRP' };
    } else {
      const issuer = process.env.DEFAULT_ASSET_ISSUER || this.issuerWallet?.address;
      return {
        currency: asset,
        issuer: issuer
      };
    }
  }

  // Cleanup connection
  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
      console.log('🔌 Disconnected from XRPL network');
    }
  }
}

// Export singleton instance
module.exports = new XRPLNativeService();