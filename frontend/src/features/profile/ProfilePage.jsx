import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AvatarUploader } from "./AvatarUploader.jsx";
import { ProfileLoadError } from "./ProfileLoadError.jsx";
import { Card, PageHeader } from "../../components/Layout.jsx";
import { Button } from "../../components/Button.jsx";
import { CharCounter, FormAlert, TextAreaField, TextField } from "../../components/Field.jsx";
import { Spinner } from "../../components/Spinner.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useProfile, useUpdateProfile } from "../../hooks/useProfile.js";
import { LIMITS, profileSchema } from "../../lib/schemas.js";

const toFormValues = (p) => ({ display_name: p?.display_name ?? "", username: p?.username ?? "", bio: p?.bio ?? "" });

function ProfileForm({ profile }) {
  const update = useUpdateProfile();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isDirty, dirtyFields },
  } = useForm({ resolver: zodResolver(profileSchema), defaultValues: toFormValues(profile) });

  // Keep the form in sync with server data unless the user is mid-edit.
  useEffect(() => {
    if (!isDirty) reset(toFormValues(profile));
  }, [profile, isDirty, reset]);

  function onSubmit(values) {
    // Send only the fields that changed.
    const patch = Object.fromEntries(Object.keys(dirtyFields).map((k) => [k, values[k]]));
    update.mutate(patch, {
      onSuccess: (saved) => {
        reset(toFormValues(saved));
        toast.success("Profile saved.");
      },
      onError: (err) => {
        if (err.code === "USERNAME_TAKEN") {
          setError("username", { message: "That username is already taken." }, { shouldFocus: true });
          return;
        }
        if (err.code === "VALIDATION_ERROR" && Array.isArray(err.details)) {
          let mapped = false;
          for (const d of err.details) {
            if (d.field && d.field in values) {
              setError(d.field, { message: d.message });
              mapped = true;
            }
          }
          if (mapped) return;
        }
        setError("root.server", { message: err.message });
      },
    });
  }

  const bio = watch("bio");

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5" aria-label="Profile details">
      <FormAlert>{errors.root?.server?.message}</FormAlert>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Display name" autoComplete="name" error={errors.display_name?.message} {...register("display_name")} />
        <TextField
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          hint="3-30 characters: letters, numbers or underscores."
          error={errors.username?.message}
          {...register("username")}
        />
      </div>
      <TextAreaField
        label="Bio"
        rows={4}
        hint="Optional. A sentence about what you're studying."
        counter={<CharCounter value={bio} max={LIMITS.bioMax} />}
        error={errors.bio?.message}
        {...register("bio")}
      />
      <div className="flex items-center justify-end gap-2 border-t border-stone-100 pt-5">
        <Button variant="ghost" onClick={() => reset(toFormValues(profile))} disabled={!isDirty || update.isPending}>
          Discard changes
        </Button>
        <Button type="submit" disabled={!isDirty} loading={update.isPending} loadingText="Saving…">
          Save changes
        </Button>
      </div>
    </form>
  );
}

export function ProfilePage() {
  const { data: profile, isPending, isError, error, refetch } = useProfile();

  return (
    <>
      <PageHeader title="Profile" description="How you appear in Visualify." />
      {isPending && (
        <div className="flex items-center gap-3 py-10 text-stone-600">
          <Spinner label="Loading profile" className="text-accent-700" />
          <span aria-hidden="true">Loading profile…</span>
        </div>
      )}
      {isError && <ProfileLoadError onRetry={refetch} error={error} />}
      {profile && (
        <div className="space-y-6">
          <Card className="p-6">
            <AvatarUploader profile={profile} />
          </Card>
          <Card className="p-6">
            <ProfileForm profile={profile} />
          </Card>
        </div>
      )}
    </>
  );
}
