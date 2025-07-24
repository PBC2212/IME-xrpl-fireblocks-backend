/**
 * Asset Validation Middleware
 * Enhanced validation for real-world asset tokenization
 */

const { isValidXRPLAddress, isValidCurrencyCode } = require('../utils/xrplHelpers');

// Asset type definitions with validation rules
const ASSET_TYPES = {
  'real-estate': {
    name: 'Real Estate',
    minValue: 1000,
    maxValue: 100000000,
    requiredFields: ['location', 'property_type'],
    description: 'Residential, commercial, or industrial property'
  },
  'commodities': {
    name: 'Commodities',
    minValue: 100,
    maxValue: 50000000,
    requiredFields: ['commodity_type', 'grade'],
    description: 'Gold, silver, oil, agricultural products, etc.'
  },
  'art': {
    name: 'Art & Collectibles',
    minValue: 500,
    maxValue: 25000000,
    requiredFields: ['artist', 'year'],
    description: 'Paintings, sculptures, rare collectibles'
  },
  'equipment': {
    name: 'Equipment & Machinery',
    minValue: 1000,
    maxValue: 10000000,
    requiredFields: ['manufacturer', 'model'],
    description: 'Industrial equipment, vehicles, machinery'
  },
  'inventory': {
    name: 'Inventory',
    minValue: 100,
    maxValue: 5000000,
    requiredFields: ['product_type', 'quantity'],
    description: 'Business inventory and stock'
  },
  'intellectual-property': {
    name: 'Intellectual Property',
    minValue: 1000,
    maxValue: 50000000,
    requiredFields: ['ip_type', 'registration_number'],
    description: 'Patents, trademarks, copyrights'
  },
  'securities': {
    name: 'Securities',
    minValue: 1000,
    maxValue: 100000000,
    requiredFields: ['security_type', 'issuer'],
    description: 'Stocks, bonds, financial instruments'
  },
  'other': {
    name: 'Other Assets',
    minValue: 100,
    maxValue: 10000000,
    requiredFields: ['asset_category'],
    description: 'Other tokenizable assets'
  }
};

// Token symbol validation
const validateTokenSymbol = (symbol) => {
  if (!symbol || typeof symbol !== 'string') {
    return 'Token symbol is required';
  }
  
  if (symbol.length !== 3) {
    return 'Token symbol must be exactly 3 characters';
  }
  
  if (!/^[A-Z]{3}$/.test(symbol)) {
    return 'Token symbol must contain only uppercase letters';
  }
  
  // Reserved symbols
  const reserved = ['XRP', 'USD', 'EUR', 'GBP', 'JPY', 'CNY'];
  if (reserved.includes(symbol)) {
    return `Token symbol '${symbol}' is reserved`;
  }
  
  return null;
};

// Asset amount validation
const validateAssetAmount = (amount, assetType) => {
  if (!amount || typeof amount !== 'string') {
    return 'Asset amount is required';
  }
  
  const numericAmount = parseFloat(amount);
  
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return 'Asset amount must be a positive number';
  }
  
  // Check against asset type limits
  const assetConfig = ASSET_TYPES[assetType];
  if (assetConfig) {
    if (numericAmount < assetConfig.minValue) {
      return `Minimum value for ${assetConfig.name} is ${assetConfig.minValue}`;
    }
    
    if (numericAmount > assetConfig.maxValue) {
      return `Maximum value for ${assetConfig.name} is ${assetConfig.maxValue}`;
    }
  }
  
  // Check for reasonable decimal places (max 6)
  const decimalPlaces = (amount.split('.')[1] || '').length;
  if (decimalPlaces > 6) {
    return 'Asset amount cannot have more than 6 decimal places';
  }
  
  return null;
};

// Asset description validation
const validateAssetDescription = (description, assetType) => {
  if (!description) {
    return null; // Description is optional
  }
  
  if (typeof description !== 'string') {
    return 'Asset description must be a string';
  }
  
  if (description.length > 500) {
    return 'Asset description cannot exceed 500 characters';
  }
  
  // Check for potentially harmful content
  const suspiciousPatterns = [
    /javascript:/gi,
    /<script/gi,
    /on\w+\s*=/gi,
    /\bexec\b/gi,
    /\beval\b/gi
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(description)) {
      return 'Asset description contains invalid content';
    }
  }
  
  return null;
};

