/**
 * Liquidity Integration Service - Production Ready
 * Handles communication between Tokenization Platform and Liquidity Engine
 * Sends asset pledges and receives liquidity notifications
 * Copyright (c) 2025 IME Capital Trust LLC
 */

'use strict';

const Redis = require('redis');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: './logs/liquidity-integration.log'
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

class LiquidityIntegrationService {
  constructor() {
    this.isInitialized = false;
    this.redisClient = null;
    this.liquidityEngineClient = null;
    
    // Configuration
    this.config = {
      liquidityEngineUrl: process.env.LIQUIDITY_ENGINE_URL || 'http://localhost:4000',
      redisUrl: process.env.SHARED_REDIS_URL || 'redis://localhost:6379/1',
      enabled: process.env.LIQUIDITY_INTEGRATION_ENABLED !== 'false'
    };
    
    // Communication channels (match Project 2)
    this.channels = {
      ASSET_PLEDGED: 'asset_pledged',
      TOKEN_MINTED: 'token_minted',
      TRUSTLINE_CREATED: 'trustline_created',
      VERIFICATION_COMPLETE: 'verification_complete',
      LIQUIDITY_AVAILABLE: 'liquidity_available',
      COUNTERPARTY_MATCHED: 'counterparty_matched'
    };
    
    // Event tracking
    this.stats = {
      assetsSent: 0,
      verificationsReceived: 0,
      liquidityNotifications: 0,
      errors: 0,
      lastCommunication: null
    };
    
    // Pending asset tracking
    this.pendingAssets = new Map();
    this.verificationResults = new Map();
    this.liquidityStatus = new Map();
  }

  async initialize() {
    try {
      if (!this.config.enabled) {
        logger.info('Liquidity integration is disabled');
        return;
      }

      logger.info('Initializing Liquidity Integration Service...');
      
      // Initialize Redis connection
      await this.initializeRedis();
      
      // Initialize HTTP client for Liquidity Engine
      this.initializeLiquidityEngineClient();
      
      // Subscribe to response channels
      await this.subscribeToResponseChannels();
      
      // Register with Liquidity Engine
      await this.registerWithLiquidityEngine();
      
      this.isInitialized = true;
      
      logger.info('Liquidity Integration Service initialized successfully', {
        liquidityEngineUrl: this.config.liquidityEngineUrl,
        redisConnected: !!this.redisClient
      });

    } catch (error) {
      logger.error('Failed to initialize Liquidity Integration Service', { 
        error: error.message 
      });
      throw error;
    }
  }

  async initializeRedis() {
    try {
      this.redisClient = Redis.createClient({
        url: this.config.redisUrl,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3
      });

      this.redisClient.on('error', (err) => {
        logger.error('Redis connection error', { error: err.message });
        this.stats.errors++;
      });

      this.redisClient.on('connect', () => {
        logger.info('Connected to shared Redis for liquidity integration');
      });

      await this.redisClient.connect();

    } catch (error) {
      logger.error('Redis initialization failed', { error: error.message });
      throw error;
    }
  }

  initializeLiquidityEngineClient() {
    this.liquidityEngineClient = axios.create({
      baseURL: this.config.liquidityEngineUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Source-Service': 'tokenization-platform',
        'Authorization': `Bearer ${process.env.LIQUIDITY_ENGINE_API_KEY || 'tokenization-platform-key'}`
      }
    });

