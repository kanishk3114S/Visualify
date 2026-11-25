import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthLayout, textLink } from "./AuthLayout.jsx";
import { useAuth } from "./AuthContext.jsx";
import { ButtonLink } from "../../components/Button.jsx";
import { FormAlert } from "../../components/Field.jsx";
import { FullPageSpinner } from "../../components/Spinner.jsx";
import { readAuthUrlError } from "../../lib/authErrors.js";
import { consumeReturnTo } from "../../lib/returnTo.js";

/**
 * Completes Google OAuth and email-confirmation links. The PKCE code in the
 * URL is exchanged by supabase-js during initialisation; once the session is
 * known we redirect to the re-validated returnTo (or /app).
 */
export function AuthCallbackPage() {
  const { status } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [urlError] = useState(() => readAuthUrlError(location));
  const [hadCode] = useState(() => new URLSearchParams(location.search).has("code"));

  useEffect(() => {
    if (status === "authenticated") navigate(consumeReturnTo(), { replace: true });
  }, [status, navigate]);

  if (status === "loading" || status === "authenticated") return <FullPageSpinner label="Signing you in" />;

  const message =
    urlError ??
    (hadCode
      ? "This link is invalid, has expired, or was opened in a different browser. If you were confirming your email, it may already be confirmed - try signing in."
      : "There's nothing to complete here.");

  return (
    <AuthLayout title="We couldn't sign you in" footer={<Link to="/signup" className={textLink}>Create an account instead</Link>}>
      <div className="space-y-4" data-testid="auth-callback-error">
        <FormAlert>{message}</FormAlert>
        <ButtonLink to="/login" className="w-full" size="lg">
          Go to sign in
        </ButtonLink>
      </div>
    </AuthLayout>
  );
}
