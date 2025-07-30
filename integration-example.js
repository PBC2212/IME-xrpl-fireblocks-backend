/**
 * Integration Example - How to Add Liquidity Integration to Your Main App
 * This shows exactly how to modify your existing Project 1 application
 * Copyright (c) 2025 IME Capital Trust LLC
 */

'use strict';

// Add this to your main index.js or app.js file

const express = require('express');
const liquidityIntegrationManager = require('./utils/initializeLiquidityIntegration');

const app = express();

// Your existing middleware setup...
app.use(express.json());
// ... other middleware

async function startServer() {
  try {
    // 1. Initialize liquidity integration AFTER your app setup but BEFORE starting server
    const liquidityIntegration = await liquidityIntegrationManager.initialize(app);
    
    if (liquidityIntegration.success) {
      console.log('✅ Liquidity Integration with Project 2: CONNECTED');
      
      // 2. Setup event handlers for integration events
      liquidityIntegrationManager.onVerificationComplete((verificationData) => {
        console.log('📋 Asset verification completed:', {
          assetId: verificationData.assetId,
          approved: verificationData.result.approved,
          consensusValue: verificationData.result.consensusValue
        });
        
        // YOUR CODE: Handle verification result
        // If approved, proceed with token minting
        if (verificationData.result.approved) {
          // Call your existing token minting function
          // await mintRWAToken(verificationData);
        }
      });

      liquidityIntegrationManager.onLiquidityAvailable((liquidityData) => {
        console.log('💰 Liquidity available for token:', {
          tokenId: liquidityData.tokenId,
          liquidityAmount: liquidityData.liquidityAmount
        });
        
        // YOUR CODE: Notify user that liquidity is ready
        // await notifyUserLiquidityReady(liquidityData);
      });

      liquidityIntegrationManager.onCounterpartyMatched((matchData) => {
        console.log('🤝 Counterparty matched:', {
          tokenId: matchData.tokenId,
          counterparty: matchData.counterparty.name
        });
      });

    } else {
      console.log('⚠️ Liquidity Integration: STANDALONE MODE');
      console.log('   Project 1 will work normally, but without Project 2 integration');
    }

    // Your existing server startup...
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`🚀 IME Tokenization Platform running on port ${port}`);
      
      if (liquidityIntegration.success) {
        console.log('🔗 Integrated with Liquidity Engine on Project 2');
        console.log('📡 Integration endpoints:');
        console.log('   - Verification: /api/v1/liquidity/verification/callback');
        console.log('   - Liquidity: /api/v1/liquidity/liquidity/callback');
        console.log('   - Status: /api/v1/liquidity/integration/test');
      }
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// =================================================================
// INTEGRATION POINTS: Add these calls to your existing workflows
// =================================================================

/**
 * INTEGRATION POINT 1: When user pledges an asset
 * Add this to your existing asset pledging workflow
 */
async function handleAssetPledge(userWallet, assetData) {
  try {
    // Your existing asset pledging logic...
    console.log('Processing asset pledge...');
    
    // NEW: Notify Project 2 about the pledge
    if (liquidityIntegrationManager.isConnected()) {
      const pledgeId = await liquidityIntegrationManager.notifyAssetPledged({
        assetId: assetData.id,
        assetType: assetData.type,
        pledgedValue: assetData.value,
        ownerWallet: userWallet,
        description: assetData.description,
        location: assetData.location,
        appraisalDate: assetData.appraisalDate,
        documents: assetData.documents
      });
      
      console.log(`📤 Asset pledge sent to Liquidity Engine (ID: ${pledgeId})`);
      console.log('🔍 Oracle verification will begin automatically');
      console.log('⏱️ Expected verification time: 5-10 minutes');
    }

    return { success: true, pledgeId };

  } catch (error) {
    console.error('Asset pledge failed:', error);
    throw error;
  }
}

/**
 * INTEGRATION POINT 2: When RWA token is minted
 * Add this to your existing token minting workflow
 */
async function handleTokenMinting(tokenData) {
  try {
    // Your existing token minting logic...
    console.log('Minting RWA token...');
    
    // NEW: Notify Project 2 about the minted token
    if (liquidityIntegrationManager.isConnected()) {
      await liquidityIntegrationManager.notifyTokenMinted({
        tokenId: tokenData.tokenId,
        assetId: tokenData.assetId,
        tokenSymbol: tokenData.symbol,
        issuerAddress: tokenData.issuer,
        totalSupply: tokenData.supply,
        xrplTxHash: tokenData.txHash,
        appraisedValue: tokenData.value
      });
      
      console.log('🪙 Token minting notified to Liquidity Engine');
      console.log('💰 Liquidity aggregation will begin automatically');
    }

    return { success: true, tokenId: tokenData.tokenId };

  } catch (error) {
    console.error('Token minting failed:', error);
    throw error;
  }
}

/**
 * INTEGRATION POINT 3: When trustline is created
 * Add this to your existing trustline setup workflow
 */
async function handleTrustlineCreation(trustlineData) {
  try {
    // Your existing trustline creation logic...
    console.log('Creating trustline...');
    
    // NEW: Notify Project 2 about the trustline
    if (liquidityIntegrationManager.isConnected()) {
      await liquidityIntegrationManager.notifyTrustlineCreated({
        walletAddress: trustlineData.wallet,
        tokenId: trustlineData.tokenId,
        assetId: trustlineData.assetId,
        issuerAddress: trustlineData.issuer,
        limitAmount: trustlineData.limit,
        xrplTxHash: trustlineData.txHash
      });
      
      console.log('🔗 Trustline creation notified to Liquidity Engine');
      console.log('🎯 Market making will activate automatically');
    }

    return { success: true, trustlineHash: trustlineData.txHash };

  } catch (error) {
    console.error('Trustline creation failed:', error);
    throw error;
  }
}

/**
 * INTEGRATION POINT 4: Check asset/token status
 * Use this to check verification and liquidity status
 */
async function checkAssetStatus(assetId) {
  try {
    if (!liquidityIntegrationManager.isConnected()) {
      return { status: 'INTEGRATION_UNAVAILABLE' };
    }

    const status = liquidityIntegrationManager.getAssetStatus(assetId);
    
    console.log('Asset status:', {
      assetId,
      status: status.status,
      verification: status.verification,
      liquidity: status.liquidity
    });

    return status;

  } catch (error) {
    console.error('Failed to check asset status:', error);
    return { status: 'ERROR', error: error.message };
  }
}

/**
 * NEW API ENDPOINTS: Add these to your existing routes
 */

// Check integration status
app.get('/api/v1/integration/status', (req, res) => {
  const stats = liquidityIntegrationManager.getIntegrationStats();
  res.json({
    success: true,
    integration: {
      connected: liquidityIntegrationManager.isConnected(),
      stats,
      liquidityEngine: {
        url: process.env.LIQUIDITY_ENGINE_URL,
        status: stats.enabled ? 'ENABLED' : 'DISABLED'
      }
    }
  });
});

// Check asset verification and liquidity status
app.get('/api/v1/assets/:assetId/liquidity-status', async (req, res) => {
  try {
    const status = await checkAssetStatus(req.params.assetId);
    res.json({ success: true, assetId: req.params.assetId, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start the server
startServer();

// =================================================================
// TESTING: Use these endpoints to test the integration
// =================================================================

/**
 * TEST ENDPOINT: Manual asset pledge (for testing)
 * POST /api/v1/test/pledge
 */
app.post('/api/v1/test/pledge', async (req, res) => {
  try {
    const testAsset = {
      id: `test_asset_${Date.now()}`,
      type: 'REAL_ESTATE',
      value: 500000,
      description: 'Test property for integration testing',
      location: 'Test City, Test State',
      appraisalDate: new Date().toISOString(),
      documents: ['test_title', 'test_appraisal']
    };

    const result = await handleAssetPledge('rTestWallet123...', testAsset);
    
    res.json({
      success: true,
      message: 'Test asset pledge processed',
      result,
      nextSteps: [
        'Oracle verification will begin automatically',
        'Check verification status in 5-10 minutes',
        'Liquidity will be provided upon verification approval'
      ]
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = app;