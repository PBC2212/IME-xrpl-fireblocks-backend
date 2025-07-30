/**
 * Initialize Liquidity Integration - Production Ready
 * Sets up the complete integration between Tokenization Platform and Liquidity Engine
 * Copyright (c) 2025 IME Capital Trust LLC
 */

'use strict';

const LiquidityIntegration = require('../services/liquidityIntegration');
const LiquidityController = require('../controllers/liquidityController');
const createLiquidityRoutes = require('../routes/liquidityRoutes');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

class LiquidityIntegrationManager {
  constructor() {
    this.liquidityIntegration = null;
    this.liquidityController = null;
    this.liquidityRoutes = null;
    this.isInitialized = false;
    this.eventHandlers = new Map();
  }

  async initialize(app) {
    try {
      logger.info('🔗 Initializing Liquidity Integration with Project 2...');

      // 1. Initialize the liquidity integration service
      this.liquidityIntegration = new LiquidityIntegration();
      await this.liquidityIntegration.initialize();

      // 2. Initialize the controller
      this.liquidityController = new LiquidityController(this.liquidityIntegration);

      // 3. Setup routes
      this.liquidityRoutes = createLiquidityRoutes(this.liquidityController);
      app.use('/api/v1/liquidity', this.liquidityRoutes);

      // 4. Setup event handlers
      this.setupEventHandlers();

      // 5. Test connection to Liquidity Engine
      await this.testConnection();

      this.isInitialized = true;

      logger.info('✅ Liquidity Integration initialized successfully');
      logger.info('🚀 Ready to communicate with Liquidity Engine on Project 2');

      return {
        success: true,
        integration: this.liquidityIntegration,
        controller: this.liquidityController,
        routes: this.liquidityRoutes
      };

    } catch (error) {
      logger.error('❌ Failed to initialize Liquidity Integration', { 
        error: error.message 
      });
      
      // Return partial initialization for graceful degradation
      return {
        success: false,
        error: error.message,
        integration: null
      };
    }
  }

  setupEventHandlers() {
    // Handle verification completion events
    this.liquidityIntegration.on('verificationComplete', (verificationData) => {
      logger.info('📋 Verification completed by Liquidity Engine', {
        assetId: verificationData.assetId,
        approved: verificationData.result.approved
      });

      // Emit to main application
      this.emit('verificationComplete', verificationData);
    });

    // Handle liquidity availability events
    this.liquidityIntegration.on('liquidityAvailable', (liquidityData) => {
      logger.info('💰 Liquidity available from Liquidity Engine', {
        tokenId: liquidityData.tokenId,
        amount: liquidityData.liquidityAmount
      });

      // Emit to main application
      this.emit('liquidityAvailable', liquidityData);
    });

    // Handle counterparty matching events
    this.liquidityIntegration.on('counterpartyMatched', (matchData) => {
      logger.info('🤝 Counterparty matched by Liquidity Engine', {
        tokenId: matchData.tokenId,
        counterparty: matchData.counterparty.name
      });

      // Emit to main application
      this.emit('counterpartyMatched', matchData);
    });
  }

  async testConnection() {
    try {
      const connectionTest = await this.liquidityIntegration.testConnection();
      
      if (connectionTest.connected) {
        logger.info('✅ Connection to Liquidity Engine verified');
      } else {
        logger.warn('⚠️ Could not connect to Liquidity Engine - will retry automatically');
      }

      return connectionTest;

    } catch (error) {
      logger.warn('⚠️ Liquidity Engine connection test failed', { error: error.message });
      return { connected: false, error: error.message };
    }
  }

  // Helper methods for the main application to use

  /**
   * Notify Project 2 when a user pledges an asset
   * Call this from your asset pledging workflow
   */
  async notifyAssetPledged(assetData) {
    try {
      if (!this.isInitialized || !this.liquidityIntegration) {
        logger.debug('Liquidity integration not available for asset pledge notification');
        return null;
      }

      const pledgeId = await this.liquidityIntegration.notifyAssetPledged(assetData);
      
      logger.info('🏠 Asset pledge sent to Liquidity Engine', {
        assetId: assetData.assetId,
        pledgeId,
        assetType: assetData.assetType
      });

      return pledgeId;

    } catch (error) {
      logger.error('Failed to notify asset pledge', { error: error.message });
      throw error;
    }
  }

  /**
   * Notify Project 2 when a token is minted
   * Call this from your token minting workflow
   */
  async notifyTokenMinted(tokenData) {
    try {
      if (!this.isInitialized || !this.liquidityIntegration) {
        logger.debug('Liquidity integration not available for token minting notification');
        return;
      }

      await this.liquidityIntegration.notifyTokenMinted(tokenData);
      
      logger.info('🪙 Token minting sent to Liquidity Engine', {
        tokenId: tokenData.tokenId,
        assetId: tokenData.assetId
      });

    } catch (error) {
      logger.error('Failed to notify token minting', { error: error.message });
      throw error;
    }
  }

  /**
   * Notify Project 2 when a trustline is created
   * Call this from your trustline setup workflow
   */
  async notifyTrustlineCreated(trustlineData) {
    try {
      if (!this.isInitialized || !this.liquidityIntegration) {
        logger.debug('Liquidity integration not available for trustline notification');
        return;
      }

      await this.liquidityIntegration.notifyTrustlineCreated(trustlineData);
      
      logger.info('🔗 Trustline creation sent to Liquidity Engine', {
        tokenId: trustlineData.tokenId,
        walletAddress: trustlineData.walletAddress
      });

    } catch (error) {
      logger.error('Failed to notify trustline creation', { error: error.message });
      throw error;
    }
  }

  /**
   * Get status of an asset's verification and liquidity
   */
  getAssetStatus(assetId) {
    if (!this.liquidityIntegration) {
      return { status: 'INTEGRATION_UNAVAILABLE' };
    }

    return this.liquidityIntegration.getAssetStatus(assetId);
  }

  /**
   * Get integration statistics
   */
  getIntegrationStats() {
    if (!this.liquidityIntegration) {
      return { enabled: false, reason: 'Integration not initialized' };
    }

    return this.liquidityIntegration.getIntegrationStats();
  }

  /**
   * Check if integration is working
   */
  isConnected() {
    return this.isInitialized && this.liquidityIntegration;
  }

  /**
   * Register event handlers for the main application
   */
  onVerificationComplete(handler) {
    this.eventHandlers.set('verificationComplete', handler);
  }

  onLiquidityAvailable(handler) {
    this.eventHandlers.set('liquidityAvailable', handler);
  }

  onCounterpartyMatched(handler) {
    this.eventHandlers.set('counterpartyMatched', handler);
  }

  // Emit events to registered handlers
  emit(eventName, data) {
    const handler = this.eventHandlers.get(eventName);
    if (handler && typeof handler === 'function') {
      try {
        handler(data);
      } catch (error) {
        logger.error(`Error in ${eventName} handler`, { error: error.message });
      }
    }
  }

  // Graceful shutdown
  async close() {
    try {
      if (this.liquidityIntegration) {
        await this.liquidityIntegration.close();
      }
      
      this.eventHandlers.clear();
      this.isInitialized = false;
      
      logger.info('🔒 Liquidity Integration closed');

    } catch (error) {
      logger.error('Error closing Liquidity Integration', { error: error.message });
    }
  }
}

// Export a singleton instance
const liquidityIntegrationManager = new LiquidityIntegrationManager();

module.exports = liquidityIntegrationManager;