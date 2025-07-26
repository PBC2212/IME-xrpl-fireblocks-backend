/**
 * Trust Line Helper Functions
 * Utilities for XRPL trust line operations and validation
 */

const { isValidXRPLAddress, isValidCurrencyCode } = require('./xrplHelpers');

// Trust line validation rules
const TRUST_LINE_LIMITS = {
  MIN_LIMIT: 0,
  MAX_LIMIT: 1000000000000, // 1 trillion
  DEFAULT_LIMIT: 1000000,
  RESERVE_REQUIREMENT: 2000000 // 2 XRP in drops
};

// Common token configurations
const COMMON_TOKENS = {
  RWA: {
    currency: 'RWA',
    name: 'Real World Assets',
    defaultLimit: '1000000',
    description: 'Platform native token for real-world assets'
  },
  USD: {
    currency: 'USD',
    name: 'US Dollar Stablecoin',
    defaultLimit: '100000',
    description: 'USD-backed stablecoin'
  },
  EUR: {
    currency: 'EUR',
    name: 'Euro Stablecoin',
    defaultLimit: '100000',
    description: 'EUR-backed stablecoin'
  },
  GLD: {
    currency: 'GLD',
    name: 'Gold Token',
    defaultLimit: '10000',
    description: 'Gold-backed commodity token'
  },
  REE: {
    currency: 'REE',
    name: 'Real Estate Token',
    defaultLimit: '50000',
    description: 'Real estate-backed token'
  }
};

/**
 * Validate trust line parameters
 */
