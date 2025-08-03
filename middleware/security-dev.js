// Development security middleware - CSP disabled for frontend development

const rateLimitMiddleware = (req, res, next) => {
    // Rate limiting disabled for development
    next();
};

const sanitizeInput = (req, res, next) => {
    // Input sanitization disabled for development
    next();
};

const securityHeaders = (req, res, next) => {
    // Security headers disabled for development
    next();
};

const validateRequest = (req, res, next) => {
    // Request validation disabled for development
    next();
};

const xrplSecurity = (req, res, next) => {
    // XRPL security disabled for development
    next();
};

const secureLogger = (req, res, next) => {
    // Secure logging disabled for development
    next();
};

module.exports = {
    rateLimitMiddleware,
    sanitizeInput,
    securityHeaders,
    validateRequest,
    xrplSecurity,
    secureLogger
};