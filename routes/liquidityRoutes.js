/**
 * Liquidity Routes - Production Ready
 * API routes for liquidity integration between tokenization platform and liquidity engine
 * Copyright (c) 2025 IME Capital Trust LLC
 */

'use strict';

const express = require('express');
const router = express.Router();

function createLiquidityRoutes(liquidityController) {
  // Callback endpoints for Liquidity Engine (Project 2)
  
  // Receive verification results from Liquidity Engine
  router.post('/verification/callback', 
    liquidityController.validateLiquidityCallback.bind(liquidityController),
    liquidityController.handleVerificationCallback.bind(liquidityController)
  );

  // Receive liquidity availability notifications
  router.post('/liquidity/callback',
    liquidityController.validateLiquidityCallback.bind(liquidityController),
    liquidityController.handleLiquidityCallback.bind(liquidityController)
  );

  // Receive counterparty match notifications
  router.post('/counterparty/callback',
    liquidityController.validateLiquidityCallback.bind(liquidityController),
    liquidityController.handleCounterpartyCallback.bind(liquidityController)
  );

  // Status and information endpoints
  
  // Get liquidity status for a specific token
  router.get('/liquidity/status/:tokenId', 
    liquidityController.getLiquidityStatus.bind(liquidityController)
  );

  // Get verification status for a specific asset
  router.get('/verification/status/:assetId',
    liquidityController.getVerificationStatus.bind(liquidityController)
  );

  // Test connection to Liquidity Engine
  router.get('/integration/test',
    liquidityController.testLiquidityConnection.bind(liquidityController)
  );

  // Get integration statistics
  router.get('/integration/stats',
    liquidityController.getIntegrationStats.bind(liquidityController)
  );

  // Manual operations (for testing and admin use)
  
  // Manually trigger asset pledge notification
  router.post('/pledge/trigger',
    liquidityController.triggerAssetPledge.bind(liquidityController)
  );

  // Health check for liquidity integration
  router.get('/integration/health', (req, res) => {
    res.json({
      success: true,
      service: 'liquidity-integration',
      status: 'active',
      timestamp: new Date().toISOString(),
      endpoints: {
        verification_callback: '/api/v1/liquidity/verification/callback',
        liquidity_callback: '/api/v1/liquidity/liquidity/callback',
        counterparty_callback: '/api/v1/liquidity/counterparty/callback',
        status_check: '/api/v1/liquidity/liquidity/status/:tokenId',
        verification_status: '/api/v1/liquidity/verification/status/:assetId',
        integration_test: '/api/v1/liquidity/integration/test'
      }
    });
  });

  return router;
}

module.exports = createLiquidityRoutes;