const validateTrustLineParams = (walletSeed, tokenSymbol, limit, issuer) => {
  const errors = [];

  // Validate wallet seed
  if (!walletSeed || typeof walletSeed !== 'string') {
    errors.push('Wallet seed is required');
  } else if (!/^s[a-zA-Z0-9]{25,34}$/.test(walletSeed)) {
    errors.push('Invalid wallet seed format');
  }

  // Validate token symbol
  if (!tokenSymbol || typeof tokenSymbol !== 'string') {
    errors.push('Token symbol is required');
  } else if (!isValidCurrencyCode(tokenSymbol)) {
    errors.push('Invalid token symbol format');
  }

  // Validate limit
  if (!limit || typeof limit !== 'string') {
    errors.push('Trust limit is required');
  } else {
    const numericLimit = parseFloat(limit);
    if (isNaN(numericLimit)) {
      errors.push('Trust limit must be a valid number');
    } else if (numericLimit < TRUST_LINE_LIMITS.MIN_LIMIT) {
      errors.push(`Trust limit cannot be negative`);
    } else if (numericLimit > TRUST_LINE_LIMITS.MAX_LIMIT) {
      errors.push(`Trust limit cannot exceed ${TRUST_LINE_LIMITS.MAX_LIMIT.toLocaleString()}`);
    }
  }

  // Validate issuer address
  if (!issuer || !isValidXRPLAddress(issuer)) {
    errors.push('Valid issuer address is required');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Get recommended trust line limit based on token type
 */
const getRecommendedLimit = (tokenSymbol, userProfile = {}) => {
  const token = COMMON_TOKENS[tokenSymbol.toUpperCase()];
  
  if (token) {
    return token.defaultLimit;
  }

  // Default limits based on token pattern
  if (tokenSymbol.endsWith('USD') || tokenSymbol.endsWith('EUR')) {
    return '100000'; // Stablecoins
  } else if (tokenSymbol.startsWith('G') || tokenSymbol.includes('GOLD')) {
    return '10000'; // Precious metals
  } else if (tokenSymbol.includes('RE') || tokenSymbol.includes('PROP')) {
    return '50000'; // Real estate
  }

  return TRUST_LINE_LIMITS.DEFAULT_LIMIT.toString();
};

/**
 * Calculate trust line costs
 */
const calculateTrustLineCosts = (existingTrustLines = 0) => {
  const reserveIncrement = TRUST_LINE_LIMITS.RESERVE_REQUIREMENT;
  const transactionFee = 12; // drops, typical XRPL fee
  
  return {
    reserveIncrement: reserveIncrement,
    reserveIncrementXRP: (reserveIncrement / 1000000).toFixed(6),
    transactionFee: transactionFee,
    transactionFeeXRP: (transactionFee / 1000000).toFixed(6),
    totalCostDrops: reserveIncrement + transactionFee,
    totalCostXRP: ((reserveIncrement + transactionFee) / 1000000).toFixed(6)
  };
};

/**
 * Analyze trust line health and recommendations
 */
const analyzeTrustLines = (trustLines = [], walletBalance = '0') => {
  const analysis = {
    totalTrustLines: trustLines.length,
    activeTrustLines: 0,
    unusedTrustLines: 0,
    totalValue: 0,
    recommendations: [],
    riskFactors: []
  };

  for (const trustLine of trustLines) {
    const balance = parseFloat(trustLine.balance) || 0;
    const limit = parseFloat(trustLine.limit) || 0;
    
    if (balance > 0) {
      analysis.activeTrustLines++;
      analysis.totalValue += balance;
    } else {
      analysis.unusedTrustLines++;
    }

    // Check for concerning trust lines
    if (limit > 1000000) {
      analysis.riskFactors.push({
        type: 'high_limit',
        currency: trustLine.currency,
        message: `Very high trust limit for ${trustLine.currency}: ${limit.toLocaleString()}`
      });
    }

    if (balance > limit * 0.9) {
      analysis.riskFactors.push({
        type: 'near_limit',
        currency: trustLine.currency,
        message: `${trustLine.currency} balance near trust limit`
      });
    }
  }

  // Generate recommendations
  if (analysis.unusedTrustLines > 5) {
    analysis.recommendations.push({
      type: 'cleanup',
      priority: 'medium',
      message: 'Consider removing unused trust lines to free up XRP reserve'
    });
  }

  if (analysis.totalTrustLines === 0) {
    analysis.recommendations.push({
      type: 'setup',
      priority: 'high',
      message: 'Create trust lines for tokens you want to receive'
    });
  }

  const walletBalanceNum = parseFloat(walletBalance) || 0;
  const reserveUsed = analysis.totalTrustLines * 2; // 2 XRP per trust line

  if (walletBalanceNum < reserveUsed + 10) {
    analysis.recommendations.push({
      type: 'funding',
      priority: 'high',
      message: 'Low XRP balance may prevent new trust line creation'
    });
  }

  return analysis;
};

/**
 * Format trust line for display
 */
const formatTrustLineForDisplay = (trustLine) => {
  const balance = parseFloat(trustLine.balance) || 0;
  const limit = parseFloat(trustLine.limit) || 0;
  
  return {
    currency: trustLine.currency,
    issuer: trustLine.issuer,
    balance: balance.toLocaleString(),
    limit: limit.toLocaleString(),
    utilization: limit > 0 ? ((balance / limit) * 100).toFixed(2) + '%' : '0%',
    status: balance > 0 ? 'active' : 'inactive',
    formattedIssuer: `${trustLine.issuer.slice(0, 8)}...${trustLine.issuer.slice(-8)}`
  };
};

/**
 * Get trust line transaction memo
 */
const createTrustLineMemo = (operation, data = {}) => {
  const memoData = {
    operation,
    timestamp: new Date().toISOString(),
    platform: 'XRPL-Native-RWA',
    version: '1.0.0',
    ...data
  };

  return {
    Memo: {
      MemoType: Buffer.from('TrustLineOperation', 'utf8').toString('hex').toUpperCase(),
      MemoData: Buffer.from(JSON.stringify(memoData), 'utf8').toString('hex').toUpperCase()
    }
  };
};

/**
 * Validate trust line modification
 */
const validateTrustLineModification = (currentLimit, newLimit, currentBalance) => {
  const errors = [];
  const warnings = [];

  const currentLimitNum = parseFloat(currentLimit) || 0;
  const newLimitNum = parseFloat(newLimit) || 0;
  const balanceNum = parseFloat(currentBalance) || 0;

  // Check if new limit is below current balance
  if (newLimitNum < balanceNum && newLimitNum > 0) {
    errors.push('New trust limit cannot be below current balance');
  }

  // Warn about significant limit changes
  if (newLimitNum > currentLimitNum * 10) {
    warnings.push('Significant trust limit increase - ensure you trust the issuer');
  }

  // Warn about setting limit to zero (removes trust line)
  if (newLimitNum === 0 && balanceNum > 0) {
    errors.push('Cannot set trust limit to zero while holding tokens');
  } else if (newLimitNum === 0 && balanceNum === 0) {
    warnings.push('Setting limit to zero will remove the trust line');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
};

module.exports = {
  TRUST_LINE_LIMITS,
  COMMON_TOKENS,
  validateTrustLineParams,
  getRecommendedLimit,
  calculateTrustLineCosts,
  analyzeTrustLines,
  formatTrustLineForDisplay,
  createTrustLineMemo,
  validateTrustLineModification
};