// setup-liquidity-db.js
// Temporary script to set up liquidity database schema

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection using your existing config
const pool = new Pool({
    connectionString: process.env.SHARED_DATABASE_URL || 'postgresql://postgres:Lifestyle2570%@localhost:5432/postgres'
});

async function setupLiquidityDatabase() {
    const client = await pool.connect();
    
    try {
        console.log('🔗 Connected to database...');
        
        // Check if rwa_tokens table exists
        const rwaTableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'rwa_tokens'
            );
        `);
        
        if (!rwaTableCheck.rows[0].exists) {
            console.log('📋 Creating rwa_tokens table...');
            await client.query(`
                CREATE TABLE rwa_tokens (
                    token_id VARCHAR(255) PRIMARY KEY,
                    asset_type VARCHAR(100) NOT NULL,
                    asset_description TEXT,
                    current_valuation DECIMAL(20,8),
                    status VARCHAR(50) DEFAULT 'active',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `);
            console.log('✅ rwa_tokens table created');
        } else {
            console.log('✅ rwa_tokens table already exists');
        }

        // Create liquidity_positions table
        console.log('📋 Creating liquidity_positions table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS liquidity_positions (
                id BIGSERIAL PRIMARY KEY,
                position_id VARCHAR(255) UNIQUE NOT NULL,
                user_wallet VARCHAR(255) NOT NULL,
                rwa_token_id VARCHAR(255) NOT NULL,
                
                liquidity_amount DECIMAL(20,8) NOT NULL,
                collateral_value DECIMAL(20,8) NOT NULL,
                ltv_ratio DECIMAL(5,4) NOT NULL,
                
                provider VARCHAR(50) NOT NULL DEFAULT 'circle',
                provider_position_id VARCHAR(255),
                
                interest_rate DECIMAL(8,6) NOT NULL,
                fee_rate DECIMAL(8,6) NOT NULL DEFAULT 0.025,
                fee_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
                
                status VARCHAR(50) NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                activated_at TIMESTAMP WITH TIME ZONE,
                maturity_date TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                
                xrpl_tx_hash VARCHAR(255),
                xrpl_ledger_index INTEGER,
                usdc_amount DECIMAL(20,8),
                
                risk_score DECIMAL(3,2),
                kyc_status VARCHAR(50) DEFAULT 'pending',
                asset_verification_status VARCHAR(50) DEFAULT 'pending',
                
                metadata JSONB,
                notes TEXT,
                
                CONSTRAINT fk_rwa_token FOREIGN KEY (rwa_token_id) REFERENCES rwa_tokens(token_id) ON DELETE CASCADE
            );
        `);
        console.log('✅ liquidity_positions table created');

        // Create liquidity_payments table
        console.log('📋 Creating liquidity_payments table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS liquidity_payments (
                id BIGSERIAL PRIMARY KEY,
                position_id VARCHAR(255) NOT NULL,
                payment_id VARCHAR(255) UNIQUE NOT NULL,
                
                payment_type VARCHAR(50) NOT NULL,
                amount DECIMAL(20,8) NOT NULL,
                currency VARCHAR(10) NOT NULL DEFAULT 'USD',
                
                status VARCHAR(50) NOT NULL DEFAULT 'pending',
                due_date TIMESTAMP WITH TIME ZONE,
                paid_date TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                
                xrpl_tx_hash VARCHAR(255),
                xrpl_ledger_index INTEGER,
                
                provider_payment_id VARCHAR(255),
                metadata JSONB,
                
                CONSTRAINT fk_position FOREIGN KEY (position_id) REFERENCES liquidity_positions(position_id)
            );
        `);
        console.log('✅ liquidity_payments table created');

        // Create liquidity_swaps table
        console.log('📋 Creating liquidity_swaps table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS liquidity_swaps (
                id BIGSERIAL PRIMARY KEY,
                swap_id VARCHAR(255) UNIQUE NOT NULL,
                user_wallet VARCHAR(255) NOT NULL,
                
                from_asset VARCHAR(100) NOT NULL,
                to_asset VARCHAR(100) NOT NULL DEFAULT 'USDC',
                from_amount DECIMAL(20,8) NOT NULL,
                to_amount DECIMAL(20,8) NOT NULL,
                exchange_rate DECIMAL(20,8) NOT NULL,
                slippage_tolerance DECIMAL(5,4) DEFAULT 0.02,
                
                status VARCHAR(50) NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                executed_at TIMESTAMP WITH TIME ZONE,
                expires_at TIMESTAMP WITH TIME ZONE,
                
                provider VARCHAR(50) NOT NULL DEFAULT 'circle',
                provider_trade_id VARCHAR(255),
                
                from_xrpl_tx_hash VARCHAR(255),
                to_xrpl_tx_hash VARCHAR(255),
                
                fee_amount DECIMAL(20,8) DEFAULT 0,
                fee_currency VARCHAR(10) DEFAULT 'USD',
                
                metadata JSONB
            );
        `);
        console.log('✅ liquidity_swaps table created');

        // Create liquidity_rates_cache table
        console.log('📋 Creating liquidity_rates_cache table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS liquidity_rates_cache (
                id BIGSERIAL PRIMARY KEY,
                asset_type VARCHAR(100) NOT NULL,
                provider VARCHAR(50) NOT NULL,
                
                ltv_ratio DECIMAL(5,4) NOT NULL,
                interest_rate DECIMAL(8,6) NOT NULL,
                fee_rate DECIMAL(8,6) NOT NULL,
                min_amount DECIMAL(20,8) NOT NULL,
                max_amount DECIMAL(20,8) NOT NULL,
                
                available BOOLEAN DEFAULT true,
                processing_time_minutes INTEGER DEFAULT 300,
                
                cached_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '5 minutes'),
                
                CONSTRAINT unique_asset_provider UNIQUE (asset_type, provider)
            );
        `);
        console.log('✅ liquidity_rates_cache table created');

        // Create webhook_events table
        console.log('📋 Creating webhook_events table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS webhook_events (
                id BIGSERIAL PRIMARY KEY,
                webhook_id VARCHAR(255) UNIQUE NOT NULL,
                event_type VARCHAR(100) NOT NULL,
                
                resource_id VARCHAR(255) NOT NULL,
                status VARCHAR(50) NOT NULL,
                
                processed BOOLEAN DEFAULT false,
                processed_at TIMESTAMP WITH TIME ZONE,
                error_message TEXT,
                retry_count INTEGER DEFAULT 0,
                
                received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                
                raw_payload JSONB NOT NULL,
                
                position_id VARCHAR(255),
                swap_id VARCHAR(255)
            );
        `);
        console.log('✅ webhook_events table created');

        // Create indexes
        console.log('📋 Creating indexes...');
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_liquidity_positions_user_wallet ON liquidity_positions(user_wallet)',
            'CREATE INDEX IF NOT EXISTS idx_liquidity_positions_status ON liquidity_positions(status)',
            'CREATE INDEX IF NOT EXISTS idx_liquidity_positions_provider ON liquidity_positions(provider)',
            'CREATE INDEX IF NOT EXISTS idx_liquidity_positions_created_at ON liquidity_positions(created_at DESC)',
            'CREATE INDEX IF NOT EXISTS idx_liquidity_payments_position_id ON liquidity_payments(position_id)',
            'CREATE INDEX IF NOT EXISTS idx_liquidity_swaps_user_wallet ON liquidity_swaps(user_wallet)',
            'CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed)'
        ];

        for (const indexQuery of indexes) {
            await client.query(indexQuery);
        }
        console.log('✅ Indexes created');

        // Insert initial rate data
        console.log('📋 Inserting initial rate data...');
        await client.query(`
            INSERT INTO liquidity_rates_cache (asset_type, provider, ltv_ratio, interest_rate, fee_rate, min_amount, max_amount, processing_time_minutes) VALUES
            ('real_estate', 'circle', 0.70, 0.08, 0.02, 1000, 100000, 5),
            ('vehicle', 'circle', 0.80, 0.12, 0.025, 500, 50000, 3),
            ('precious_metals', 'circle', 0.90, 0.06, 0.015, 100, 75000, 2),
            ('bonds', 'circle', 0.95, 0.05, 0.01, 1000, 200000, 2),
            ('stocks', 'circle', 0.85, 0.10, 0.02, 100, 150000, 1),
            ('commodities', 'circle', 0.75, 0.15, 0.03, 500, 80000, 5),
            ('real_estate', 'legacy_engine', 0.60, 0.10, 0.03, 5000, 50000, 120),
            ('vehicle', 'legacy_engine', 0.70, 0.15, 0.035, 2000, 25000, 90)
            ON CONFLICT (asset_type, provider) DO NOTHING
        `);
        console.log('✅ Initial rate data inserted');

        // Insert test RWA token
        console.log('📋 Inserting test RWA token...');
        await client.query(`
            INSERT INTO rwa_tokens (token_id, asset_type, asset_description, current_valuation, status) 
            VALUES ('test_token_001', 'real_estate', 'Test Property Token for Liquidity', 100000.00, 'active')
            ON CONFLICT (token_id) DO NOTHING
        `);
        console.log('✅ Test RWA token created');

        // Verify setup
        const tableCount = await client.query(`
            SELECT COUNT(*) as count 
            FROM information_schema.tables 
            WHERE table_name LIKE 'liquidity%' OR table_name = 'webhook_events'
        `);
        
        console.log(`\n🎉 Database setup completed successfully!`);
        console.log(`📊 Created ${tableCount.rows[0].count} liquidity-related tables`);
        console.log(`✅ Foreign key relationships established`);
        console.log(`✅ Indexes created for performance`);
        console.log(`✅ Initial rate data seeded`);
        console.log(`✅ Test RWA token created`);

    } catch (error) {
        console.error('❌ Database setup failed:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the setup
if (require.main === module) {
    setupLiquidityDatabase()
        .then(() => {
            console.log('\n🚀 Ready for liquidity integration!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Setup failed:', error);
            process.exit(1);
        });
}

module.exports = { setupLiquidityDatabase };