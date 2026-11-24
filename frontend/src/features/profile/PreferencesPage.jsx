import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ProfileLoadError } from "./ProfileLoadError.jsx";
import { BackToSettings, Card, PageHeader } from "../../components/Layout.jsx";
import { Button } from "../../components/Button.jsx";
import { FormAlert, SelectField } from "../../components/Field.jsx";
import { Spinner } from "../../components/Spinner.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useProfile, useUpdateProfile } from "../../hooks/useProfile.js";
import { preferencesSchema } from "../../lib/schemas.js";

const LEVELS = [
  ["school", "School"],
  ["undergraduate", "Undergraduate"],
  ["postgraduate", "Postgraduate"],
  ["professional", "Professional"],
];
const FORMATS = [
  ["png", "PNG image"],
  ["svg", "SVG vector"],
  ["excalidraw", "Excalidraw file (.excalidraw)"],
];

const toValues = (p) => ({
  learningLevel: p?.preferences?.learningLevel ?? "undergraduate",
  defaultExportFormat: p?.preferences?.defaultExportFormat ?? "png",
});

export function PreferencesPage() {
  const { data: profile, isPending, isError, error, refetch } = useProfile();
  const update = useUpdateProfile();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(preferencesSchema), defaultValues: toValues(profile) });

  useEffect(() => {
    if (profile && !isDirty) reset(toValues(profile));
  }, [profile, isDirty, reset]);

  function onSubmit(values) {
    update.mutate(
      { preferences: values },
      {
        onSuccess: (saved) => {
          reset(toValues(saved));
          toast.success("Preferences saved.");
        },
        onError: (err) => setError("root.server", { message: err.message }),
      }
    );
  }

  return (
    <>
      <BackToSettings />
      <PageHeader title="Preferences" description="Defaults for the visual notes you'll create." />
      {isPending && <Spinner label="Loading preferences" className="text-accent-700" />}
      {isError && <ProfileLoadError onRetry={refetch} error={error} />}
      {profile && (
        <Card className="p-6">
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5" aria-label="Preferences">
            <FormAlert>{errors.root?.server?.message}</FormAlert>
            <FormAlert tone="info">
              These defaults are saved to your account now and will be applied when visual note creation and exports
              launch.
            </FormAlert>
            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField label="Learning level" hint="Sets how detailed explanations are." error={errors.learningLevel?.message} {...register("learningLevel")}>
                {LEVELS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Default export format" error={errors.defaultExportFormat?.message} {...register("defaultExportFormat")}>
                {FORMATS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="flex justify-end border-t border-stone-100 pt-5">
              <Button type="submit" disabled={!isDirty} loading={update.isPending} loadingText="Saving…">
                Save preferences
              </Button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
