import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Database,
  FileText,
  Image as ImageIcon,
  Landmark,
  Leaf,
  Network,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import clsx from "clsx";
import { Badge, Card, PageHeader } from "../../components/Layout.jsx";
import { Button } from "../../components/Button.jsx";
import { FormAlert, SelectField, TextAreaField, TextField } from "../../components/Field.jsx";
import { SegmentedControl } from "../../components/SegmentedControl.jsx";
import { Spinner } from "../../components/Spinner.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useProfile, useUsage } from "../../hooks/useProfile.js";
import { useCreateGeneration } from "../../hooks/useGenerationJob.js";
import { sourcesApi } from "../../lib/apiClient.js";
import {
  GENERATION_OPTIONS,
  GUIDANCE_MAX_CHARS,
  PROMPT_MAX_CHARS,
  generationRequestSchema,
  sourceGenerationSchema,
  toGenerationBody,
  toSourceGenerationBody,
} from "../../lib/schemas.js";
import {
  SOURCE_MAX_PDF_PAGES,
  formatBytes,
  parsePdfPageExpression,
  validateSourceFile,
} from "../../lib/sourceFiles.js";

const STARTERS = [
  { label: "TCP handshake", icon: Network, prompt: "Explain how the TCP three-way handshake establishes a connection.", subject: "Computer networks" },
  { label: "Photosynthesis", icon: Leaf, prompt: "Explain the light-dependent and light-independent stages of photosynthesis.", subject: "Biology" },
  { label: "SQL vs NoSQL", icon: Database, prompt: "Compare SQL and NoSQL databases: data model, scaling, consistency and typical use cases.", subject: "Databases" },
  { label: "French Revolution", icon: Landmark, prompt: "Give a timeline of the key events of the French Revolution from 1789 to 1799.", subject: "History" },
];

const DIAGRAM_HINTS = {
  auto: "Visualify picks the clearest visual format automatically.",
  flowchart: "Boxes, decision diamonds & directional arrows for processes.",
  sequence: "Actor lifelines & numbered message exchanges over time.",
  mindmap: "Central hero topic with balanced color-coded branches.",
  comparison: "Side-by-side columns with aligned dimensions & Key Takeaway.",
  timeline: "Chronological milestone cards along a progression axis.",
  er_diagram: "Database entities, typed attributes & cardinality links.",
  class_diagram: "Object classes, properties, methods & inheritance.",
};

