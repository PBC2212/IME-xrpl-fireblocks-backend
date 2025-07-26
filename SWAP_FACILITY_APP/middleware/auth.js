/**
 * Authentication Middleware
 * Handles JWT token authentication and API key authentication
 */

const jwt = require('jsonwebtoken');
const { User } = require('../models');

/**
 * Verify JWT token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'Access token required'
            });
        }

        const token = authHeader.startsWith('Bearer ') 
            ? authHeader.slice(7) 
            : authHeader;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token format'
            });
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Find user
        const user = await User.findByPk(decoded.userId);
        if (!user || !user.is_active) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token or user not found'
            });
        }

        // Add user to request object
        req.user = user;
        req.userId = user.id;
        req.userAddress = user.xrpl_address;
        
        next();

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Authentication error'
        });
    }
};

/**
 * Verify API key authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const verifyApiKey = async (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'];
        const apiSecret = req.headers['x-api-secret'];

        if (!apiKey || !apiSecret) {
            return res.status(401).json({
                success: false,
                message: 'API key and secret required'
            });
        }

        // Find user by API key
        const user = await User.findByApiKey(apiKey);
        if (!user || !user.is_active) {
            return res.status(401).json({
                success: false,
                message: 'Invalid API key'
            });
        }

        // Verify API secret
        const isValidSecret = await user.validateApiSecret(apiSecret);
        if (!isValidSecret) {
            return res.status(401).json({
                success: false,
                message: 'Invalid API secret'
            });
        }

        // Add user to request object
        req.user = user;
        req.userId = user.id;
        req.userAddress = user.xrpl_address;
        req.authMethod = 'api_key';
        
        next();

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'API authentication error'
        });
    }
};

/**
 * Optional authentication - allows both authenticated and unauthenticated access
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const apiKey = req.headers['x-api-key'];

        // If no auth headers, continue without authentication
        if (!authHeader && !apiKey) {
            return next();
        }

        // Try JWT first
        if (authHeader) {
            try {
                await verifyToken(req, res, next);
                return;
            } catch (error) {
                // JWT failed, try API key if available
                if (!apiKey) {
                    return next(); // No API key, continue unauthenticated
                }
            }
        }

        // Try API key
        if (apiKey) {
            try {
                await verifyApiKey(req, res, next);
                return;
            } catch (error) {
                return next(); // API key failed, continue unauthenticated
            }
        }

        next();

    } catch (error) {
        // If optional auth fails, continue without authentication
        next();
    }
};

/**
 * Require specific user tier
 * @param {string|Array} requiredTiers - Required tier(s)
 * @returns {Function} Middleware function
 */
const requireTier = (requiredTiers) => {
    const tiers = Array.isArray(requiredTiers) ? requiredTiers : [requiredTiers];
    
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        if (!tiers.includes(req.user.tier_level)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Required tier: ${tiers.join(' or ')}`,
                userTier: req.user.tier_level
            });
        }

        next();
    };
};

/**
 * Require KYC verification
 * @param {string} minimumLevel - Minimum KYC level required
 * @returns {Function} Middleware function
 */
const requireKYC = (minimumLevel = 'basic') => {
    const kycLevels = {
        'none': 0,
        'basic': 1,
        'advanced': 2,
        'verified': 3
    };

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        const userLevel = kycLevels[req.user.kyc_status] || 0;
        const requiredLevel = kycLevels[minimumLevel] || 0;

        if (userLevel < requiredLevel) {
            return res.status(403).json({
                success: false,
                message: `KYC verification required. Minimum level: ${minimumLevel}`,
                userKycStatus: req.user.kyc_status,
                requiredKycLevel: minimumLevel
            });
        }

        next();
    };
};

/**
 * Check if user owns XRPL address
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requireAddressOwnership = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }

    const requestedAddress = req.params.userAddress || req.body.userAddress;
    
    if (!requestedAddress) {
        return res.status(400).json({
            success: false,
            message: 'User address required'
        });
    }

    if (req.user.xrpl_address !== requestedAddress) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. You can only access your own data.'
        });
    }

    next();
};

/**
 * Generate JWT token for user
 * @param {Object} user - User object
 * @param {string} expiresIn - Token expiration time
 * @returns {string} JWT token
 */
const generateToken = (user, expiresIn = '24h') => {
    const payload = {
        userId: user.id,
        xrplAddress: user.xrpl_address,
        tierLevel: user.tier_level,
        kycStatus: user.kyc_status
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn,
        issuer: 'ime-rwa-swap',
        audience: 'ime-users'
    });
};

/**
 * Generate refresh token
 * @param {Object} user - User object
 * @returns {string} Refresh token
 */
const generateRefreshToken = (user) => {
    const payload = {
        userId: user.id,
        type: 'refresh'
    };

    return jwt.sign(payload, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
        expiresIn: '7d',
        issuer: 'ime-rwa-swap',
        audience: 'ime-users'
    });
};

/**
 * Verify refresh token
 * @param {string} refreshToken - Refresh token
 * @returns {Object} Decoded token payload
 */
const verifyRefreshToken = (refreshToken) => {
    return jwt.verify(
        refreshToken, 
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );
};

/**
 * Rate limiting per user
 * @param {number} maxRequests - Maximum requests per window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Function} Middleware function
 */
const rateLimitPerUser = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
    const userRequests = new Map();

    return (req, res, next) => {
        const userId = req.user?.id || req.ip;
        const now = Date.now();
        const windowStart = now - windowMs;

        // Get user's request history
        if (!userRequests.has(userId)) {
            userRequests.set(userId, []);
        }

        const requests = userRequests.get(userId);
        
        // Remove old requests outside the window
        const recentRequests = requests.filter(timestamp => timestamp > windowStart);
        userRequests.set(userId, recentRequests);

        // Check if user has exceeded the limit
        if (recentRequests.length >= maxRequests) {
            return res.status(429).json({
                success: false,
                message: 'Too many requests, please try again later',
                retryAfter: Math.ceil(windowMs / 1000)
            });
        }

        // Add current request
        recentRequests.push(now);
        userRequests.set(userId, recentRequests);

        next();
    };
};

module.exports = {
    verifyToken,
    verifyApiKey,
    optionalAuth,
    requireTier,
    requireKYC,
    requireAddressOwnership,
    generateToken,
    generateRefreshToken,
    verifyRefreshToken,
    rateLimitPerUser
};