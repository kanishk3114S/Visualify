import { randomUUID } from "node:crypto";

const SAFE_INCOMING_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Assigns req.id (reusing a well-formed client X-Request-Id for correlation,
 * otherwise generating one) and echoes it in the X-Request-Id response header.
 */
export function requestId() {
  return (req, res, next) => {
    const incoming = req.get("x-request-id");
    req.id = incoming && SAFE_INCOMING_ID.test(incoming) ? incoming : `req_${randomUUID().replaceAll("-", "")}`;
    res.set("X-Request-Id", req.id);
    next();
  };
}