    // Add request/response interceptors
    this.liquidityEngineClient.interceptors.response.use(
      (response) => {
        this.stats.lastCommunication = new Date().toISOString();
        return response;
      },
      (error) => {
        this.stats.errors++;
        logger.error('Liquidity Engine API error', {
          url: error.config?.url,
          status: error.response?.status,
          error: error.message
        });
        return Promise.reject(error);
      }
    );
  }

  async subscribeToResponseChannels() {
    try {
      // Create separate Redis client for subscriptions
      this.redisSubscriber = Redis.createClient({
        url: this.config.redisUrl
      });

      await this.redisSubscriber.connect();

      // Subscribe to response channels
      await this.redisSubscriber.subscribe(this.channels.VERIFICATION_COMPLETE, (message) => {
        this.handleVerificationResult(JSON.parse(message));
      });

      await this.redisSubscriber.subscribe(this.channels.LIQUIDITY_AVAILABLE, (message) => {
        this.handleLiquidityAvailable(JSON.parse(message));
      });

      await this.redisSubscriber.subscribe(this.channels.COUNTERPARTY_MATCHED, (message) => {
        this.handleCounterpartyMatched(JSON.parse(message));
      });

      logger.info('Subscribed to liquidity response channels');

    } catch (error) {
      logger.error('Failed to subscribe to response channels', { error: error.message });
    }
  }

  async notifyAssetPledged(assetData) {
    try {
      if (!this.isInitialized || !this.config.enabled) {
        logger.debug('Liquidity integration not available for asset pledge');
        return;
      }

      const pledgeNotification = {
        id: uuidv4(),
        type: 'ASSET_PLEDGED',
        assetId: assetData.assetId,
        assetType: assetData.assetType,
        pledgedValue: assetData.pledgedValue,
        ownerWallet: assetData.ownerWallet,
        metadata: {
          description: assetData.description,
          location: assetData.location,
          appraisalDate: assetData.appraisalDate,
          documents: assetData.documents
        },
        pledgedAt: new Date().toISOString(),
        source: 'tokenization_platform'
      };

      // Send via Redis for real-time notification
      await this.redisClient.publish(
        this.channels.ASSET_PLEDGED, 
        JSON.stringify(pledgeNotification)
      );

      // Also send via HTTP for reliability
      try {
        await this.liquidityEngineClient.post('/api/v1/pledges/new', pledgeNotification);
      } catch (httpError) {
        logger.warn('HTTP notification failed, Redis notification sent', { 
          error: httpError.message 
        });
      }

      // Track pending asset
      this.pendingAssets.set(assetData.assetId, {
        ...pledgeNotification,
        status: 'VERIFICATION_PENDING'
      });

      this.stats.assetsSent++;
      this.stats.lastCommunication = new Date().toISOString();

      logger.info('Asset pledge notified to Liquidity Engine', {
        assetId: assetData.assetId,
        assetType: assetData.assetType,
        pledgedValue: assetData.pledgedValue
      });

      return pledgeNotification.id;

    } catch (error) {
      logger.error('Failed to notify asset pledge', {
        assetId: assetData.assetId,
        error: error.message
      });
      this.stats.errors++;
      throw error;
    }
  }

  async notifyTokenMinted(tokenData) {
    try {
      if (!this.isInitialized || !this.config.enabled) return;

      const mintNotification = {
        id: uuidv4(),
        type: 'TOKEN_MINTED',
        tokenId: tokenData.tokenId,
        assetId: tokenData.assetId,
        tokenSymbol: tokenData.tokenSymbol,
        issuerAddress: tokenData.issuerAddress,
        totalSupply: tokenData.totalSupply,
        xrplTxHash: tokenData.xrplTxHash,
        appraisedValue: tokenData.appraisedValue,
        mintedAt: new Date().toISOString(),
        source: 'tokenization_platform'
      };

      // Notify Liquidity Engine
      await this.redisClient.publish(
        this.channels.TOKEN_MINTED,
        JSON.stringify(mintNotification)
      );

      // Update pending asset status
      const pendingAsset = this.pendingAssets.get(tokenData.assetId);
      if (pendingAsset) {
        pendingAsset.status = 'TOKEN_MINTED';
        pendingAsset.tokenInfo = mintNotification;
      }

      logger.info('Token minting notified to Liquidity Engine', {
        tokenId: tokenData.tokenId,
        assetId: tokenData.assetId
      });

    } catch (error) {
      logger.error('Failed to notify token minting', { error: error.message });
      this.stats.errors++;
    }
  }

  async notifyTrustlineCreated(trustlineData) {
    try {
      if (!this.isInitialized || !this.config.enabled) return;

      const trustlineNotification = {
        id: uuidv4(),
        type: 'TRUSTLINE_CREATED',
        walletAddress: trustlineData.walletAddress,
        tokenId: trustlineData.tokenId,
        assetId: trustlineData.assetId,
        issuerAddress: trustlineData.issuerAddress,
        limitAmount: trustlineData.limitAmount,
        xrplTxHash: trustlineData.xrplTxHash,
        createdAt: new Date().toISOString(),
        source: 'tokenization_platform'
      };

      // Notify Liquidity Engine
      await this.redisClient.publish(
        this.channels.TRUSTLINE_CREATED,
        JSON.stringify(trustlineNotification)
      );

      // Update pending asset status
      const pendingAsset = this.pendingAssets.get(trustlineData.assetId);
      if (pendingAsset) {
        pendingAsset.status = 'READY_FOR_LIQUIDITY';
        pendingAsset.trustlineInfo = trustlineNotification;
      }

      logger.info('Trustline creation notified to Liquidity Engine', {
        tokenId: trustlineData.tokenId,
        walletAddress: trustlineData.walletAddress
      });

    } catch (error) {
      logger.error('Failed to notify trustline creation', { error: error.message });
      this.stats.errors++;
    }
  }

  handleVerificationResult(verificationData) {
    try {
      this.stats.verificationsReceived++;
      
      logger.info('Received verification result from Liquidity Engine', {
        verificationId: verificationData.verificationId,
        assetId: verificationData.assetId,
        approved: verificationData.result.approved
      });

      // Store verification result
      this.verificationResults.set(verificationData.assetId, verificationData);

      // Update pending asset
      const pendingAsset = this.pendingAssets.get(verificationData.assetId);
      if (pendingAsset) {
        pendingAsset.status = verificationData.result.approved ? 
          'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED';
        pendingAsset.verificationResult = verificationData;
      }

      // Emit event for the tokenization platform to handle
      this.emit('verificationComplete', verificationData);

    } catch (error) {
      logger.error('Failed to handle verification result', { error: error.message });
    }
  }

  handleLiquidityAvailable(liquidityData) {
    try {
      this.stats.liquidityNotifications++;

      logger.info('Received liquidity availability from Liquidity Engine', {
        tokenId: liquidityData.tokenId,
        liquidityAmount: liquidityData.liquidityAmount
      });

      // Store liquidity status
      this.liquidityStatus.set(liquidityData.tokenId, liquidityData);

      // Update pending asset
      const pendingAsset = this.pendingAssets.get(liquidityData.assetId);
      if (pendingAsset) {
        pendingAsset.status = 'LIQUIDITY_AVAILABLE';
        pendingAsset.liquidityInfo = liquidityData;
      }

      // Emit event for the tokenization platform
      this.emit('liquidityAvailable', liquidityData);

    } catch (error) {
      logger.error('Failed to handle liquidity availability', { error: error.message });
    }
  }

  handleCounterpartyMatched(matchData) {
    try {
      logger.info('Received counterparty match from Liquidity Engine', {
        tokenId: matchData.tokenId,
        counterparty: matchData.counterparty.name
      });

      // Store counterparty info
      const liquidityInfo = this.liquidityStatus.get(matchData.tokenId);
      if (liquidityInfo) {
        liquidityInfo.counterparty = matchData.counterparty;
        liquidityInfo.tradingDetails = matchData.tradingDetails;
      }

      // Emit event for the tokenization platform
      this.emit('counterpartyMatched', matchData);

    } catch (error) {
      logger.error('Failed to handle counterparty match', { error: error.message });
    }
  }

  async registerWithLiquidityEngine() {
    try {
      const registrationData = {
        platformId: 'ime-tokenization-platform',
        platformName: 'IME RWA Tokenization Platform',
        version: '1.0.0',
        capabilities: [
          'asset_pledging',
          'rwa_token_minting',
          'trustline_management',
          'wallet_creation',
          'asset_custody'
        ],
        endpoints: {
          verification_callback: `${process.env.PLATFORM_BASE_URL || 'http://localhost:3000'}/api/v1/verification/callback`,
          liquidity_callback: `${process.env.PLATFORM_BASE_URL || 'http://localhost:3000'}/api/v1/liquidity/callback`,
          counterparty_callback: `${process.env.PLATFORM_BASE_URL || 'http://localhost:3000'}/api/v1/counterparty/callback`
        },
        registeredAt: new Date().toISOString()
      };

      await this.liquidityEngineClient.post('/api/v1/tokenization/register', registrationData);
      
      logger.info('Successfully registered with Liquidity Engine');

    } catch (error) {
      logger.warn('Failed to register with Liquidity Engine', { error: error.message });
      // Continue even if registration fails
    }
  }

  // Helper methods
  getAssetStatus(assetId) {
    const pendingAsset = this.pendingAssets.get(assetId);
    const verification = this.verificationResults.get(assetId);
    
    return {
      status: pendingAsset?.status || 'UNKNOWN',
      verification: verification?.result,
      liquidity: this.liquidityStatus.get(pendingAsset?.tokenInfo?.tokenId)
    };
  }

  getIntegrationStats() {
    return {
      isInitialized: this.isInitialized,
      enabled: this.config.enabled,
      stats: this.stats,
      pendingAssets: this.pendingAssets.size,
      verificationResults: this.verificationResults.size,
      liquidityStatuses: this.liquidityStatus.size,
      liquidityEngineUrl: this.config.liquidityEngineUrl
    };
  }

  async testConnection() {
    try {
      const response = await this.liquidityEngineClient.get('/health');
      return {
        connected: true,
        status: response.data,
        responseTime: response.headers['x-response-time']
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message
      };
    }
  }

  async close() {
    try {
      if (this.redisClient) {
        await this.redisClient.quit();
      }
      if (this.redisSubscriber) {
        await this.redisSubscriber.quit();
      }
      
      logger.info('Liquidity Integration Service closed');
    } catch (error) {
      logger.error('Error closing Liquidity Integration Service', { error: error.message });
    }
  }
}

// Make it an EventEmitter for internal communication
const EventEmitter = require('events');
class LiquidityIntegration extends EventEmitter {
  constructor() {
    super();
    this.service = new LiquidityIntegrationService();
  }

  async initialize() {
    await this.service.initialize();
    
    // Forward events from service to platform
    this.service.emit = (event, data) => this.emit(event, data);
  }

  // Expose service methods
  async notifyAssetPledged(assetData) {
    return this.service.notifyAssetPledged(assetData);
  }

  async notifyTokenMinted(tokenData) {
    return this.service.notifyTokenMinted(tokenData);
  }

  async notifyTrustlineCreated(trustlineData) {
    return this.service.notifyTrustlineCreated(trustlineData);
  }

  getAssetStatus(assetId) {
    return this.service.getAssetStatus(assetId);
  }

  getIntegrationStats() {
    return this.service.getIntegrationStats();
  }

  async testConnection() {
    return this.service.testConnection();
  }

  async close() {
    return this.service.close();
  }
}

module.exports = LiquidityIntegration;