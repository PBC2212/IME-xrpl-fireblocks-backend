/**
 * Async Handler Middleware
 * Wraps async route handlers to catch errors and pass them to error middleware
 */

/**
 * Wraps async functions to catch errors and pass to next()
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Express middleware function
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;