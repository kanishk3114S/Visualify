import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthLayout, Divider, textLink } from "./AuthLayout.jsx";
import { GoogleButton } from "./GoogleButton.jsx";
import { useCooldown } from "./useResendCooldown.js";
import { Button } from "../../components/Button.jsx";
import { FormAlert, TextField } from "../../components/Field.jsx";
import { useToast } from "../../components/Toast.jsx";
import { supabase } from "../../lib/supabase.js";
import { loginSchema } from "../../lib/schemas.js";
import { authErrorMessage } from "../../lib/authErrors.js";
import { sanitizeReturnTo } from "../../lib/returnTo.js";

export function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = sanitizeReturnTo(params.get("returnTo"));
  const [formError, setFormError] = useState(null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState(null);
  const cooldown = useCooldown(60);
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  async function onSubmit(values) {
    setFormError(null);
    setUnconfirmedEmail(null);
    const { error } = await supabase.auth.signInWithPassword({ email: values.email, password: values.password });
    if (error) {
      setFormError(authErrorMessage(error));
      if (error.code === "email_not_confirmed") setUnconfirmedEmail(values.email);
    }
    // Success: AuthProvider receives SIGNED_IN and PublicOnlyRoute redirects to returnTo.
  }

  async function resendConfirmation() {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: unconfirmedEmail,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    cooldown.start();
    toast.success("If that address needs confirming, a new link is on its way.");
  }

  const signupHref = returnTo !== "/app" ? `/signup?returnTo=${encodeURIComponent(returnTo)}` : "/signup";

  return (
    <AuthLayout
      title="Sign in to Visualify"
      subtitle="Pick up where you left off with your visual notes."
      footer={
        <>
          New to Visualify?{" "}
          <Link to={signupHref} className={textLink}>
            Create an account
          </Link>
        </>
      }
    >
      <GoogleButton returnTo={returnTo} onError={setFormError} />
      <Divider label="or sign in with email" />

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Sign in">
        <FormAlert>{formError}</FormAlert>
        {unconfirmedEmail && (
          <Button variant="secondary" size="sm" onClick={resendConfirmation} disabled={cooldown.remaining > 0}>
            {cooldown.remaining > 0 ? `Resend available in ${cooldown.remaining}s` : "Resend confirmation email"}
          </Button>
        )}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          error={errors.email?.message}
          {...register("email")}
        />
        <div className="space-y-1.5">
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            error={errors.password?.message}
            {...register("password")}
          />
          <div className="text-right">
            <Link to="/forgot-password" className={`text-sm ${textLink}`}>
              Forgot password?
            </Link>
          </div>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting} loadingText="Signing in…">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
