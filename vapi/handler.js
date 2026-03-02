/**
 * VAPI Response Handler
 *
 * VAPI sends tool calls as POST with this body:
 * {
 *   "message": {
 *     "type": "tool-calls",
 *     "toolCallList": [
 *       {
 *         "id": "call_xxx",
 *         "type": "function",
 *         "function": {
 *           "name": "create_reservation",
 *           "arguments": "{\"customer_name\": \"Mario\"}"  ← JSON string
 *         }
 *       }
 *     ]
 *   }
 * }
 *
 * Response must always be HTTP 200:
 * { "results": [{ "toolCallId": "call_xxx", "result": "..." }] }
 */

function vapiSuccess(toolCallId, message) {
  const result = String(message).replace(/\n/g, ', ').trim();
  return { results: [{ toolCallId, result }] };
}

function vapiError(toolCallId, message) {
  const error = String(message).replace(/\n/g, ', ').trim();
  return { results: [{ toolCallId, error }] };
}

function vapiMiddleware(req, res, next) {
  let toolCallId = 'unknown';
  let vapiParams = {};

  // VAPI production format
  const toolCallList = req.body?.message?.toolCallList;
  if (Array.isArray(toolCallList) && toolCallList.length > 0) {
    const call = toolCallList[0];
    toolCallId = call.id || 'unknown';
    try {
      vapiParams = JSON.parse(call.function?.arguments || '{}');
    } catch {
      vapiParams = {};
    }
  } else {
    // Fallback for direct testing (body contains params directly)
    toolCallId = req.body?.toolCallId || req.body?.id || 'unknown';
    vapiParams = req.body?.parameters || req.body || {};
  }

  req.toolCallId = toolCallId;
  req.vapiParams = vapiParams;

  res.vapiSuccess = (message) => res.status(200).json(vapiSuccess(toolCallId, message));
  res.vapiError   = (message) => res.status(200).json(vapiError(toolCallId, message));

  next();
}

module.exports = { vapiMiddleware, vapiSuccess, vapiError };
