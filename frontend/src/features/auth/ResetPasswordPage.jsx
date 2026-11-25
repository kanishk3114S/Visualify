import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthLayout, textLink } from "./AuthLayout.jsx";
import { useAuth } from "./AuthContext.jsx";
import { Button, ButtonLink } from "../../components/Button.jsx";
import { FormAlert, TextField } from "../../components/Field.jsx";
import { FullPageSpinner } from "../../components/Spinner.jsx";
import { useToast } from "../../components/Toast.jsx";
import { supabase } from "../../lib/supabase.js";
import { LIMITS, resetPasswordSchema } from "../../lib/schemas.js";
import { authErrorMessage, readAuthUrlError } from "../../lib/authErrors.js";

/**
 * Landing page for the recovery email link. supabase-js exchanges the PKCE
 * recovery code during initialisation; this page waits for that, then lets the
 * (now recovery-authenticated) user choose a new password.
 */
export function ResetPasswordPage() {
  const { status } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [linkError] = useState(() => readAuthUrlError(location));
  const [formError, setFormError] = useState(null);

  // Remove the single-use ?code=/error params so a refresh can't replay them.
  useEffect(() => {
    if (status !== "loading" && (location.search || location.hash)) {
      navigate("/reset-password", { replace: true });
    }
  }, [status, location.search, location.hash, navigate]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: "", confirmPassword: "" } });

  async function onSubmit({ password }) {
    setFormError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setFormError(authErrorMessage(error, "We couldn't update your password. Please request a new link."));
      return;
    }
    toast.success("Your password has been updated.");
    navigate("/app", { replace: true });
  }

  if (status === "loading") return <FullPageSpinner label="Verifying your reset link" />;

  if (status !== "authenticated") {
    return (
      <AuthLayout title="Reset link not valid" footer={<Link to="/login" className={textLink}>Back to sign in</Link>}>
        <div className="space-y-4" data-testid="reset-link-invalid">
          <FormAlert>
            {linkError ?? "This reset link is invalid, has expired, or was opened in a different browser."}
          </FormAlert>
          <ButtonLink to="/forgot-password" className="w-full" size="lg">
            Request a new link
          </ButtonLink>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="You'll stay signed in after updating it.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Set new password">
        <FormAlert>{formError}</FormAlert>
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint={`At least ${LIMITS.passwordMin} characters, including a letter and a number.`}
          error={errors.password?.message}
          {...register("password")}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting} loadingText="Updating…">
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}
