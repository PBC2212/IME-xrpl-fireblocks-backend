-- Database Schema for Liquidity Integration
-- File: scripts/liquidity_schema.sql
-- Execute this in your existing PostgreSQL database

-- =====================================================
-- LIQUIDITY POSITIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS liquidity_positions (
    id BIGSERIAL PRIMARY KEY,
    position_id VARCHAR(255) UNIQUE NOT NULL, -- Circle position ID or legacy ID
    user_wallet VARCHAR(255) NOT NULL, -- XRPL wallet address
    rwa_token_id VARCHAR(255) NOT NULL, -- Reference to your RWA tokens
    
    -- Liquidity Details
    liquidity_amount DECIMAL(20,8) NOT NULL,
    collateral_value DECIMAL(20,8) NOT NULL,
    ltv_ratio DECIMAL(5,4) NOT NULL, -- Loan-to-value ratio
    
    -- Provider Information
    provider VARCHAR(50) NOT NULL DEFAULT 'circle', -- 'circle', 'legacy_engine', 'anchorage', etc.
    provider_position_id VARCHAR(255), -- External provider's position ID
    
    -- Financial Terms
    interest_rate DECIMAL(8,6) NOT NULL, -- Annual interest rate
    fee_rate DECIMAL(8,6) NOT NULL DEFAULT 0.025, -- Processing fee rate
    fee_amount DECIMAL(20,8) NOT NULL DEFAULT 0,
    
    -- Status and Timing
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'repaid', 'liquidated', 'failed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMP WITH TIME ZONE,
    maturity_date TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- XRPL Transaction Details
    xrpl_tx_hash VARCHAR(255), -- XRPL transaction hash for liquidity transfer
    xrpl_ledger_index INTEGER,
    usdc_amount DECIMAL(20,8), -- Amount of USDC provided
    
    -- Risk and Compliance
    risk_score DECIMAL(3,2), -- 0.00 to 1.00
    kyc_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'verified', 'rejected'
    asset_verification_status VARCHAR(50) DEFAULT 'pending',
    
    -- Metadata
    metadata JSONB, -- Additional data, Circle response, etc.
    notes TEXT,
    
    -- Indexes for performance
    CONSTRAINT fk_rwa_token FOREIGN KEY (rwa_token_id) REFERENCES rwa_tokens(token_id) ON DELETE CASCADE
);

-- =====================================================
-- LIQUIDITY PAYMENTS TABLE (for tracking repayments)
-- =====================================================
CREATE TABLE IF NOT EXISTS liquidity_payments (
    id BIGSERIAL PRIMARY KEY,
    position_id VARCHAR(255) NOT NULL REFERENCES liquidity_positions(position_id),
    payment_id VARCHAR(255) UNIQUE NOT NULL, -- Circle payment ID or generated ID
    
    -- Payment Details
    payment_type VARCHAR(50) NOT NULL, -- 'interest', 'principal', 'fee', 'full_repayment'
    amount DECIMAL(20,8) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    
    -- Status and Timing
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'failed'
    due_date TIMESTAMP WITH TIME ZONE,
    paid_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- XRPL Transaction Details
    xrpl_tx_hash VARCHAR(255),
    xrpl_ledger_index INTEGER,
    
    -- Provider Details
    provider_payment_id VARCHAR(255), -- External provider payment ID
    metadata JSONB
);

-- =====================================================
-- LIQUIDITY SWAPS TABLE (for asset swapping)
-- =====================================================
CREATE TABLE IF NOT EXISTS liquidity_swaps (
    id BIGSERIAL PRIMARY KEY,
    swap_id VARCHAR(255) UNIQUE NOT NULL, -- Circle trade ID or generated ID
    user_wallet VARCHAR(255) NOT NULL,
    
    -- Swap Details
    from_asset VARCHAR(100) NOT NULL, -- Asset being sold
    to_asset VARCHAR(100) NOT NULL DEFAULT 'USDC', -- Asset being bought
    from_amount DECIMAL(20,8) NOT NULL,
    to_amount DECIMAL(20,8) NOT NULL,
    exchange_rate DECIMAL(20,8) NOT NULL,
    slippage_tolerance DECIMAL(5,4) DEFAULT 0.02,
    
    -- Status and Timing
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'failed', 'expired'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    executed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Provider Information
    provider VARCHAR(50) NOT NULL DEFAULT 'circle',
    provider_trade_id VARCHAR(255),
    
    -- XRPL Transaction Details
    from_xrpl_tx_hash VARCHAR(255), -- Transaction sending the asset
    to_xrpl_tx_hash VARCHAR(255), -- Transaction receiving the asset
    
    -- Fees
    fee_amount DECIMAL(20,8) DEFAULT 0,
    fee_currency VARCHAR(10) DEFAULT 'USD',
    
    -- Metadata
    metadata JSONB
);

