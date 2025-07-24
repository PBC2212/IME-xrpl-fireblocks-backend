/**
 * XRPL Configuration Management
 * Centralized configuration for XRPL network settings and constants
 */

const { getNetworkInfo } = require('../utils/xrplHelpers');

// XRPL Network Endpoints
const XRPL_NETWORKS = {
  MAINNET: {
    primary: 'wss://xrplcluster.com',
    fallback: ['wss://s1.ripple.com', 'wss://s2.ripple.com'],
    name: 'Mainnet',
    type: 'production',
    explorer: 'https://livenet.xrpl.org'
  },
  TESTNET: {
    primary: 'wss://s.altnet.rippletest.net:51233',
    fallback: ['wss://s.altnet.rippletest.net'],
    name: 'Testnet', 
    type: 'development',
    explorer: 'https://testnet.xrpl.org'
  },
  DEVNET: {
    primary: 'wss://s.devnet.rippletest.net:51233',
    fallback: ['wss://s.devnet.rippletest.net'],
    name: 'Devnet',
    type: 'development', 
    explorer: 'https://devnet.xrpl.org'
  }
};

// XRPL Constants
const XRPL_CONSTANTS = {
  // Reserve requirements (in drops)
  RESERVE_BASE: '10000000', // 10 XRP base reserve
  RESERVE_INCREMENT: '2000000', // 2 XRP per owned object
  
  // Transaction limits
  MIN_XRP_AMOUNT: '1000000', // 1 XRP minimum
  MAX_TRANSACTION_FEE: '2000000', // 2 XRP max fee
  
  // Network settings
  LEDGER_CLOSE_TIME: 4, // ~4 seconds average
  MAX_TRANSACTION_TIMEOUT: 300, // 5 minutes
  
  // Token settings
  DEFAULT_TOKEN_PRECISION: 15,
  MAX_TOKEN_VALUE: '9999999999999999e80',
  MIN_TOKEN_VALUE: '1e-15',
  
  // Address formats
  ADDRESS_PREFIX: 'r',
  SEED_PREFIX: 's',
  ADDRESS_LENGTH_RANGE: [25, 34],
  SEED_LENGTH_RANGE: [25, 34]
};

// Default asset configuration
const DEFAULT_ASSETS = {
  XRP: {
    currency: 'XRP',
    symbol: 'XRP',
    name: 'XRP',
    decimals: 6,
    native: true
  },
  RWA: {
    currency: 'RWA',
    symbol: 'RWA',
    name: 'Real World Asset Token',
    decimals: 6,
    native: false,
    issuer: process.env.DEFAULT_ASSET_ISSUER
  }
};

// Transaction types and their configurations
const TRANSACTION_TYPES = {
  PAYMENT: {
    type: 'Payment',
    description: 'Send XRP or tokens',
    requiredFields: ['Account', 'Destination', 'Amount'],
    optionalFields: ['DestinationTag', 'InvoiceID', 'Paths', 'SendMax']
  },
  TRUST_SET: {
    type: 'TrustSet',
    description: 'Create or modify trust line',
    requiredFields: ['Account', 'LimitAmount'],
    optionalFields: ['QualityIn', 'QualityOut']
  },
  OFFER_CREATE: {
    type: 'OfferCreate',
    description: 'Create DEX order',
    requiredFields: ['Account', 'TakerGets', 'TakerPays'],
    optionalFields: ['Expiration', 'OfferSequence']
  },
  OFFER_CANCEL: {
    type: 'OfferCancel',
    description: 'Cancel DEX order',
    requiredFields: ['Account', 'OfferSequence'],
    optionalFields: []
  },
  ACCOUNT_SET: {
    type: 'AccountSet',
    description: 'Modify account settings',
    requiredFields: ['Account'],
    optionalFields: ['ClearFlag', 'SetFlag', 'Domain', 'EmailHash', 'MessageKey', 'TransferRate', 'TickSize']
  }
};

