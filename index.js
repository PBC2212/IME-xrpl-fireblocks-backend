const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import only essential modules
const nativeAssetController = require('./controllers/nativeAssetController');
const xrplNativeService = require('./services/xrplNativeService');
const { validateConfig } = require('./config/xrplConfig');

const app = express();
const PORT = process.env.PORT || 5000;

// Validate configuration
console.log('🔍 Validating XRPL configuration...');
const configValidation = validateConfig();
if (!configValidation.isValid) {
  console.error('❌ Configuration validation failed:');
  configValidation.errors.forEach(error => console.error(`  - ${error}`));
  process.exit(1);
}
console.log('✅ Configuration validation passed');

// Initialize XRPL service
const initializeXRPL = async () => {
  try {
    await xrplNativeService.initialize();
    console.log('✅ XRPL service initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize XRPL service:', error.message);
  }
};

// MINIMAL MIDDLEWARE - NO SECURITY
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'XRPL Platform Backend Running',
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      xrplEndpoint: process.env.XRPL_ENDPOINT
    }
  });
});

// ONLY THE XRPL FUNCTIONS YOU NEED
app.use('/api/native', nativeAssetController);

// Start server
const startServer = async () => {
  await initializeXRPL();
  
  app.listen(PORT, () => {
    console.log(`🚀 XRPL Platform running on port ${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔗 XRPL: ${process.env.XRPL_ENDPOINT}`);
    console.log('🎯 Ready for XRPL operations!');
  });
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down...');
  await xrplNativeService.disconnect();
  process.exit(0);
});

startServer().catch(error => {
  console.error('❌ Failed to start:', error);
  process.exit(1);
});

module.exports = app;