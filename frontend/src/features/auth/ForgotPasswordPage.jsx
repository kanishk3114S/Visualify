import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { AuthLayout, textLink } from "./AuthLayout.jsx";
import { Button } from "../../components/Button.jsx";
import { FormAlert, TextField } from "../../components/Field.jsx";
import { supabase } from "../../lib/supabase.js";
import { forgotPasswordSchema } from "../../lib/schemas.js";
import { authErrorMessage } from "../../lib/authErrors.js";

export function ForgotPasswordPage() {
  const [formError, setFormError] = useState(null);
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  async function onSubmit({ email }) {
    setFormError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // Only surface transport/rate-limit problems; never reveal whether the email exists.
    if (error && (error.status === 429 || error.status === 0 || error.name === "AuthRetryableFetchError")) {
      setFormError(authErrorMessage(error));
      return;
    }
    setSent(true);
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={sent ? null : "Enter your account email and we'll send you a reset link."}
      footer={
        <Link to="/login" className={textLink}>
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-3 text-center" role="status" data-testid="reset-email-sent">
          <MailCheck className="mx-auto h-10 w-10 text-accent-700" aria-hidden="true" />
          <p className="text-sm text-stone-700">
            If an account exists for that address, a reset link is on its way. Open it in this browser to choose a new
            password.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Request password reset">
          <FormAlert>{formError}</FormAlert>
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            error={errors.email?.message}
            {...register("email")}
          />
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting} loadingText="Sending…">
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
