const { xrpToDrops, dropsToXrp } = require('xrpl');

/**
 * XRPL Utility Functions
 * Helper functions for XRPL operations and data formatting
 */

// Address validation
const isValidXRPLAddress = (address) => {
  if (!address || typeof address !== 'string') return false;
  return /^r[a-zA-Z0-9]{25,34}$/.test(address);
};

// Seed validation
const isValidXRPLSeed = (seed) => {
  if (!seed || typeof seed !== 'string') return false;
  return /^s[a-zA-Z0-9]{25,34}$/.test(seed);
};

// Currency code validation
const isValidCurrencyCode = (currency) => {
  if (!currency || typeof currency !== 'string') return false;
  // Standard currency codes are 3 characters or 40-character hex
  return /^[A-Z]{3}$/.test(currency) || /^[A-F0-9]{40}$/.test(currency);
};

// XRP conversion utilities
const formatXRP = (drops) => {
  try {
    if (!drops) return '0';
    return dropsToXrp(drops.toString());
  } catch (error) {
    console.error('Error formatting XRP:', error);
    return '0';
  }
};

const parseXRP = (xrp) => {
  try {
    if (!xrp) return '0';
    return xrpToDrops(xrp.toString());
  } catch (error) {
    console.error('Error parsing XRP:', error);
    return '0';
  }
};

// Token amount formatting
const formatTokenAmount = (amount, decimals = 6) => {
  try {
    if (!amount) return '0';
    const num = parseFloat(amount.toString());
    return num.toFixed(decimals);
  } catch (error) {
    console.error('Error formatting token amount:', error);
    return '0';
  }
};

// Transaction memo utilities
const createMemo = (type, data) => {
  try {
    return {
      Memo: {
        MemoType: Buffer.from(type, 'utf8').toString('hex').toUpperCase(),
        MemoData: Buffer.from(JSON.stringify(data), 'utf8').toString('hex').toUpperCase()
      }
    };
  } catch (error) {
    console.error('Error creating memo:', error);
    return null;
  }
};

const parseMemo = (memo) => {
  try {
    if (!memo || !memo.MemoType || !memo.MemoData) return null;
    
    const type = Buffer.from(memo.MemoType, 'hex').toString('utf8');
    const data = JSON.parse(Buffer.from(memo.MemoData, 'hex').toString('utf8'));
    
    return { type, data };
  } catch (error) {
    console.error('Error parsing memo:', error);
    return null;
  }
};

// Asset parsing utilities
const parseAssetAmount = (amount) => {
  try {
    if (typeof amount === 'string') {
      // XRP amount in drops
      return {
        currency: 'XRP',
        value: formatXRP(amount),
        drops: amount
      };
    } else if (typeof amount === 'object' && amount.currency) {
      // Token amount
      return {
        currency: amount.currency,
        issuer: amount.issuer,
        value: amount.value,
        drops: null
      };
    }
    return null;
  } catch (error) {
    console.error('Error parsing asset amount:', error);
    return null;
  }
};

// Transaction type helpers
const getTransactionTypeDescription = (txType) => {
  const descriptions = {
    'Payment': 'Payment or token transfer',
    'TrustSet': 'Trust line creation or modification',
    'OfferCreate': 'DEX order creation',
    'OfferCancel': 'DEX order cancellation',
    'AccountSet': 'Account settings modification',
    'SetRegularKey': 'Regular key assignment',
    'SignerListSet': 'Multi-signing setup',
    'EscrowCreate': 'Escrow creation',
    'EscrowFinish': 'Escrow completion',
    'EscrowCancel': 'Escrow cancellation',
    'PaymentChannelCreate': 'Payment channel creation',
    'PaymentChannelFund': 'Payment channel funding',
    'PaymentChannelClaim': 'Payment channel claim'
  };
  
  return descriptions[txType] || `Unknown transaction type: ${txType}`;
};

// Network utilities
const getNetworkInfo = (endpoint) => {
  const networks = {
    'wss://xrplcluster.com': { name: 'Mainnet', type: 'production' },
    'wss://s1.ripple.com': { name: 'Mainnet', type: 'production' },
    'wss://s2.ripple.com': { name: 'Mainnet', type: 'production' },
    'wss://s.altnet.rippletest.net:51233': { name: 'Testnet', type: 'development' },
    'wss://s.devnet.rippletest.net:51233': { name: 'Devnet', type: 'development' }
  };
  
  return networks[endpoint] || { name: 'Unknown', type: 'unknown' };
};