function RemainingCounter({ value, max }) {
  const remaining = max - value.length;
  const over = remaining < 0;
  return (
    <span
      id="prompt-counter"
      className={clsx("text-xs tabular-nums", over ? "font-medium text-red-700" : remaining < 400 ? "text-amber-800" : "text-stone-500")}
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
  const [params] = useSearchParams();
  const toast = useToast();
  const { data: profile } = useProfile();
  const { data: usage } = useUsage();
  const create = useCreateGeneration();
  const prefs = profile?.preferences ?? {};
  const quotaExceeded = Boolean(usage && usage.remaining <= 0);

  const initialMode = ["prompt", "pdf", "image"].includes(params.get("mode")) ? params.get("mode") : "prompt";
  const [inputType, setInputType] = useState(initialMode);
  const [sourceFile, setSourceFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  // PDF page range state
  const [pageMode, setPageMode] = useState("all"); // "all" | "range" | "custom"
  const [startPage, setStartPage] = useState("1");
  const [endPage, setEndPage] = useState("1");
  const [customPages, setCustomPages] = useState("");
  const [pageError, setPageError] = useState(null);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(inputType === "prompt" ? generationRequestSchema : sourceGenerationSchema),
    defaultValues: {
      prompt: (params.get("prompt") ?? "").slice(0, PROMPT_MAX_CHARS),
      subject: "",
      audienceLevel: GENERATION_OPTIONS.audienceLevel.some(([v]) => v === prefs.learningLevel) ? prefs.learningLevel : "undergraduate",
      detail: "standard",
      visualStyle: "hand_drawn_clean",
      preferredOutput: "auto",
    },
  });

  const prompt = watch("prompt") ?? "";
  const selectedOutput = watch("preferredOutput") ?? "auto";
  const selectedDetail = watch("detail") ?? "standard";

  function applyStarter(starter) {
    setValue("prompt", starter.prompt, { shouldValidate: true, shouldDirty: true });
    setValue("subject", starter.subject, { shouldDirty: true });
  }

  async function handleModeChange(nextMode) {
    if (nextMode === inputType) return;
    if (sourceFile) {
      sourcesApi.remove(sourceFile.id).catch(() => {});
      setSourceFile(null);
    }
    setUploadError(null);
    setPageError(null);
    clearErrors();
    setInputType(nextMode);
  }

  async function handleFileSelected(file) {
    if (!file) return;
    const validationErr = validateSourceFile(file, inputType);
    if (validationErr) {
      setUploadError(validationErr);
      return;
    }
    setUploadError(null);
    setPageError(null);
    setUploading(true);
    try {
      if (sourceFile) {
        await sourcesApi.remove(sourceFile.id).catch(() => {});
      }
      const uploaded = await sourcesApi.upload(file);
      setSourceFile(uploaded);
      if (inputType === "pdf" && uploaded.pageCount) {
        const defaultAll = uploaded.pageCount <= SOURCE_MAX_PDF_PAGES;
        setPageMode(defaultAll ? "all" : "range");
        setStartPage("1");
        setEndPage(String(Math.min(uploaded.pageCount, 20)));
        setCustomPages(`1-${Math.min(uploaded.pageCount, 10)}`);
      }
    } catch (err) {
      setUploadError(err.requestId ? `${err.message} (Reference: ${err.requestId})` : err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function clearUploadedFile() {
    if (!sourceFile) return;
    const id = sourceFile.id;
    setSourceFile(null);
    setPageError(null);
    setUploadError(null);
    await sourcesApi.remove(id).catch(() => {});
  }

  function resolvePdfPageRange() {
    if (inputType !== "pdf" || !sourceFile) return { ok: true, value: null };
    const total = sourceFile.pageCount ?? 1;
    if (pageMode === "all") {
      if (total > SOURCE_MAX_PDF_PAGES) {
        return { ok: false, error: `This PDF has ${total} pages. Choose a range of up to ${SOURCE_MAX_PDF_PAGES} pages.` };
      }
      return { ok: true, value: { mode: "all" } };
    }
    if (pageMode === "range") {
      const s = Number(startPage);
      const e = Number(endPage);
      if (!Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e < s || e > total) {
        return { ok: false, error: `Enter a valid range between 1 and ${total}.` };
      }
      if (e - s + 1 > SOURCE_MAX_PDF_PAGES) {
        return { ok: false, error: `Select at most ${SOURCE_MAX_PDF_PAGES} pages per generation.` };
      }
      return { ok: true, value: { mode: "range", startPage: s, endPage: e } };
    }
    const parsed = parsePdfPageExpression(customPages, total, SOURCE_MAX_PDF_PAGES);
    if (!parsed.valid) return { ok: false, error: parsed.error };
    return { ok: true, value: { mode: "custom", pages: parsed.pages } };
  }

  const customPreview =
    inputType === "pdf" && sourceFile && pageMode === "custom"
      ? parsePdfPageExpression(customPages, sourceFile.pageCount ?? 1, SOURCE_MAX_PDF_PAGES)
      : null;

  function onSubmit(values) {
    let body;
    if (inputType === "prompt") {
      body = toGenerationBody(values);
    } else {
      if (!sourceFile) {
        setUploadError(`Upload a ${inputType === "pdf" ? "PDF document" : "JPEG, PNG or WebP image"} before generating.`);
        return;
      }
      const pageCheck = resolvePdfPageRange();
      if (!pageCheck.ok) {
        setPageError(pageCheck.error);
        return;
      }
      setPageError(null);
      body = toSourceGenerationBody({
        inputType,
        sourceFileId: sourceFile.id,
        pageRange: pageCheck.value,
        values,
      });
    }

    create.mutate(body, {
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

  const maxChars = inputType === "prompt" ? PROMPT_MAX_CHARS : GUIDANCE_MAX_CHARS;

  return (
    <>
      <PageHeader
        title="Create visual notes"
        description="Describe a topic, upload a PDF, or snap your study notes. Visualify plans the diagram and explains it."
      />

      <form onSubmit={handleSubmit(onSubmit)} noValidate aria-label="Create visual notes" className="space-y-6">
        <Card className="space-y-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label="Input source"
              testId="input-mode-switch"
              value={inputType}
              onChange={handleModeChange}
              options={[
                { value: "prompt", label: "Topic / Prompt", icon: Sparkles },
                { value: "pdf", label: "PDF Document", icon: FileText },
                { value: "image", label: "Image / Notes", icon: ImageIcon },
              ]}
            />
            {inputType !== "prompt" && (
              <span className="text-xs text-stone-600">
                {inputType === "pdf" ? "Up to 20 MB · 100 pages per visual" : "JPEG, PNG or WebP · up to 20 MB"}
              </span>
            )}
          </div>

          <FormAlert>{errors.root?.server?.message}</FormAlert>
          {quotaExceeded && (
            <div data-testid="quota-exceeded-banner">
              <FormAlert tone="error">
                Monthly AI quota reached ({usage.used} / {usage.limit}). Resets{" "}
                {new Date(usage.resetsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} (UTC).
              </FormAlert>
            </div>
          )}

          {inputType === "prompt" ? (
            <>
              <TextAreaField
                label="What do you want to understand?"
                rows={7}
                required
                placeholder="e.g. Explain how DNS resolves a domain name, step by step."
                counter={<RemainingCounter value={prompt} max={maxChars} />}
                error={errors.prompt?.message}
                {...register("prompt")}
              />
              <div>
                <p className="mb-2 text-sm font-medium text-stone-800" id="starters-label">
                  Or start from an example
                </p>
                <ul className="flex flex-wrap gap-2" aria-labelledby="starters-label">
                  {STARTERS.map((s) => {
                    const Icon = s.icon;
                    return (
                      <li key={s.label}>
                        <button
                          type="button"
                          onClick={() => applyStarter(s)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-surface px-3 py-1 text-sm text-stone-700 transition-colors hover:border-accent-600 hover:text-accent-800 active:scale-[0.98]"
                        >
                          <Icon className="h-3.5 w-3.5 text-accent-700" aria-hidden="true" />
                          {s.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          ) : (
            <div className="space-y-5">
              <FormAlert>{uploadError}</FormAlert>

              {!sourceFile ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFileSelected(file);
                  }}
                  className={clsx(
                    "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                    dragging ? "border-accent-700 bg-accent-50/60" : "border-stone-300 bg-canvas/50 hover:border-stone-400"
                  )}
                  data-testid="source-dropzone"
                >
                  <input
                    ref={fileInputRef}
                    id="source-file-input"
                    data-testid="source-file-input"
                    aria-label={inputType === "pdf" ? "Upload PDF document" : "Upload image of notes"}
                    type="file"
                    accept={inputType === "pdf" ? "application/pdf,.pdf" : "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"}
                    className="sr-only"
                    onChange={(e) => handleFileSelected(e.target.files?.[0])}
                  />
                  {uploading ? (
                    <div className="flex flex-col items-center gap-2 text-stone-700">
                      <Spinner label="Uploading source file" className="text-accent-700" />
                      <p className="text-sm font-medium">Validating and uploading…</p>
                    </div>
                  ) : (
                    <>
                      <div className="mb-3 rounded-full bg-accent-50 p-3 text-accent-700">
                        <Upload className="h-6 w-6" aria-hidden="true" />
                      </div>
                      <p className="text-sm font-medium text-stone-900">
                        {inputType === "pdf" ? "Drop a PDF document here" : "Drop a photo or screenshot of your notes here"}
                      </p>
                      <p className="mt-1 text-xs text-stone-600">
                        {inputType === "pdf"
                          ? "Digital or scanned PDFs up to 20 MB."
                          : "EXIF orientation is auto-corrected and metadata is stripped automatically."}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mt-4"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Choose {inputType === "pdf" ? "PDF" : "image"}
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-4 rounded-xl border border-stone-200 bg-canvas/60 p-4" data-testid="uploaded-source-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {sourceFile.previewUrl ? (
                        <img
                          src={sourceFile.previewUrl}
                          alt={`Preview of ${sourceFile.originalName}`}
                          className="h-16 w-20 shrink-0 rounded-lg border border-stone-200 bg-surface object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-surface text-accent-700">
                          <FileText className="h-6 w-6" aria-hidden="true" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-stone-900">{sourceFile.originalName}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
                          <span>{formatBytes(sourceFile.sizeBytes)}</span>
                          {sourceFile.pageCount && <Badge tone="accent">{sourceFile.pageCount} pages</Badge>}
                          {sourceFile.width && sourceFile.height && (
                            <Badge tone="neutral">
                              {sourceFile.width} × {sourceFile.height}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={clearUploadedFile}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Remove
                    </Button>
                  </div>

                  {inputType === "pdf" && sourceFile.pageCount && (
                    <div className="space-y-3 border-t border-stone-200 pt-4" data-testid="pdf-page-selector">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-stone-800">Pages to include</span>
                        <SegmentedControl
                          label="PDF page selection mode"
                          size="sm"
                          value={pageMode}
                          onChange={(m) => {
                            setPageMode(m);
                            setPageError(null);
                          }}
                          options={[
                            {
                              value: "all",
                              label: sourceFile.pageCount > SOURCE_MAX_PDF_PAGES ? `All (${sourceFile.pageCount} > 100)` : `All (${sourceFile.pageCount})`,
                              disabled: sourceFile.pageCount > SOURCE_MAX_PDF_PAGES,
                            },
                            { value: "range", label: "Page range" },
                            { value: "custom", label: "Specific pages" },
                          ]}
                        />
                      </div>

                      {pageMode === "range" && (
                        <div className="grid max-w-sm grid-cols-2 gap-3">
                          <TextField
                            label="From page"
                            type="number"
                            min={1}
                            max={sourceFile.pageCount}
                            value={startPage}
                            onChange={(e) => {
                              setStartPage(e.target.value);
                              setPageError(null);
                            }}
                          />
                          <TextField
                            label="To page"
                            type="number"
                            min={1}
                            max={sourceFile.pageCount}
                            value={endPage}
                            onChange={(e) => {
                              setEndPage(e.target.value);
                              setPageError(null);
                            }}
                          />
                        </div>
                      )}

                      {pageMode === "custom" && (
                        <TextField
                          label="Pages and ranges"
                          placeholder="e.g. 1-5, 8, 12-15"
                          hint={
                            customPreview?.valid
                              ? `${customPreview.pages.length} ${customPreview.pages.length === 1 ? "page" : "pages"} selected.`
                              : `Enter numbers or ranges between 1 and ${sourceFile.pageCount} (max 100 pages).`
                          }
                          value={customPages}
                          onChange={(e) => {
                            setCustomPages(e.target.value);
                            setPageError(null);
                          }}
                        />
                      )}

                      <FormAlert>{pageError}</FormAlert>
                    </div>
                  )}
                </div>
              )}

              <TextAreaField
                label="What should Visualify focus on? (optional)"
                rows={3}
                placeholder={
                  inputType === "pdf"
                    ? "e.g. Focus on the consensus algorithm and compare leader vs follower states."
                    : "e.g. Turn these whiteboard notes into a clean sequence diagram."
                }
                counter={<RemainingCounter value={prompt} max={maxChars} />}
                error={errors.prompt?.message}
                {...register("prompt")}
              />
            </div>
          )}
        </Card>

        <Card className="p-6" aria-labelledby="settings-heading">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 id="settings-heading" className="text-base font-semibold text-stone-900">
              Settings
            </h2>
            <span className="text-xs text-stone-600">
              {selectedDetail === "brief" ? "1 focused diagram" : selectedDetail === "detailed" ? "2–3 deep diagrams" : "1–2 balanced diagrams"}
            </span>
          </div>
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
              hint={DIAGRAM_HINTS[selectedOutput] ?? "Visualify picks the best fit unless you choose one."}
              error={errors.preferredOutput?.message}
              {...register("preferredOutput")}
            >
              <Options items={GENERATION_OPTIONS.preferredOutput} />
            </SelectField>
          </div>
        </Card>

        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-stone-600">
            {inputType === "prompt"
              ? "Your prompt is sent to our AI provider to plan the visual. Generation usually takes under a minute."
              : "Your uploaded file stays in private storage and only selected pages or sanitized images are processed."}
          </p>
          <Button type="submit" size="lg" loading={create.isPending} disabled={uploading || quotaExceeded} loadingText="Starting…">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Generate visual
          </Button>
        </div>
      </form>
    </>
  );
}
