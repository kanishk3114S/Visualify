import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { AuthLayout, Divider, textLink } from "./AuthLayout.jsx";
import { GoogleButton } from "./GoogleButton.jsx";
import { useCooldown } from "./useResendCooldown.js";
import { Button } from "../../components/Button.jsx";
import { FormAlert, TextField } from "../../components/Field.jsx";
import { useToast } from "../../components/Toast.jsx";
import { supabase } from "../../lib/supabase.js";
import { LIMITS, signupSchema } from "../../lib/schemas.js";
import { authErrorMessage } from "../../lib/authErrors.js";
import { rememberReturnTo, sanitizeReturnTo } from "../../lib/returnTo.js";

function CheckEmail({ email, onResend, cooldown }) {
  return (
    <div className="space-y-4 text-center" data-testid="signup-check-email">
      <MailCheck className="mx-auto h-10 w-10 text-accent-700" aria-hidden="true" />
      <div className="space-y-1.5" role="status">
        <h2 className="text-lg font-semibold text-stone-900">Check your email</h2>
        <p className="text-sm text-stone-600">
          If <strong className="font-medium text-stone-800">{email}</strong> can be registered, we've sent a confirmation
          link. Open it in this browser to finish creating your account.
        </p>
      </div>
      <Button variant="secondary" onClick={onResend} disabled={cooldown.remaining > 0}>
        {cooldown.remaining > 0 ? `Resend available in ${cooldown.remaining}s` : "Resend email"}
      </Button>
    </div>
  );
}

export function SignupPage() {
  const [params] = useSearchParams();
  const returnTo = sanitizeReturnTo(params.get("returnTo"));
  const [formError, setFormError] = useState(null);
  const [sentTo, setSentTo] = useState(null);
  const cooldown = useCooldown(60);
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: { displayName: "", email: "", password: "", confirmPassword: "" },
  });

  const emailRedirectTo = `${window.location.origin}/auth/callback`;

  async function onSubmit(values) {
    setFormError(null);
    rememberReturnTo(returnTo);
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { emailRedirectTo, data: { display_name: values.displayName } },
    });
    if (error) {
      setFormError(authErrorMessage(error, "We couldn't create your account. Please try again."));
      return;
    }
    // With email confirmation enabled there is no session yet. Supabase also
    // returns this shape for already-registered emails, so the message never
    // reveals whether an account exists.
    if (!data.session) {
      setSentTo(values.email);
      cooldown.start();
    }
    // With confirmation disabled a session exists and PublicOnlyRoute redirects.
  }

  async function resend() {
    const { error } = await supabase.auth.resend({ type: "signup", email: sentTo, options: { emailRedirectTo } });
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    cooldown.start();
    toast.success("Confirmation email sent again.");
  }

  const loginHref = returnTo !== "/app" ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";

  return (
    <AuthLayout
      title={sentTo ? "Almost there" : "Create your Visualify account"}
      subtitle={sentTo ? null : "Turn study topics into editable visual notes."}
      footer={
        <>
          Already have an account?{" "}
          <Link to={loginHref} className={textLink}>
            Sign in
          </Link>
        </>
      }
    >
      {sentTo ? (
        <CheckEmail email={sentTo} onResend={resend} cooldown={cooldown} />
      ) : (
        <>
          <GoogleButton returnTo={returnTo} onError={setFormError} label="Sign up with Google" />
          <Divider label="or sign up with email" />
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Create account">
            <FormAlert>{formError}</FormAlert>
            <TextField
              label="Name"
              autoComplete="name"
              required
              error={errors.displayName?.message}
              {...register("displayName")}
            />
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              error={errors.email?.message}
              {...register("email")}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="new-password"
              required
              hint={`At least ${LIMITS.passwordMin} characters, including a letter and a number.`}
              error={errors.password?.message}
              {...register("password")}
            />
            <TextField
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              required
              error={errors.confirmPassword?.message}
              {...register("confirmPassword")}
            />
            <p className="text-xs text-stone-600">
              By creating an account you agree to the{" "}
              <Link to="/terms" className={textLink}>
                Terms
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className={textLink}>
                Privacy notice
              </Link>
              .
            </p>
            <Button type="submit" size="lg" className="w-full" loading={isSubmitting} loadingText="Creating account…">
              Create account
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
