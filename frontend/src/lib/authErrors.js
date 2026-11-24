/**
 * Maps Supabase Auth errors to safe, user-facing messages. Messages never
 * confirm whether an email is registered (no account enumeration).
 */
const BY_CODE = {
  invalid_credentials: "Email or password is incorrect.",
  email_not_confirmed: "Confirm your email address before signing in. Check your inbox for the link.",
  user_banned: "This account can't sign in right now. Contact support if you think this is a mistake.",
  weak_password: "Choose a stronger password.",
  same_password: "Your new password must be different from your current one.",
  over_email_send_rate_limit: "Too many emails sent. Please wait a few minutes and try again.",
  over_request_rate_limit: "Too many attempts. Please wait a moment and try again.",
  over_sms_send_rate_limit: "Too many attempts. Please wait a moment and try again.",
  signup_disabled: "New sign-ups are currently closed.",
  email_provider_disabled: "Email sign-in is currently unavailable.",
  provider_disabled: "This sign-in method is currently unavailable.",
  validation_failed: "Please check the details you entered.",
  email_address_invalid: "Enter a valid email address.",
  session_not_found: "Your session has ended. Please sign in again.",
  reauthentication_needed: "For security, please sign in again before changing your password.",
  flow_state_expired: "This link has expired. Please request a new one.",
  flow_state_not_found: "This link is invalid or was opened in a different browser.",
  otp_expired: "This link has expired. Please request a new one.",
};

export function authErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  if (!error) return fallback;
  if (error.code && BY_CODE[error.code]) return BY_CODE[error.code];
  if (error.status === 429) return BY_CODE.over_request_rate_limit;
  if (error.name === "AuthRetryableFetchError" || error.status === 0) {
    return "We couldn't reach the sign-in service. Check your connection and try again.";
  }
  return fallback;
}

/** Reads OAuth/email-link error parameters from the query string or hash. */
export function readAuthUrlError(location = globalThis.location) {
  const params = new URLSearchParams(location?.search ?? "");
  const hash = new URLSearchParams((location?.hash ?? "").replace(/^#/, ""));
  const code = params.get("error_code") ?? hash.get("error_code");
  const error = params.get("error") ?? hash.get("error");
  if (!code && !error) return null;
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (error === "access_denied") return "Sign-in was cancelled or the link is no longer valid.";
  return "We couldn't complete sign-in. Please try again.";
}
