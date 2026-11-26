import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BackToSettings, Card, PageHeader } from "../../components/Layout.jsx";
import { Button } from "../../components/Button.jsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";
import { Modal } from "../../components/Modal.jsx";
import { FormAlert, TextField } from "../../components/Field.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { useDeleteAccount } from "../../hooks/useProfile.js";
import { supabase } from "../../lib/supabase.js";
import { LIMITS, resetPasswordSchema } from "../../lib/schemas.js";
import { authErrorMessage } from "../../lib/authErrors.js";

function ChangePasswordForm() {
  const toast = useToast();
  const [formError, setFormError] = useState(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: "", confirmPassword: "" } });

  async function onSubmit({ password }) {
    setFormError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setFormError(authErrorMessage(error, "We couldn't change your password. Please try again."));
      return;
    }
    reset();
    toast.success("Password changed.");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Change password">
      <FormAlert>{formError}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${LIMITS.passwordMin} characters, including a letter and a number.`}
          error={errors.password?.message}
          {...register("password")}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isSubmitting} loadingText="Saving…">
          Change password
        </Button>
      </div>
    </form>
  );
}

export function AccountSettingsPage() {
  const { user, signOut } = useAuth();
  const deleteAccount = useDeleteAccount();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState(null);

  const providers = user?.app_metadata?.providers ?? (user?.app_metadata?.provider ? [user.app_metadata.provider] : []);
  const hasPasswordProvider = providers.length === 0 || providers.includes("email");

  async function handleDeleteAccount(e) {
    e.preventDefault();
    if (phrase.trim() !== "DELETE MY ACCOUNT") {
      setDeleteError('Type "DELETE MY ACCOUNT" exactly to confirm.');
      return;
    }
    setDeleteError(null);
    try {
      await deleteAccount.mutateAsync({
        confirmation: "DELETE MY ACCOUNT",
        ...(password ? { password } : {}),
      });
      await supabase?.auth?.signOut?.({ scope: "local" }).catch(() => {});
      setDeleteOpen(false);
      toast.info("Your account and all saved content have been deleted.");
      navigate("/", { replace: true });
    } catch (err) {
      setDeleteError(err.requestId ? `${err.message} (Reference: ${err.requestId})` : err.message);
    }
  }

  async function signOutEverywhere() {
    setPending(true);
    try {
      await signOut({ everywhere: true });
      toast.info("Signed out on all devices.");
      navigate("/login", { replace: true });
    } catch (err) {
      setPending(false);
      setConfirmOpen(false);
      toast.error(authErrorMessage(err, "We couldn't sign out other sessions. Please try again."));
    }
  }

  return (
    <>
      <BackToSettings />
      <PageHeader title="Account" description="Sign-in details and security." />
      <div className="space-y-6">
        <Card className="p-6" aria-labelledby="acct-email">
          <h2 id="acct-email" className="text-base font-semibold text-stone-900">
            Email
          </h2>
          <p className="mt-2 text-sm text-stone-800" data-testid="account-email">
            {user?.email ?? "—"}
          </p>
          {providers.length > 0 && (
            <p className="mt-1 text-xs text-stone-600">
              Sign-in methods: {providers.map((p) => (p === "email" ? "Email & password" : p[0].toUpperCase() + p.slice(1))).join(", ")}
            </p>
          )}
        </Card>

        <Card className="p-6" aria-labelledby="acct-password">
          <h2 id="acct-password" className="text-base font-semibold text-stone-900">
            Password
          </h2>
          <p className="mb-4 mt-1 text-sm text-stone-600">
            If you signed up with Google, this adds a password so you can also sign in with email.
          </p>
          <ChangePasswordForm />
        </Card>

        <Card className="p-6" aria-labelledby="acct-sessions">
          <h2 id="acct-sessions" className="text-base font-semibold text-stone-900">
            Sessions
          </h2>
          <p className="mt-1 text-sm text-stone-600">Sign out of Visualify on every device, including this one.</p>
          <Button variant="secondary" className="mt-4" onClick={() => setConfirmOpen(true)}>
            Sign out everywhere
          </Button>
        </Card>

        <Card className="border-red-200 p-6" aria-labelledby="acct-delete">
          <h2 id="acct-delete" className="text-base font-semibold text-red-700">
            Delete account
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Permanently deletes your profile, avatar, uploaded PDFs and images, saved notes, versions, and study history. This action cannot be undone.
          </p>
          <Button
            variant="dangerOutline"
            className="mt-4"
            onClick={() => {
              setPhrase("");
              setPassword("");
              setDeleteError(null);
              setDeleteOpen(true);
            }}
            data-testid="delete-account-open"
          >
            Delete account
          </Button>
        </Card>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => !deleteAccount.isPending && setDeleteOpen(false)}
        busy={deleteAccount.isPending}
        title="Permanently delete your account?"
        description="Every note, uploaded file, avatar, and quiz will be removed immediately."
        testId="delete-account-dialog"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleteAccount.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="delete-account-form"
              variant="danger"
              loading={deleteAccount.isPending}
              loadingText="Deleting…"
              disabled={phrase.trim() !== "DELETE MY ACCOUNT"}
              data-testid="delete-account-confirm"
            >
              Delete forever
            </Button>
          </>
        }
      >
        <form id="delete-account-form" onSubmit={handleDeleteAccount} noValidate className="space-y-4">
          <FormAlert>{deleteError}</FormAlert>
          <TextField
            label='Type "DELETE MY ACCOUNT" to confirm'
            placeholder="DELETE MY ACCOUNT"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
          />
          <TextField
            label={hasPasswordProvider ? "Current password" : "Current password (optional if recently signed in)"}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="Required for verification unless you signed in within the last 15 minutes."
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="Sign out everywhere?"
        description="You'll be signed out on all devices and browsers, including this one."
        confirmLabel="Sign out everywhere"
        tone="primary"
        loading={pending}
        onConfirm={signOutEverywhere}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
