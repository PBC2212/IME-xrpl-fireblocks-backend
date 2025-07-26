const { Client, Wallet, EscrowCreate, EscrowFinish, EscrowCancel } = require('xrpl');
const crypto = require('crypto');

class SwapService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.testnetUrl = 'wss://s.altnet.rippletest.net:51234';
    this.swaps = new Map(); // In-memory storage (use database in production)
    this.statistics = {
      totalSwaps: 0,
      totalVolume: '0',
      activeOffers: 0,
      completedSwaps: 0,
      cancelledSwaps: 0,
      avgCompletionTime: 0,
      successRate: 0
    };
  }

  async connect() {
    if (!this.client || !this.isConnected) {
      this.client = new Client(this.testnetUrl);
      await this.client.connect();
      this.isConnected = true;
      console.log('✅ SwapService connected to XRPL Testnet');
    }
    return this.client;
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
      console.log('🔌 SwapService disconnected from XRPL Testnet');
    }
  }

  // Generate condition/fulfillment pair for atomic swaps (using native crypto)
  generateConditionFulfillment() {
    try {
      // Generate 32 random bytes as preimage
      const preimage = crypto.randomBytes(32);
      const preimageHex = preimage.toString('hex').toUpperCase();
      
      // Create SHA-256 hash of preimage for condition
      const conditionHash = crypto.createHash('sha256').update(preimage).digest('hex').toUpperCase();
      
      // PREIMAGE-SHA-256 condition format (ASN.1 DER encoded)
      // A0 = condition type, 25 = length, 80 = hash type, 20 = hash length
      const condition = `A0258020${conditionHash}810120`;
      
      // PREIMAGE-SHA-256 fulfillment format (ASN.1 DER encoded)  
      // A0 = fulfillment type, 22 = length, 80 = preimage type, 20 = preimage length
      const fulfillment = `A0228020${preimageHex}`;
      
      return {
        condition,
        fulfillment,
        preimage: preimageHex,
        secret: preimageHex
      };
    } catch (error) {
      console.error('Error generating condition/fulfillment:', error);
      throw new Error('Failed to generate condition/fulfillment pair');
    }
  }

  // Create atomic swap offer
  async createSwapOffer(walletSeed, fromAsset, toAsset, amount, options = {}) {
    try {
      await this.connect();
      
      const wallet = Wallet.fromSeed(walletSeed);
      const swapId = this.generateSwapId();
      
      // Generate condition/fulfillment for the swap
      const conditionData = this.generateConditionFulfillment();
      
      // Calculate expiration (default 7 days)
      const expirationSeconds = options.expirationSeconds || (7 * 24 * 60 * 60);
      const cancelAfter = Math.floor(Date.now() / 1000) + expirationSeconds;
      
      // Create the swap offer object
      const swapOffer = {
        swapId,
        fromAsset,
        toAsset,
        amount: parseFloat(amount),
        exchangeRate: options.exchangeRate ? parseFloat(options.exchangeRate) : null,
        assetType: options.assetType || 'other',
        creator: wallet.address,
        creatorSeed: walletSeed, // Store encrypted in production
        status: 'PENDING_ESCROW',
        condition: conditionData.condition,
        fulfillment: conditionData.fulfillment,
        preimage: conditionData.preimage,
        secret: conditionData.secret,
        cancelAfter,
        expiresAt: options.expiresAt || new Date(cancelAfter * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hummingbotStrategy: options.hummingbotStrategy || null,
        escrowDetails: null,
        counterparty: null
      };

      // Store the swap offer
      this.swaps.set(swapId, swapOffer);
      
      // Update statistics
      this.updateStatistics();
      
      console.log('📋 Swap offer created:', {
        swapId,
        fromAsset,
        toAsset,
        amount,
        creator: wallet.address
      });
      
      return {
        success: true,
        swapId,
        swapOffer: {
          ...swapOffer,
          creatorSeed: undefined, // Don't return sensitive data
          fulfillment: undefined,
          preimage: undefined,
          secret: undefined
        }
      };
    } catch (error) {
      console.error('❌ Error creating swap offer:', error);
      throw new Error(`Failed to create swap offer: ${error.message}`);
    }
  }

  // Create XRPL escrow for the swap
  async createEscrow(swapId, destinationAddress) {
    try {
      const swap = this.swaps.get(swapId);
      if (!swap) {
        throw new Error('Swap not found');
      }

      if (swap.status !== 'PENDING_ESCROW') {
        throw new Error('Swap is not in pending escrow state');
      }

      await this.connect();
      
      const wallet = Wallet.fromSeed(swap.creatorSeed);
      
      // Create escrow transaction
      const escrowTx = {
        TransactionType: 'EscrowCreate',
        Account: wallet.address,
        Destination: destinationAddress,
        Amount: (swap.amount * 1000000).toString(), // Convert to drops
        Condition: swap.condition,
        CancelAfter: swap.cancelAfter,
        Fee: '12'
      };

      console.log('🔒 Creating XRPL escrow for swap:', swapId);
      
      const prepared = await this.client.autofill(escrowTx);
      const signed = wallet.sign(prepared);
      const result = await this.client.submitAndWait(signed.tx_blob);
      
      if (result.result.meta.TransactionResult === 'tesSUCCESS') {
        // Update swap with escrow details
        swap.status = 'ACTIVE';
        swap.counterparty = destinationAddress;
        swap.escrowDetails = {
          txHash: result.result.hash,
          sequence: result.result.Sequence,
          ledgerIndex: result.result.ledger_index,
          escrowId: `${wallet.address}:${result.result.Sequence}`
        };
        swap.updatedAt = new Date().toISOString();
        
        this.swaps.set(swapId, swap);
        this.updateStatistics();
        
        return {
          success: true,
          escrowDetails: swap.escrowDetails,
          swap: {
            ...swap,
            creatorSeed: undefined,
            fulfillment: undefined,
            preimage: undefined,
            secret: undefined
          }
        };
      } else {
        throw new Error(`Escrow creation failed: ${result.result.meta.TransactionResult}`);
      }
    } catch (error) {
      console.error('❌ Error creating escrow:', error);
      throw new Error(`Failed to create escrow: ${error.message}`);
    }
  }

  // Accept and complete atomic swap
  async acceptSwapOffer(swapId, counterpartyWalletSeed) {
    try {
      const swap = this.swaps.get(swapId);
      if (!swap) {
        throw new Error('Swap offer not found');
      }

      if (swap.status !== 'PENDING_ESCROW') {
        throw new Error('Swap is not available for acceptance');
      }

      const counterpartyWallet = Wallet.fromSeed(counterpartyWalletSeed);
      
      // First create the escrow
      const escrowResult = await this.createEscrow(swapId, counterpartyWallet.address);
      
      if (!escrowResult.success) {
        throw new Error('Failed to create escrow');
      }

      // Now finish the escrow to complete the swap
      const finishResult = await this.finishEscrow(swapId, counterpartyWalletSeed);
      
      if (finishResult.success) {
        swap.status = 'COMPLETED';
        swap.completedAt = new Date().toISOString();
        swap.updatedAt = new Date().toISOString();
        
        this.swaps.set(swapId, swap);
        this.updateStatistics();
        
        return {
          success: true,
          message: 'Atomic swap completed successfully',
          swap: {
            ...swap,
            creatorSeed: undefined,
            fulfillment: undefined,
            preimage: undefined,
            secret: undefined
          },
          escrowDetails: escrowResult.escrowDetails,
          finishDetails: finishResult.finishDetails
        };
      } else {
        throw new Error('Failed to complete swap');
      }
    } catch (error) {
      console.error('❌ Error accepting swap offer:', error);
      throw new Error(`Failed to accept swap offer: ${error.message}`);
    }
  }

  // Finish escrow to complete swap
  async finishEscrow(swapId, finisherWalletSeed) {
    try {
      const swap = this.swaps.get(swapId);
      if (!swap) {
        throw new Error('Swap not found');
      }

      if (swap.status !== 'ACTIVE') {
        throw new Error('Swap is not active');
      }

      await this.connect();
      
      const finisherWallet = Wallet.fromSeed(finisherWalletSeed);
      
      const finishTx = {
        TransactionType: 'EscrowFinish',
        Account: finisherWallet.address,
        Owner: swap.creator,
        OfferSequence: swap.escrowDetails.sequence,
        Condition: swap.condition,
        Fulfillment: swap.fulfillment,
        Fee: (330 + Math.ceil(swap.fulfillment.length / 2 / 16) * 10).toString()
      };

      console.log('✅ Finishing escrow for swap:', swapId);
      
      const prepared = await this.client.autofill(finishTx);
      const signed = finisherWallet.sign(prepared);
      const result = await this.client.submitAndWait(signed.tx_blob);
      
      if (result.result.meta.TransactionResult === 'tesSUCCESS') {
        return {
          success: true,
          finishDetails: {
            txHash: result.result.hash,
            ledgerIndex: result.result.ledger_index,
            delivered: result.result.meta.delivered_amount
          }
        };
      } else {
        throw new Error(`Escrow finish failed: ${result.result.meta.TransactionResult}`);
      }
    } catch (error) {
      console.error('❌ Error finishing escrow:', error);
      throw new Error(`Failed to finish escrow: ${error.message}`);
    }
  }

  // Cancel swap offer
  async cancelSwapOffer(swapId, walletSeed) {
    try {
      const swap = this.swaps.get(swapId);
      if (!swap) {
        throw new Error('Swap offer not found');
      }

      const wallet = Wallet.fromSeed(walletSeed);
      
      if (swap.creator !== wallet.address) {
        throw new Error('Only the swap creator can cancel this offer');
      }

      if (swap.status === 'COMPLETED' || swap.status === 'CANCELLED') {
        throw new Error('Swap is already completed or cancelled');
      }

      // If escrow was created, cancel it on XRPL
      if (swap.status === 'ACTIVE' && swap.escrowDetails) {
        await this.cancelEscrow(swapId, walletSeed);
      }

      swap.status = 'CANCELLED';
      swap.cancelledAt = new Date().toISOString();
      swap.updatedAt = new Date().toISOString();
      
      this.swaps.set(swapId, swap);
      this.updateStatistics();
      
      return {
        success: true,
        message: 'Swap offer cancelled successfully',
        swap: {
          ...swap,
          creatorSeed: undefined,
          fulfillment: undefined,
          preimage: undefined,
          secret: undefined
        }
      };
    } catch (error) {
      console.error('❌ Error cancelling swap offer:', error);
      throw new Error(`Failed to cancel swap offer: ${error.message}`);
    }
  }

  // Cancel escrow on XRPL
  async cancelEscrow(swapId, cancellerWalletSeed) {
    try {
      const swap = this.swaps.get(swapId);
      if (!swap) {
        throw new Error('Swap not found');
      }

      await this.connect();
      
      const cancellerWallet = Wallet.fromSeed(cancellerWalletSeed);
      
      const cancelTx = {
        TransactionType: 'EscrowCancel',
        Account: cancellerWallet.address,
        Owner: swap.creator,
        OfferSequence: swap.escrowDetails.sequence,
        Fee: '12'
      };

      console.log('❌ Cancelling escrow for swap:', swapId);
      
      const prepared = await this.client.autofill(cancelTx);
      const signed = cancellerWallet.sign(prepared);
      const result = await this.client.submitAndWait(signed.tx_blob);
      
      if (result.result.meta.TransactionResult === 'tesSUCCESS') {
        return {
          success: true,
          cancelDetails: {
            txHash: result.result.hash,
            ledgerIndex: result.result.ledger_index,
            returned: result.result.Amount
          }
        };
      } else {
        throw new Error(`Escrow cancel failed: ${result.result.meta.TransactionResult}`);
      }
    } catch (error) {
      console.error('❌ Error cancelling escrow:', error);
      throw new Error(`Failed to cancel escrow: ${error.message}`);
    }
  }

  // Get active swap offers
  getActiveSwapOffers(filterOptions = {}) {
    const activeSwaps = Array.from(this.swaps.values())
      .filter(swap => swap.status === 'PENDING_ESCROW' || swap.status === 'ACTIVE')
      .filter(swap => {
        if (filterOptions.fromAsset && swap.fromAsset !== filterOptions.fromAsset) return false;
        if (filterOptions.toAsset && swap.toAsset !== filterOptions.toAsset) return false;
        if (filterOptions.minAmount && swap.amount < parseFloat(filterOptions.minAmount)) return false;
        if (filterOptions.maxAmount && swap.amount > parseFloat(filterOptions.maxAmount)) return false;
        return true;
      })
      .map(swap => ({
        ...swap,
        creatorSeed: undefined,
        fulfillment: undefined,
        preimage: undefined,
        secret: undefined
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      success: true,
      offers: activeSwaps,
      total: activeSwaps.length,
      timestamp: new Date().toISOString()
    };
  }

  // Get user's swap offers
  getUserSwapOffers(address) {
    const userSwaps = Array.from(this.swaps.values())
      .filter(swap => swap.creator === address || swap.counterparty === address)
      .map(swap => ({
        ...swap,
        creatorSeed: undefined,
        fulfillment: undefined,
        preimage: undefined,
        secret: undefined
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      success: true,
      offers: userSwaps,
      total: userSwaps.length,
      timestamp: new Date().toISOString()
    };
  }

  // Register Hummingbot offer
  async registerHummingbotOffer(offerData) {
    try {
      const botSwapId = this.generateSwapId('BOT');
      
      const botOffer = {
        swapId: botSwapId,
        fromAsset: offerData.fromAsset,
        toAsset: offerData.toAsset,
        amount: parseFloat(offerData.amount),
        exchangeRate: parseFloat(offerData.exchangeRate),
        source: 'hummingbot',
        strategy: offerData.strategy || 'market_making',
        status: 'ACTIVE',
        creator: 'hummingbot-system',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      this.swaps.set(botSwapId, botOffer);
      this.updateStatistics();
      
      return {
        success: true,
        botSwapId,
        botOffer
      };
    } catch (error) {
      console.error('❌ Error registering Hummingbot offer:', error);
      throw new Error(`Failed to register Hummingbot offer: ${error.message}`);
    }
  }

  // Get swap statistics
  getSwapStatistics() {
    this.updateStatistics();
    return {
      success: true,
      data: this.statistics,
      timestamp: new Date().toISOString()
    };
  }

  // Update statistics
  updateStatistics() {
    const allSwaps = Array.from(this.swaps.values());
    
    this.statistics.totalSwaps = allSwaps.length;
    this.statistics.activeOffers = allSwaps.filter(s => s.status === 'PENDING_ESCROW' || s.status === 'ACTIVE').length;
    this.statistics.completedSwaps = allSwaps.filter(s => s.status === 'COMPLETED').length;
    this.statistics.cancelledSwaps = allSwaps.filter(s => s.status === 'CANCELLED').length;
    
    // Calculate total volume
    const totalVolume = allSwaps.reduce((sum, swap) => sum + swap.amount, 0);
    this.statistics.totalVolume = totalVolume.toFixed(2);
    
    // Calculate success rate
    const totalFinished = this.statistics.completedSwaps + this.statistics.cancelledSwaps;
    this.statistics.successRate = totalFinished > 0 ? 
      ((this.statistics.completedSwaps / totalFinished) * 100).toFixed(1) : 0;
    
    // Calculate average completion time (mock for now)
    this.statistics.avgCompletionTime = '4.2 minutes';
  }

  // Generate unique swap ID
  generateSwapId(prefix = 'SWAP') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  // Notify Hummingbot (webhook placeholder)
  notifyHummingbot(event, data) {
    // In production, send webhook to Hummingbot
    console.log('🤖 Hummingbot notification:', event, data);
    
    // Placeholder for webhook implementation
    // fetch('http://hummingbot-webhook-url', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ event, data, timestamp: new Date().toISOString() })
    // });
  }

  // Clean up expired swaps (call periodically)
  cleanupExpiredSwaps() {
    const now = Math.floor(Date.now() / 1000);
    let cleanedCount = 0;
    
    for (const [swapId, swap] of this.swaps.entries()) {
      if (swap.cancelAfter && now > swap.cancelAfter && swap.status === 'ACTIVE') {
        swap.status = 'EXPIRED';
        swap.expiredAt = new Date().toISOString();
        swap.updatedAt = new Date().toISOString();
        this.swaps.set(swapId, swap);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired swaps`);
      this.updateStatistics();
    }
    
    return cleanedCount;
  }
}

// Export singleton instance
module.exports = new SwapService();