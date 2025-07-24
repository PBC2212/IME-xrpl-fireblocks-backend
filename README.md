# 🚀 IME XRPL Native Asset Platform

A production-ready **pure XRPL** Real-World Asset (RWA) tokenization platform with native DEX integration. No complex third-party dependencies - just the power of XRPL blockchain.

## 🌟 Overview

This platform enables users to pledge real-world assets and receive tokenized representations directly on the XRPL ledger, with built-in DEX trading capabilities. 

### 🎯 Key Features

- **🏗️ Native XRPL Wallets** - Users control their own keys
- **💎 Direct RWA Tokenization** - Mint tokens directly on XRPL
- **💱 Built-in DEX Trading** - Native XRPL order books and atomic swaps
- **⚡ Ultra-Low Fees** - ~$0.0002 per transaction
- **🚀 Fast Finality** - 3-5 second transaction confirmation
- **🌐 Lovable.ai Ready** - Clean REST APIs for frontend integration
- **🔒 True Decentralization** - No custodial wallet dependencies

## 🏗️ Architecture

```
Real Assets → XRPL Native Platform → XRPL Ledger → Native DEX → Users
                     ↓
              Direct Token Issuance → Instant Trading → User Wallets
```

### 🔧 Technology Stack

- **Backend**: Node.js + Express.js
- **Blockchain**: XRPL (XRP Ledger) - Pure integration
- **Frontend**: Lovable.ai (No-code platform)
- **Wallets**: XUMM, Crossmark, or native XRPL wallets
- **Trading**: Native XRPL DEX with order books

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- XRPL testnet account for issuing tokens

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd IME-xrpl-native-platform
npm install
```

### 2. Environment Setup

Create `.env` file in the root directory:

```bash
# XRPL Configuration
XRPL_ENDPOINT=wss://s.altnet.rippletest.net
XRPL_ISSUER_ADDRESS=your-issuer-address
XRPL_ISSUER_SECRET=your-issuer-secret

# Server Configuration
PORT=5000
NODE_ENV=development

# Asset Configuration
DEFAULT_ASSET_CURRENCY=RWA
DEFAULT_ASSET_ISSUER=your-issuer-address

# Frontend Configuration (optional)
FRONTEND_URL=http://localhost:8080
```

### 3. Start the Server

```bash
npm start
```

Server will start on `http://localhost:5000`

### 4. Verify Installation

```bash
# Health check
curl http://localhost:5000/api/health

# API documentation
curl http://localhost:5000/api/docs

# Platform statistics
curl http://localhost:5000/api/native/stats
```

## 📡 API Documentation

### 🏥 Health & Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Service health and XRPL connection status |
| `/api/docs` | GET | Complete API documentation |
| `/api/native/stats` | GET | Platform statistics and network info |

### 🏦 Wallet Management

| Endpoint | Method | Description | Body |
|----------|--------|-------------|------|
| `/api/native/create-wallet` | POST | Create new XRPL wallet | `{userId, walletName}` |
| `/api/native/wallet/:address` | GET | Get wallet info & balances | - |
| `/api/native/transactions/:address` | GET | Transaction history | - |
| `/api/native/validate/:address` | GET | Validate XRPL address | - |

### 🤝 Trust Lines

| Endpoint | Method | Description | Body |
|----------|--------|-------------|------|
| `/api/native/create-trustline` | POST | Create trust line for RWA tokens | `{walletSeed, tokenSymbol?, limit?}` |

### 💎 Asset Tokenization

| Endpoint | Method | Description | Body |
|----------|--------|-------------|------|
| `/api/native/pledge` | POST | Pledge asset → mint tokens | `{userAddress, assetType, assetAmount, assetDescription?, tokenSymbol?}` |
| `/api/native/redeem` | POST | Burn tokens → release assets | `{walletSeed, tokenAmount, tokenSymbol?}` |

### 💱 DEX Trading

