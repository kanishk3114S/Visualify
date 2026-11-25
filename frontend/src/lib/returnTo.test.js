import { describe, it, expect } from "vitest";
import { sanitizeReturnTo, DEFAULT_RETURN_TO } from "./returnTo.js";

const origin = "http://localhost:5173";
const s = (v) => sanitizeReturnTo(v, { origin });

describe("sanitizeReturnTo", () => {
  it.each([
    ["/app", "/app"],
    ["/app/profile", "/app/profile"],
    ["/app/settings/account?tab=1#pw", "/app/settings/account?tab=1#pw"],
    ["/features", "/features"],
    ["/app/../app/profile", "/app/profile"], // normalised, still same origin
  ])("allows same-origin app path %s", (input, expected) => {
    expect(s(input)).toBe(expected);
  });

  it.each([
    ["https://evil.com"],
    ["http://localhost:5173/app"], // absolute URLs are refused even if same origin
    ["//evil.com"],
    ["//evil.com/app"],
    ["/\\evil.com"],
    ["\\\\evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["/\u0000"],
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["app"],
    [""],
    [null],
    [undefined],
    [42],
    [{ toString: () => "/app" }],
    ["/" + "a".repeat(3000)],
    ["/login"],
    ["/login?returnTo=/app"],
    ["/signup"],
    ["/auth/callback"],
    ["/reset-password"],
    ["/forgot-password"],
  ])("rejects %j and falls back to /app", (input) => {
    expect(s(input)).toBe(DEFAULT_RETURN_TO);
  });

  it("supports a custom fallback", () => {
    expect(sanitizeReturnTo("https://evil.com", { origin, fallback: "/" })).toBe("/");
  });

  it("falls back when no origin is available", () => {
    expect(sanitizeReturnTo("/app/profile", { origin: undefined })).toBe(DEFAULT_RETURN_TO);
  });
});
