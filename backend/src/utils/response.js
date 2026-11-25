/**
 * Standard response envelope (PRD 11.1):
 * { success, data, error, meta: { requestId } }
 */
function meta(res) {
  return { requestId: res.req?.id ?? null };
}

export function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, data, error: null, meta: meta(res) });
}

export function sendError(res, status, code, message, details = null) {
  return res.status(status).json({
    success: false,
    data: null,
    error: { code, message, details },
    meta: meta(res),
  });
}