// Main asset validation middleware
const validateAssetTokenization = (req, res, next) => {
  const { userAddress, assetType, assetAmount, assetDescription, tokenSymbol } = req.body;
  const errors = [];
  
  // Validate user address
  if (!userAddress || !isValidXRPLAddress(userAddress)) {
    errors.push('Valid XRPL address is required');
  }
  
  // Validate asset type
  if (!assetType || !ASSET_TYPES[assetType]) {
    errors.push('Valid asset type is required');
  }
  
  // Validate asset amount
  const amountError = validateAssetAmount(assetAmount, assetType);
  if (amountError) {
    errors.push(amountError);
  }
  
  // Validate token symbol
  const symbolError = validateTokenSymbol(tokenSymbol || 'RWA');
  if (symbolError) {
    errors.push(symbolError);
  }
  
  // Validate asset description
  const descriptionError = validateAssetDescription(assetDescription, assetType);
  if (descriptionError) {
    errors.push(descriptionError);
  }
  
  // Check for duplicate tokenization (basic check)
  // In production, you'd check against a database
  const tokenizationKey = `${userAddress}-${assetType}-${assetAmount}`;
  req.tokenizationKey = tokenizationKey;
  
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Asset validation failed',
      data: {
        errors,
        assetTypes: Object.keys(ASSET_TYPES),
        timestamp: new Date().toISOString()
      }
    });
  }
  
  // Add validated data to request
  req.validatedAsset = {
    userAddress: userAddress.trim(),
    assetType,
    assetAmount: assetAmount.trim(),
    assetDescription: assetDescription?.trim(),
    tokenSymbol: (tokenSymbol || 'RWA').trim().toUpperCase(),
    assetConfig: ASSET_TYPES[assetType]
  };
  
  next();
};

// Tokenization rate limiting (prevent spam)
const tokenizationRateLimit = (req, res, next) => {
  // In production, implement proper rate limiting per user
  // This is a simple placeholder
  const userAddress = req.body.userAddress;
  
  if (!userAddress) {
    return next();
  }
  
  // Check if user has tokenized recently (placeholder)
  // In production: check Redis/database for recent tokenizations
  const lastTokenization = req.headers['x-last-tokenization'];
  
  if (lastTokenization) {
    const timeSinceLastTokenization = Date.now() - parseInt(lastTokenization);
    const minimumInterval = 60000; // 1 minute minimum between tokenizations
    
    if (timeSinceLastTokenization < minimumInterval) {
      return res.status(429).json({
        success: false,
        message: 'Tokenization rate limit exceeded',
        data: {
          retryAfter: Math.ceil((minimumInterval - timeSinceLastTokenization) / 1000),
          message: 'Please wait before tokenizing another asset',
          timestamp: new Date().toISOString()
        }
      });
    }
  }
  
  next();
};

// Asset metadata enrichment
const enrichAssetMetadata = (req, res, next) => {
  const { validatedAsset } = req;
  
  if (!validatedAsset) {
    return next();
  }
  
  // Add metadata based on asset type
  const enrichedMetadata = {
    tokenization_timestamp: new Date().toISOString(),
    asset_category: validatedAsset.assetConfig.name,
    platform: 'XRPL-Native-RWA',
    version: '1.0.0',
    network: process.env.XRPL_ENDPOINT?.includes('altnet') ? 'testnet' : 'mainnet'
  };
  
  // Add asset-specific metadata
  switch (validatedAsset.assetType) {
    case 'real-estate':
      enrichedMetadata.asset_class = 'real_estate';
      enrichedMetadata.fractional = true;
      break;
    case 'commodities':
      enrichedMetadata.asset_class = 'commodity';
      enrichedMetadata.physical_backing = true;
      break;
    case 'art':
      enrichedMetadata.asset_class = 'collectible';
      enrichedMetadata.unique = true;
      break;
    default:
      enrichedMetadata.asset_class = 'general';
  }
  
  req.enrichedMetadata = enrichedMetadata;
  next();
};

// Get asset type information
const getAssetTypes = (req, res) => {
  res.json({
    success: true,
    message: 'Asset types retrieved successfully',
    data: {
      assetTypes: Object.entries(ASSET_TYPES).map(([key, config]) => ({
        value: key,
        label: config.name,
        description: config.description,
        minValue: config.minValue,
        maxValue: config.maxValue,
        requiredFields: config.requiredFields
      })),
      totalTypes: Object.keys(ASSET_TYPES).length,
      timestamp: new Date().toISOString()
    }
  });
};

module.exports = {
  validateAssetTokenization,
  tokenizationRateLimit,
  enrichAssetMetadata,
  getAssetTypes,
  ASSET_TYPES
};