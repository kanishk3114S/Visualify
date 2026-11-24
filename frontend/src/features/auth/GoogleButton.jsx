import { useState } from "react";
import { Button } from "../../components/Button.jsx";
import { supabase } from "../../lib/supabase.js";
import { rememberReturnTo } from "../../lib/returnTo.js";
import { authErrorMessage } from "../../lib/authErrors.js";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.7-4.9h-4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
    </svg>
  );
}

/**
 * Starts Supabase Google OAuth (PKCE). The validated returnTo is kept in
 * sessionStorage for /auth/callback, so the redirect URL allowlisted in
 * Supabase stays a fixed path with no query string.
 */
export function GoogleButton({ returnTo, onError, label = "Continue with Google" }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    rememberReturnTo(returnTo);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // On success the browser navigates to Google; only failures return here.
    if (error) {
      setPending(false);
      onError?.(authErrorMessage(error, "Google sign-in is unavailable right now. Please try again."));
    }
  }

  return (
    <Button variant="secondary" size="lg" className="w-full" onClick={handleClick} loading={pending} loadingText="Redirecting to Google…">
      {!pending && <GoogleMark />}
      {label}
    </Button>
  );
}
