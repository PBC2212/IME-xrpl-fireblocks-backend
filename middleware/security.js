const { RateLimiterMemory } = require('rate-limiter-flexible');

// Rate limiting configuration
const rateLimiter = new RateLimiterMemory({
  keyFamily: 'xrpl-api',
  points: parseInt(process.env.API_RATE_LIMIT) || 100, // Number of requests
  duration: 60, // Per 60 seconds by IP
  blockDuration: 60, // Block for 60 seconds if limit exceeded
});

// Rate limiting middleware
const rateLimitMiddleware = async (req, res, next) => {
  try {
    const key = req.ip || req.connection.remoteAddress;
    await rateLimiter.consume(key);
    next();
  } catch (rejRes) {
    const remainingPoints = rejRes.remainingPoints || 0;
    const msBeforeNext = rejRes.msBeforeNext || 0;
    
    res.set({
      'Retry-After': Math.round(msBeforeNext / 1000) || 1,
      'X-RateLimit-Limit': rateLimiter.points,
      'X-RateLimit-Remaining': remainingPoints,
      'X-RateLimit-Reset': new Date(Date.now() + msBeforeNext).toISOString(),
    });
    
    res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later',
      data: {
        retryAfter: Math.round(msBeforeNext / 1000),
        limit: rateLimiter.points,
        remaining: remainingPoints,
        resetTime: new Date(Date.now() + msBeforeNext).toISOString(),
        timestamp: new Date().toISOString()
      }
    });
  }
};

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
  // Sanitize common fields to prevent injection
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    
    // Remove potentially dangerous characters
    return str
      .replace(/[<>]/g, '') // Remove HTML tags
      .replace(/javascript:/gi, '') // Remove javascript protocols
      .replace(/data:/gi, '') // Remove data URLs
      .trim();
  };

  // Recursively sanitize object
  const sanitizeObject = (obj) => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return sanitizeString(obj);
    if (typeof obj !== 'object') return obj;
    
    const sanitized = Array.isArray(obj) ? [] : {};
    
    for (const [key, value] of Object.entries(obj)) {
      const sanitizedKey = sanitizeString(key);
      sanitized[sanitizedKey] = sanitizeObject(value);
    }
    
    return sanitized;
  };

  // Sanitize request body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  // Sanitize URL parameters
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  // Set security headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';",
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-API-Version': '1.0.0',
    'X-Powered-By': 'XRPL-Native-Platform'
  });

  next();
};

// Request validation middleware
const validateRequest = (req, res, next) => {
  // Check for required headers
  if (!req.headers['content-type'] && req.method !== 'GET') {
    return res.status(400).json({
      success: false,
      message: 'Content-Type header is required',
      data: {
        requiredHeader: 'application/json',
        timestamp: new Date().toISOString()
      }
    });
  }

  // Validate JSON content type for POST requests
  if (req.method !== 'GET' && req.headers['content-type'] && 
      !req.headers['content-type'].includes('application/json')) {
    return res.status(400).json({
      success: false,
      message: 'Content-Type must be application/json',
      data: {
        receivedContentType: req.headers['content-type'],
        expectedContentType: 'application/json',
        timestamp: new Date().toISOString()
      }
    });
  }

  next();
};

// XRPL-specific security middleware
const xrplSecurity = (req, res, next) => {
  // Validate XRPL addresses in URL params
  if (req.params.address && !/^r[a-zA-Z0-9]{25,34}$/.test(req.params.address)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid XRPL address format',
      data: {
        address: req.params.address,
        expectedFormat: 'rXXXXXXXXXXXXXXXXX (25-34 characters starting with r)',
        timestamp: new Date().toISOString()
      }
    });
  }

  // Check for seed exposure in logs (prevent accidental logging)
  if (req.body && req.body.walletSeed) {
    // Mark request as containing sensitive data
    req.hasSensitiveData = true;
  }

  next();
};

// Request logging middleware (security-aware)
const secureLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Create a safe log object (without sensitive data)
  const logData = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString(),
    hasSensitiveData: req.hasSensitiveData || false
  };

  // Log request (without sensitive body data)
  console.log('🔒 Secure Request:', {
    ...logData,
    body: req.hasSensitiveData ? '[REDACTED - Contains sensitive data]' : req.body
  });

  // Override res.json to log responses
  const originalJson = res.json;
  res.json = function(data) {
    const duration = Date.now() - startTime;
    
    console.log('📤 Response:', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      success: data.success,
      timestamp: new Date().toISOString()
    });
    
    return originalJson.call(this, data);
  };

  next();
};

// Export all middleware
module.exports = {
  rateLimitMiddleware,
  sanitizeInput,
  securityHeaders,
  validateRequest,
  xrplSecurity,
  secureLogger
};