// Error handling utilities
const formatXRPLError = (error) => {
  // Common XRPL error codes and their meanings
  const errorCodes = {
    'tecUNFUNDED_PAYMENT': 'Insufficient funds for payment',
    'tecPATH_PARTIAL': 'Payment path could not deliver full amount',
    'tecDST_TAG_NEEDED': 'Destination tag required',
    'tecNO_DST_INSUF_XRP': 'Destination account does not exist',
    'tecNO_LINE_INSUF_RESERVE': 'Insufficient reserve for trust line',
    'tecNO_LINE_REDUNDANT': 'Trust line already exists',
    'tefPAST_SEQ': 'Transaction sequence number too low',
    'tefMAX_LEDGER': 'Transaction expired',
    'terNO_ACCOUNT': 'Account not found',
    'temINVALID': 'Invalid transaction',
    'temREDUNDANT': 'Redundant transaction'
  };
  
  if (error.data && error.data.error_code) {
    const code = error.data.error_code;
    const message = errorCodes[code] || error.data.error_message || 'Unknown XRPL error';
    return `${code}: ${message}`;
  }
  
  return error.message || 'Unknown error occurred';
};

// Reserve calculation utilities
const calculateReserve = (ownerCount, reserveBase = '10000000', reserveIncrement = '2000000') => {
  try {
    const base = parseInt(reserveBase);
    const increment = parseInt(reserveIncrement);
    const count = parseInt(ownerCount) || 0;
    
    const totalReserveDrops = base + (count * increment);
    return formatXRP(totalReserveDrops.toString());
  } catch (error) {
    console.error('Error calculating reserve:', error);
    return '10'; // Default 10 XRP reserve
  }
};

// Validation utilities
const validateTransaction = (tx) => {
  const errors = [];
  
  if (!tx.TransactionType) {
    errors.push('Transaction type is required');
  }
  
  if (!tx.Account || !isValidXRPLAddress(tx.Account)) {
    errors.push('Valid account address is required');
  }
  
  if (tx.Destination && !isValidXRPLAddress(tx.Destination)) {
    errors.push('Invalid destination address');
  }
  
  if (tx.Amount) {
    if (typeof tx.Amount === 'string') {
      // XRP amount
      try {
        const drops = parseInt(tx.Amount);
        if (drops < 0) errors.push('Amount must be positive');
      } catch (e) {
        errors.push('Invalid XRP amount');
      }
    } else if (typeof tx.Amount === 'object') {
      // Token amount
      if (!tx.Amount.currency || !isValidCurrencyCode(tx.Amount.currency)) {
        errors.push('Invalid currency code');
      }
      if (!tx.Amount.issuer || !isValidXRPLAddress(tx.Amount.issuer)) {
        errors.push('Invalid token issuer');
      }
      if (!tx.Amount.value || parseFloat(tx.Amount.value) <= 0) {
        errors.push('Token amount must be positive');
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Time utilities
const xrplTimeToDate = (xrplTime) => {
  // XRPL time is seconds since January 1, 2000 (00:00 UTC)
  const xrplEpoch = 946684800; // Unix timestamp for Jan 1, 2000
  return new Date((xrplTime + xrplEpoch) * 1000);
};

const dateToXrplTime = (date) => {
  const xrplEpoch = 946684800;
  return Math.floor(date.getTime() / 1000) - xrplEpoch;
};

// Export all utilities
module.exports = {
  // Validation
  isValidXRPLAddress,
  isValidXRPLSeed,
  isValidCurrencyCode,
  validateTransaction,
  
  // Formatting
  formatXRP,
  parseXRP,
  formatTokenAmount,
  parseAssetAmount,
  
  // Memos
  createMemo,
  parseMemo,
  
  // Utilities
  getTransactionTypeDescription,
  getNetworkInfo,
  formatXRPLError,
  calculateReserve,
  
  // Time
  xrplTimeToDate,
  dateToXrplTime
};