| Endpoint | Method | Description | Body |
|----------|--------|-------------|------|
| `/api/native/swap` | POST | Create DEX swap offer | `{walletSeed, fromAsset, toAsset, amount, exchangeRate?}` |
| `/api/native/orderbook/:base/:counter` | GET | Get order book for trading pair | - |

## 💼 Core Workflows

### 1. 🏗️ Create XRPL Wallet

```javascript
// POST /api/native/create-wallet
{
  "userId": "user123",
  "walletName": "John Doe Wallet"
}

// Response
{
  "success": true,
  "message": "XRPL wallet created successfully",
  "data": {
    "wallet": {
      "address": "rXXXXXXXXXXXXXXXXX",
      "seed": "sXXXXXXXXXXXXXXXXX", // Store securely!
      "balance": "1000",
      "network": "testnet"
    }
  }
}
```

### 2. 🤝 Create Trust Line

```javascript
// POST /api/native/create-trustline
{
  "walletSeed": "sXXXXXXXXXXXXXXXXX",
  "tokenSymbol": "RWA",
  "limit": "1000000"
}

// Response
{
  "success": true,
  "message": "Trust line created successfully",
  "data": {
    "trustLine": {
      "txHash": "ABCD1234...",
      "currency": "RWA",
      "issuer": "rISSUERXXXXXXXXXXX"
    }
  }
}
```

### 3. 💎 Pledge Asset (Mint Tokens)

```javascript
// POST /api/native/pledge
{
  "userAddress": "rXXXXXXXXXXXXXXXXX",
  "assetType": "Real Estate",
  "assetAmount": "100000",
  "assetDescription": "Downtown office building - 1000 sqft",
  "tokenSymbol": "RWA"
}

// Response
{
  "success": true,
  "message": "Asset pledged and RWA tokens minted successfully",
  "data": {
    "pledge": {
      "tokensMinted": "100000",
      "txHash": "ABCD1234...",
      "recipientAddress": "rXXXXXXXXXXXXXXXXX"
    }
  }
}
```

### 4. 💱 Create DEX Swap

```javascript
// POST /api/native/swap
{
  "walletSeed": "sXXXXXXXXXXXXXXXXX",
  "fromAsset": "XRP",
  "toAsset": "RWA", 
  "amount": "1000",
  "exchangeRate": "0.5"
}

// Response
{
  "success": true,
  "message": "DEX swap offer created successfully",
  "data": {
    "swap": {
      "offering": "1000 XRP",
      "requesting": "500 RWA",
      "txHash": "IJKL9012..."
    }
  }
}
```

## 🔗 Lovable.ai Frontend Integration

### API Response Format

All endpoints return consistent JSON format:

```javascript
{
  "success": boolean,           // Operation success status
  "message": "string",          // Human-readable message
  "data": {                     // Main response data
    // Endpoint-specific data
  },
  "timestamp": "ISO-string"     // Response timestamp
}
```

### Frontend Connection Setup

1. **API Base URL**: `http://localhost:5000/api` (development)
2. **CORS**: Pre-configured for frontend integration
3. **Content-Type**: `application/json`
4. **Wallet Integration**: Users manage seeds via XUMM/Crossmark or your interface

### Sample Frontend Integration

```javascript
// Lovable.ai API Integration
const API_BASE = 'http://localhost:5000/api';

// Create wallet function
async function createWallet(userId, walletName) {
  const response = await fetch(`${API_BASE}/native/create-wallet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      userId: userId,
      walletName: walletName
    })
  });
  
  const result = await response.json();
  
  if (result.success) {
    // ⚠️ IMPORTANT: Store seed securely in production!
    console.log('Wallet created:', result.data.wallet);
    return result.data;
  } else {
    throw new Error(result.message);
  }
}