-- =====================================================
-- LIQUIDITY RATES CACHE TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS liquidity_rates_cache (
    id BIGSERIAL PRIMARY KEY,
    asset_type VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    
    -- Rate Information
    ltv_ratio DECIMAL(5,4) NOT NULL, -- Max loan-to-value ratio
    interest_rate DECIMAL(8,6) NOT NULL, -- Annual interest rate
    fee_rate DECIMAL(8,6) NOT NULL, -- Processing fee rate
    min_amount DECIMAL(20,8) NOT NULL,
    max_amount DECIMAL(20,8) NOT NULL,
    
    -- Availability
    available BOOLEAN DEFAULT true,
    processing_time_minutes INTEGER DEFAULT 300, -- 5 hours default
    
    -- Cache Management
    cached_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '5 minutes'),
    
    -- Unique constraint for asset_type + provider combination
    CONSTRAINT unique_asset_provider UNIQUE (asset_type, provider)
);

-- =====================================================
-- WEBHOOK EVENTS TABLE (for Circle webhook tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS webhook_events (
    id BIGSERIAL PRIMARY KEY,
    webhook_id VARCHAR(255) UNIQUE NOT NULL, -- Circle webhook ID
    event_type VARCHAR(100) NOT NULL, -- 'transfers', 'payments', 'otc.trades'
    
    -- Event Details
    resource_id VARCHAR(255) NOT NULL, -- Circle resource ID (transfer, payment, trade)
    status VARCHAR(50) NOT NULL,
    
    -- Processing
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Timing
    received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Raw Data
    raw_payload JSONB NOT NULL,
    
    -- Related Records
    position_id VARCHAR(255), -- Link to liquidity position if applicable
    swap_id VARCHAR(255) -- Link to liquidity swap if applicable
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Liquidity Positions Indexes
CREATE INDEX IF NOT EXISTS idx_liquidity_positions_user_wallet ON liquidity_positions(user_wallet);
CREATE INDEX IF NOT EXISTS idx_liquidity_positions_status ON liquidity_positions(status);
CREATE INDEX IF NOT EXISTS idx_liquidity_positions_provider ON liquidity_positions(provider);
CREATE INDEX IF NOT EXISTS idx_liquidity_positions_created_at ON liquidity_positions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_liquidity_positions_maturity_date ON liquidity_positions(maturity_date);
CREATE INDEX IF NOT EXISTS idx_liquidity_positions_rwa_token ON liquidity_positions(rwa_token_id);

-- Liquidity Payments Indexes
CREATE INDEX IF NOT EXISTS idx_liquidity_payments_position_id ON liquidity_payments(position_id);
CREATE INDEX IF NOT EXISTS idx_liquidity_payments_status ON liquidity_payments(status);
CREATE INDEX IF NOT EXISTS idx_liquidity_payments_due_date ON liquidity_payments(due_date);

-- Liquidity Swaps Indexes
CREATE INDEX IF NOT EXISTS idx_liquidity_swaps_user_wallet ON liquidity_swaps(user_wallet);
CREATE INDEX IF NOT EXISTS idx_liquidity_swaps_status ON liquidity_swaps(status);
CREATE INDEX IF NOT EXISTS idx_liquidity_swaps_created_at ON liquidity_swaps(created_at DESC);

-- Rates Cache Indexes
CREATE INDEX IF NOT EXISTS idx_liquidity_rates_expires_at ON liquidity_rates_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_liquidity_rates_asset_type ON liquidity_rates_cache(asset_type);

-- Webhook Events Indexes
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_type ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at DESC);

-- =====================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to liquidity_positions
CREATE TRIGGER update_liquidity_positions_updated_at 
    BEFORE UPDATE ON liquidity_positions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Active liquidity positions with RWA token details
CREATE OR REPLACE VIEW active_liquidity_positions AS
SELECT 
    lp.*,
    rt.asset_type,
    rt.asset_description,
    rt.current_valuation
FROM liquidity_positions lp
JOIN rwa_tokens rt ON lp.rwa_token_id = rt.token_id
WHERE lp.status = 'active';

-- User liquidity summary
CREATE OR REPLACE VIEW user_liquidity_summary AS
SELECT 
    user_wallet,
    COUNT(*) as total_positions,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_positions,
    SUM(CASE WHEN status = 'active' THEN liquidity_amount ELSE 0 END) as total_active_liquidity,
    SUM(CASE WHEN status = 'active' THEN collateral_value ELSE 0 END) as total_collateral_value,
    AVG(CASE WHEN status = 'active' THEN interest_rate ELSE NULL END) as avg_interest_rate
FROM liquidity_positions
GROUP BY user_wallet;

-- Provider liquidity statistics
CREATE OR REPLACE VIEW provider_liquidity_stats AS
SELECT 
    provider,
    COUNT(*) as total_positions,
    SUM(CASE WHEN status = 'active' THEN liquidity_amount ELSE 0 END) as total_active_liquidity,
    AVG(interest_rate) as avg_interest_rate,
    AVG(ltv_ratio) as avg_ltv_ratio,
    MIN(created_at) as first_position_date,
    MAX(created_at) as latest_position_date
FROM liquidity_positions
GROUP BY provider;

-- =====================================================
-- INITIAL DATA SEEDING (OPTIONAL)
-- =====================================================

-- Insert default rate configurations
INSERT INTO liquidity_rates_cache (asset_type, provider, ltv_ratio, interest_rate, fee_rate, min_amount, max_amount, processing_time_minutes) VALUES
('real_estate', 'circle', 0.70, 0.08, 0.02, 1000, 100000, 5),
('vehicle', 'circle', 0.80, 0.12, 0.025, 500, 50000, 3),
('precious_metals', 'circle', 0.90, 0.06, 0.015, 100, 75000, 2),
('bonds', 'circle', 0.95, 0.05, 0.01, 1000, 200000, 2),
('stocks', 'circle', 0.85, 0.10, 0.02, 100, 150000, 1),
('commodities', 'circle', 0.75, 0.15, 0.03, 500, 80000, 5),
-- Legacy engine rates (higher processing times)
('real_estate', 'legacy_engine', 0.60, 0.10, 0.03, 5000, 50000, 120),
('vehicle', 'legacy_engine', 0.70, 0.15, 0.035, 2000, 25000, 90),
('precious_metals', 'legacy_engine', 0.80, 0.08, 0.025, 1000, 40000, 60)
ON CONFLICT (asset_type, provider) DO NOTHING;

-- =====================================================
-- CLEANUP FUNCTIONS
-- =====================================================

-- Function to clean up expired rate cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_rates()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM liquidity_rates_cache WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old processed webhook events (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_events()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM webhook_events 
    WHERE processed = true 
    AND processed_at < CURRENT_TIMESTAMP - INTERVAL '30 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE liquidity_positions IS 'Tracks all liquidity positions from various providers (Circle, legacy engine, etc.)';
COMMENT ON TABLE liquidity_payments IS 'Tracks all payments (interest, principal, fees) for liquidity positions';
COMMENT ON TABLE liquidity_swaps IS 'Tracks asset swaps for immediate liquidity conversion';
COMMENT ON TABLE liquidity_rates_cache IS 'Caches current liquidity rates and terms from various providers';
COMMENT ON TABLE webhook_events IS 'Tracks webhook events from external liquidity providers';

COMMENT ON COLUMN liquidity_positions.ltv_ratio IS 'Loan-to-value ratio: liquidity_amount / collateral_value';
COMMENT ON COLUMN liquidity_positions.risk_score IS 'Risk assessment score from 0.00 (lowest risk) to 1.00 (highest risk)';
COMMENT ON COLUMN liquidity_positions.metadata IS 'JSON storage for provider-specific data and additional context';