// Get current XRPL configuration
const getXRPLConfig = () => {
  const endpoint = process.env.XRPL_ENDPOINT || XRPL_NETWORKS.TESTNET.primary;
  const networkInfo = getNetworkInfo(endpoint);
  
  return {
    endpoint,
    network: networkInfo,
    issuerAddress: process.env.XRPL_ISSUER_ADDRESS,
    issuerSecret: process.env.XRPL_ISSUER_SECRET,
    defaultCurrency: process.env.DEFAULT_ASSET_CURRENCY || 'RWA',
    environment: process.env.NODE_ENV || 'development',
    
    // Network timeouts
    connectionTimeout: 30000, // 30 seconds
    responseTimeout: 10000,   // 10 seconds
    retryAttempts: 3,
    retryDelay: 2000,        // 2 seconds
    
    // Transaction settings
    maxFeeDrops: process.env.MAX_FEE_DROPS || '2000', // 0.002 XRP
    maxLedgerVersionOffset: 20 // Allow 20 ledger versions for expiration
  };
};

// Validate XRPL configuration
const validateConfig = () => {
  const config = getXRPLConfig();
  const errors = [];
  
  // Check required environment variables
  if (!config.endpoint) {
    errors.push('XRPL_ENDPOINT is required');
  }
  
  if (!config.issuerAddress) {
    errors.push('XRPL_ISSUER_ADDRESS is required for token operations');
  }
  
  if (!config.issuerSecret && config.environment === 'production') {
    errors.push('XRPL_ISSUER_SECRET is required in production');
  }
  
  // Validate address format
  if (config.issuerAddress && !/^r[a-zA-Z0-9]{25,34}$/.test(config.issuerAddress)) {
    errors.push('XRPL_ISSUER_ADDRESS has invalid format');
  }
  
  // Validate seed format
  if (config.issuerSecret && !/^s[a-zA-Z0-9]{25,34}$/.test(config.issuerSecret)) {
    errors.push('XRPL_ISSUER_SECRET has invalid format');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    config
  };
};

// Get network-specific settings
const getNetworkSettings = (endpoint) => {
  // Determine network type from endpoint
  for (const [networkName, networkConfig] of Object.entries(XRPL_NETWORKS)) {
    if (networkConfig.primary === endpoint || networkConfig.fallback.includes(endpoint)) {
      return {
        ...networkConfig,
        networkName: networkName.toLowerCase(),
        isTestnet: networkConfig.type === 'development',
        isMainnet: networkConfig.type === 'production'
      };
    }
  }
  
  // Default to testnet for unknown endpoints
  return {
    ...XRPL_NETWORKS.TESTNET,
    networkName: 'unknown',
    isTestnet: true,
    isMainnet: false
  };
};

// Get asset configuration
const getAssetConfig = (currency = 'RWA') => {
  const config = getXRPLConfig();
  
  if (currency === 'XRP') {
    return DEFAULT_ASSETS.XRP;
  }
  
  return {
    ...DEFAULT_ASSETS.RWA,
    currency,
    issuer: config.issuerAddress
  };
};

// Get memo configuration for different operations
const getMemoConfig = (operationType) => {
  const configs = {
    PLEDGE: {
      type: 'AssetPledge',
      maxDataSize: 1024, // 1KB max memo data
      requiredFields: ['assetType', 'assetAmount', 'timestamp'],
      optionalFields: ['assetDescription', 'metadata']
    },
    REDEEM: {
      type: 'TokenRedemption',
      maxDataSize: 512,
      requiredFields: ['tokenAmount', 'tokenSymbol', 'timestamp'],
      optionalFields: ['reason']
    },
    SWAP: {
      type: 'DEXSwap',
      maxDataSize: 256,
      requiredFields: ['fromAsset', 'toAsset', 'timestamp'],
      optionalFields: ['exchangeRate']
    }
  };
  
  return configs[operationType] || {
    type: 'GenericOperation',
    maxDataSize: 256,
    requiredFields: ['timestamp'],
    optionalFields: []
  };
};

// Export configuration
module.exports = {
  XRPL_NETWORKS,
  XRPL_CONSTANTS,
  DEFAULT_ASSETS,
  TRANSACTION_TYPES,
  getXRPLConfig,
  validateConfig,
  getNetworkSettings,
  getAssetConfig,
  getMemoConfig
};