// Pledge asset function
async function pledgeAsset(userAddress, assetType, assetAmount, description) {
  const response = await fetch(`${API_BASE}/native/pledge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      userAddress,
      assetType,
      assetAmount,
      assetDescription: description
    })
  });
  
  const result = await response.json();
  
  if (result.success) {
    return result.data;
  } else {
    throw new Error(result.message);
  }
}
```

## 📁 Project Structure

```
IME-xrpl-native-platform/
├── 📁 controllers/              # Request handlers
│   └── nativeAssetController.js # XRPL native operations
├── 📁 services/                # Business logic
│   └── xrplNativeService.js    # Pure XRPL blockchain operations
├── 📄 index.js                 # Main server file
├── 📄 package.json             # Dependencies (XRPL only)
├── 📄 .env                     # Environment variables
├── 📄 .gitignore              # Git ignore rules
└── 📄 README.md               # This documentation
```

## 🛡️ Security Features

- **🔒 Environment Variables**: Sensitive data protected in `.env`
- **🔐 User-Controlled Keys**: Users manage their own wallet seeds
- **🛡️ API Security**: Input validation and error handling
- **📝 Transaction Transparency**: All operations recorded on XRPL
- **🚫 Git Protection**: Secrets excluded from version control

## 🌍 Environment Configuration

### Development (Testnet)
- XRPL Testnet
- Auto-funded test accounts
- Enhanced logging
- Local development

### Production (Mainnet)
- XRPL Mainnet
- Production logging
- Rate limiting
- Real asset backing

## ⚡ Performance & Costs

### Transaction Costs
- **XRPL Transaction Fee**: ~$0.0002 per transaction
- **No Monthly Fees**: No custodial wallet costs
- **No Gas Fees**: Fixed low-cost transactions

### Speed
- **Transaction Finality**: 3-5 seconds
- **Block Time**: ~3-5 seconds
- **Network Throughput**: 1,500+ TPS

## 🔧 Troubleshooting

### Common Issues

1. **XRPL Connection Failed**
   ```bash
   # Check XRPL endpoint in .env
   curl http://localhost:5000/api/health
   ```

2. **Wallet Creation Issues**
   ```bash
   # Check issuer account has sufficient XRP
   # Verify XRPL_ISSUER_SECRET is valid
   ```

3. **Trust Line Failures**
   ```bash
   # Ensure user wallet has sufficient XRP reserve
   # Verify token issuer address is correct
   ```

### Debug Mode

Set `NODE_ENV=development` for detailed logging:

```bash
NODE_ENV=development npm start
```

## 📈 Production Deployment

### Pre-deployment Checklist

- [ ] Update `.env` with mainnet XRPL endpoint
- [ ] Configure production issuer account  
- [ ] Set up monitoring and logging
- [ ] Test all API endpoints
- [ ] Verify Lovable frontend integration
- [ ] Set up proper seed storage for production

### Environment Variables for Production

```bash
# Production XRPL
XRPL_ENDPOINT=wss://xrplcluster.com
NODE_ENV=production

# Security
FRONTEND_URL=https://your-lovable-app.lovable.dev

# Production issuer (with sufficient XRP reserve)
XRPL_ISSUER_ADDRESS=rPRODUCTIONXXXXXXXXX
XRPL_ISSUER_SECRET=sPRODUCTIONXXXXXXXXX
```

## 🆚 XRPL Native vs Fireblocks Comparison

| Feature | XRPL Native | Fireblocks |
|---------|-------------|------------|
| **Setup Complexity** | ✅ Simple | ❌ Complex |
| **Monthly Costs** | ✅ $0 | ❌ $1000s+ |
| **Transaction Fees** | ✅ ~$0.0002 | ❌ Higher + Fireblocks fees |
| **Decentralization** | ✅ True DeFi | ❌ Custodial |
| **DEX Integration** | ✅ Native | ❌ External required |
| **User Control** | ✅ Own keys | ❌ Fireblocks custody |
| **Enterprise Features** | ⚠️ Manual setup | ✅ Built-in |

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

## 📄 License

This project is proprietary. All rights reserved.

## 📞 Support

For technical support or questions:
- Create an issue in this repository
- Contact the development team
- Check API documentation at `/api/docs`

---

**🚀 Ready to tokenize real-world assets with pure XRPL power!**

Built with ❤️ for true decentralized asset tokenization.