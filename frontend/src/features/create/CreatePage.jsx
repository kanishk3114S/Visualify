import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Sparkles } from "lucide-react";
import clsx from "clsx";
import { Card, PageHeader } from "../../components/Layout.jsx";
import { Button } from "../../components/Button.jsx";
import { FormAlert, SelectField, TextAreaField, TextField } from "../../components/Field.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useProfile } from "../../hooks/useProfile.js";
import { useCreateGeneration } from "../../hooks/useGenerationJob.js";
import { GENERATION_OPTIONS, PROMPT_MAX_CHARS, generationRequestSchema, toGenerationBody } from "../../lib/schemas.js";

const STARTERS = [
  { label: "TCP handshake", prompt: "Explain how the TCP three-way handshake establishes a connection.", subject: "Computer networks" },
  { label: "Photosynthesis", prompt: "Explain the light-dependent and light-independent stages of photosynthesis.", subject: "Biology" },
  { label: "SQL vs NoSQL", prompt: "Compare SQL and NoSQL databases: data model, scaling, consistency and typical use cases.", subject: "Databases" },
  { label: "French Revolution", prompt: "Give a timeline of the key events of the French Revolution from 1789 to 1799.", subject: "History" },
];

function RemainingCounter({ value }) {
  const remaining = PROMPT_MAX_CHARS - value.length;
  const over = remaining < 0;
  return (
    <span
      id="prompt-counter"
      className={clsx("text-xs tabular-nums", over ? "font-medium text-red-700" : remaining < 500 ? "text-amber-800" : "text-stone-500")}
      aria-live="polite"
    >
      {over
        ? `${Math.abs(remaining).toLocaleString("en-US")} characters over the limit`
        : `${remaining.toLocaleString("en-US")} characters left`}
    </span>
  );
}

const Options = ({ items }) => items.map(([value, label]) => <option key={value} value={value}>{label}</option>);

export function CreatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: profile } = useProfile();
  const create = useCreateGeneration();
  const prefs = profile?.preferences ?? {};

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(generationRequestSchema),
    defaultValues: {
      prompt: "",
      subject: "",
      audienceLevel: GENERATION_OPTIONS.audienceLevel.some(([v]) => v === prefs.learningLevel) ? prefs.learningLevel : "undergraduate",
      detail: "standard",
      visualStyle: "hand_drawn_clean",
      preferredOutput: "auto",
    },
  });

  const prompt = watch("prompt") ?? "";

  function applyStarter(starter) {
    setValue("prompt", starter.prompt, { shouldValidate: true, shouldDirty: true });
    setValue("subject", starter.subject, { shouldDirty: true });
  }

  function onSubmit(values) {
    create.mutate(toGenerationBody(values), {
      onSuccess: (data) => navigate(`/app/generations/${data.jobId}`),
      onError: (err) => {
        if (err.code === "ACTIVE_JOB_EXISTS" && err.details?.activeJobId) {
          toast.info("You already have a visual in progress. Showing it now.");
          navigate(`/app/generations/${err.details.activeJobId}`);
          return;
        }
        if (err.code === "VALIDATION_ERROR" && Array.isArray(err.details)) {
          for (const d of err.details) {
            const field = d.field?.replace(/^settings\./, "");
            if (field && field in values) setError(field, { message: d.message });
          }
          return;
        }
        setError("root.server", { message: err.requestId ? `${err.message} (Reference: ${err.requestId})` : err.message });
      },
    });
  }

  return (
    <>
      <PageHeader title="Create visual notes" description="Describe a topic, ask a question or paste your notes. Visualify plans the diagram and explains it." />

      <form onSubmit={handleSubmit(onSubmit)} noValidate aria-label="Create visual notes" className="space-y-6">
        <Card className="space-y-5 p-6">
          <FormAlert>{errors.root?.server?.message}</FormAlert>
          <TextAreaField
            label="What do you want to understand?"
            rows={7}
            required
            placeholder="e.g. Explain how DNS resolves a domain name, step by step."
            counter={<RemainingCounter value={prompt} />}
            error={errors.prompt?.message}
            {...register("prompt")}
          />
          <div>
            <p className="mb-2 text-sm font-medium text-stone-800" id="starters-label">
              Or start from an example
            </p>
            <ul className="flex flex-wrap gap-2" aria-labelledby="starters-label">
              {STARTERS.map((s) => (
                <li key={s.label}>
                  <button
                    type="button"
                    onClick={() => applyStarter(s)}
                    className="rounded-full border border-stone-300 bg-white px-3 py-1 text-sm text-stone-700 hover:border-accent-600 hover:text-accent-800"
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="p-6" aria-labelledby="settings-heading">
          <h2 id="settings-heading" className="mb-4 text-base font-semibold text-stone-900">
            Settings
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label="Subject (optional)" placeholder="e.g. Computer networks" error={errors.subject?.message} {...register("subject")} />
            <SelectField label="Learning level" error={errors.audienceLevel?.message} {...register("audienceLevel")}>
              <Options items={GENERATION_OPTIONS.audienceLevel} />
            </SelectField>
            <SelectField label="Depth" error={errors.detail?.message} {...register("detail")}>
              <Options items={GENERATION_OPTIONS.detail} />
            </SelectField>
            <SelectField label="Visual style" error={errors.visualStyle?.message} {...register("visualStyle")}>
              <Options items={GENERATION_OPTIONS.visualStyle} />
            </SelectField>
            <SelectField
              label="Diagram type"
              hint="Visualify picks the best fit unless you choose one."
              error={errors.preferredOutput?.message}
              {...register("preferredOutput")}
            >
              <Options items={GENERATION_OPTIONS.preferredOutput} />
            </SelectField>
          </div>
        </Card>

        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-stone-600">
            Your prompt is sent to our AI provider to plan the visual. Generation usually takes under a minute.
          </p>
          <Button type="submit" size="lg" loading={create.isPending} loadingText="Starting…">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Generate visual
          </Button>
        </div>
      </form>
    </>
  );
}
