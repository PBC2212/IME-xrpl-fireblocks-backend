/**
 * Setup Script for XRPL RWA Platform
 * Validates configuration and sets up issuer wallet
 */

const { Client, Wallet } = require('xrpl');
require('dotenv').config();

const setupPlatform = async () => {
  console.log('🚀 Setting up XRPL RWA Platform...\n');

  // Check environment variables
  console.log('📋 Checking environment configuration...');
  const requiredEnvVars = [
    'XRPL_ENDPOINT',
    'PORT',
    'DEFAULT_ASSET_CURRENCY'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`  - ${varName}`));
    console.error('\nPlease check your .env file.');
    process.exit(1);
  }

  console.log('✅ Environment variables OK');

  // Connect to XRPL
  console.log('\n🔗 Connecting to XRPL...');
  const client = new Client(process.env.XRPL_ENDPOINT);
  
  try {
    await client.connect();
    console.log('✅ Connected to XRPL:', process.env.XRPL_ENDPOINT);

    // Get server info
    const serverInfo = await client.request({ command: 'server_info' });
    const networkState = serverInfo.result.info.server_state;
    console.log('📊 Network state:', networkState);

    // Check if issuer wallet is configured
    if (!process.env.XRPL_ISSUER_ADDRESS || !process.env.XRPL_ISSUER_SECRET) {
      console.log('\n🏦 No issuer wallet configured. Creating new issuer wallet...');
      
      // Generate new issuer wallet
      const issuerWallet = Wallet.generate();
      
      // Fund on testnet
      if (process.env.XRPL_ENDPOINT.includes('altnet')) {
        console.log('💰 Funding issuer wallet on testnet...');
        await client.fundWallet(issuerWallet);
      }

      // Get wallet info
      const accountInfo = await client.request({
        command: 'account_info',
        account: issuerWallet.address,
        ledger_index: 'validated'
      });

      console.log('\n🎉 Issuer wallet created successfully!');
      console.log('📍 Address:', issuerWallet.address);
      console.log('🔑 Seed:', issuerWallet.seed);
      console.log('💰 Balance:', (parseInt(accountInfo.result.account_data.Balance) / 1000000).toFixed(6), 'XRP');
      
      console.log('\n⚠️  IMPORTANT: Add these to your .env file:');
      console.log(`XRPL_ISSUER_ADDRESS=${issuerWallet.address}`);
      console.log(`XRPL_ISSUER_SECRET=${issuerWallet.seed}`);
      console.log(`DEFAULT_ASSET_ISSUER=${issuerWallet.address}`);
      
    } else {
      console.log('\n🏦 Validating existing issuer wallet...');
      
      try {
        const accountInfo = await client.request({
          command: 'account_info',
          account: process.env.XRPL_ISSUER_ADDRESS,
          ledger_index: 'validated'
        });

        const balance = (parseInt(accountInfo.result.account_data.Balance) / 1000000).toFixed(6);
        console.log('✅ Issuer wallet found');
        console.log('📍 Address:', process.env.XRPL_ISSUER_ADDRESS);
        console.log('💰 Balance:', balance, 'XRP');
        
        if (parseFloat(balance) < 10) {
          console.log('⚠️  Warning: Low XRP balance. You may need more XRP for operations.');
        }
        
      } catch (error) {
        console.error('❌ Issuer wallet validation failed:', error.message);
        if (error.data && error.data.error === 'actNotFound') {
          console.error('The issuer address does not exist on the ledger.');
        }
      }
    }

    // Test basic functionality
    console.log('\n🧪 Running basic functionality tests...');
    
    // Test server connection
    const ledger = await client.request({
      command: 'ledger',
      ledger_index: 'validated'
    });
    console.log('✅ Ledger access OK - Current ledger:', ledger.result.ledger.ledger_index);

    // Platform summary
    console.log('\n📋 Platform Summary:');
    console.log('🌐 Network:', process.env.XRPL_ENDPOINT.includes('altnet') ? 'Testnet' : 'Mainnet');
    console.log('🏦 Issuer Address:', process.env.XRPL_ISSUER_ADDRESS || 'Not configured');
    console.log('💎 Default Token:', process.env.DEFAULT_ASSET_CURRENCY);
    console.log('🚪 Server Port:', process.env.PORT);
    console.log('🎯 Frontend URL:', process.env.FRONTEND_URL || 'http://localhost:5173');

    console.log('\n🎉 Setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Start your backend: npm start');
    console.log('2. Start your frontend: npm run dev');
    console.log('3. Open http://localhost:5173 in your browser');
    console.log('4. Create a wallet and start tokenizing assets!');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  } finally {
    await client.disconnect();
  }
};

// Handle script execution
if (require.main === module) {
  setupPlatform().catch(error => {
    console.error('❌ Fatal error during setup:', error);
    process.exit(1);
  });
}

module.exports = { setupPlatform };