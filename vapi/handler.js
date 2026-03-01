/**
 * VAPI Response Handler
 *
 * Wraps responses in the VAPI-required format:
 * { results: [{ toolCallId, result|error }] }
 *
 * Rules:
 * - Always HTTP 200
 * - result/error are always strings (no objects/arrays)
 * - No \n in strings (replaced with ", ")
 * - toolCallId matches the request
 */

function vapiSuccess(toolCallId, message) {
  const result = String(message).replace(/\n/g, ', ').trim();
  return {
    results: [{ toolCallId, result }]
  };
}

function vapiError(toolCallId, message) {
  const error = String(message).replace(/\n/g, ', ').trim();
  return {
    results: [{ toolCallId, error }]
  };
}

/**
 * Middleware factory for VAPI endpoints.
 * Usage: router.post('/path', vapiMiddleware, handler)
 *
 * The handler receives (req, res) where:
 * - req.toolCallId is extracted
 * - req.vapiParams is req.body.parameters (or req.body if no parameters key)
 * - res.vapiSuccess(msg) sends 200 with success format
 * - res.vapiError(msg) sends 200 with error format
 */
function vapiMiddleware(req, res, next) {
  // Extract toolCallId from various VAPI body formats
  const toolCallId = req.body?.toolCallId
    || req.body?.tool_call_id
    || req.body?.id
    || 'unknown';

  req.toolCallId = toolCallId;
  req.vapiParams = req.body?.parameters || req.body;

  res.vapiSuccess = (message) => {
    res.status(200).json(vapiSuccess(toolCallId, message));
  };

  res.vapiError = (message) => {
    res.status(200).json(vapiError(toolCallId, message));
  };

  next();
}

module.exports = { vapiMiddleware, vapiSuccess, vapiError };
