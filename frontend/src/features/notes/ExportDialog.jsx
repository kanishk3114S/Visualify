import { useEffect, useId, useState } from "react";
import clsx from "clsx";
import { Download } from "lucide-react";
import { Modal } from "../../components/Modal.jsx";
import { Button } from "../../components/Button.jsx";
import { FormAlert, SelectField } from "../../components/Field.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useProfile } from "../../hooks/useProfile.js";
import { useExportNote } from "../../hooks/useNotes.js";

const FORMATS = [
  { value: "png", label: "PNG image", hint: "For slides, documents and sharing" },
  { value: "svg", label: "SVG vector", hint: "Sharp at any size" },
  { value: "excalidraw", label: "Excalidraw file", hint: "Editable .excalidraw scene" },
  { value: "zip", label: "All slides (.zip)", hint: "Ordered PNG or SVG slide deck" },
];

/** Starts a browser download from a signed URL served with Content-Disposition: attachment. */
export function triggerDownload(url) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function RadioGroup({ legend, name, value, onChange, options, disabled }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium text-stone-800">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const itemDisabled = disabled || o.disabled;
          return (
            <label
              key={o.value}
              className={clsx(
                "flex flex-col rounded-lg border px-3 py-2.5 text-sm transition-colors",
                itemDisabled ? "cursor-not-allowed opacity-55" : "cursor-pointer",
                value === o.value ? "border-accent-700 bg-accent-50" : "border-stone-200 hover:border-stone-300"
              )}
            >
              <span className="flex items-center gap-2 font-medium text-stone-900">
                <input
                  type="radio"
                  name={name}
                  value={o.value}
                  checked={value === o.value}
                  disabled={itemDisabled}
                  onChange={() => !itemDisabled && onChange(o.value)}
                  className="accent-accent-700"
                />
                {o.label}
              </span>
              {o.hint && <span className="mt-0.5 pl-5 text-xs text-stone-600">{o.hint}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * PNG / SVG / .excalidraw / ZIP export (FR-EXP-01..05). Supports full scene,
 * single-frame/section, and selected element IDs scope.
 */
export function ExportDialog({ open, onClose, note, frames = [], selectedElements = [], beforeExport }) {
  const { data: profile } = useProfile();
  const exportNote = useExportNote();
  const toast = useToast();
  const name = useId();
  const [format, setFormat] = useState("png");
  const [theme, setTheme] = useState("light");
  const [transparent, setTransparent] = useState(false);
  const [scope, setScope] = useState("full");
  const [frameId, setFrameId] = useState("");
  const [slideFormat, setSlideFormat] = useState("png");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const selectableFrames = frames.filter((f) => f.frameId || f.sectionId);
  const selectableElementIds = (selectedElements ?? [])
    .filter((el) => el && !el.isDeleted && el.type !== "frame" && typeof el.id === "string")
    .slice(0, 200)
    .map((el) => el.id);

  useEffect(() => {
    if (open) {
      const preferred = profile?.preferences?.defaultExportFormat;
      setFormat(FORMATS.some((f) => f.value === preferred) ? preferred : "png");
      setScope(selectableElementIds.length > 0 ? "selection" : "full");
      const firstId = selectableFrames[0]?.frameId ?? selectableFrames[0]?.sectionId ?? "";
      setFrameId(firstId);
      setError(null);
      setResult(null);
    }
  }, [open, profile?.preferences?.defaultExportFormat]);

  const isZip = format === "zip";
  const isImage = format !== "excalidraw";
  const busy = exportNote.isPending;

  useEffect(() => {
    if (isZip && scope === "selection") {
      setScope("full");
    }
  }, [isZip, scope]);

  async function run() {
    setError(null);
    setResult(null);
    try {
      await beforeExport?.();
    } catch {
      setError("Your latest changes couldn't be saved, so the export was not started. Try again.");
      return;
    }
    const useSelection = !isZip && scope === "selection" && selectableElementIds.length > 0;
    const useFrame = !isZip && !useSelection && scope === "frame" && frameId;
    const resolvedScope = useSelection ? "selection" : useFrame ? "frame" : "full";
    exportNote.mutate(
      {
        id: note.id,
        format,
        theme,
        transparent: isImage && transparent,
        scope: resolvedScope,
        ...(useFrame ? { frameId } : {}),
        ...(useSelection ? { elementIds: selectableElementIds } : {}),
        ...(isZip ? { slideFormat } : {}),
      },
      {
        onSuccess: (exp) => {
          setResult(exp);
          if (exp.downloadUrl) triggerDownload(exp.downloadUrl);
          toast.success(`${FORMATS.find((f) => f.value === format).label} ready - downloading.`);
        },
        onError: (err) => setError(err.requestId ? `${err.message} (Reference: ${err.requestId})` : err.message),
      }
    );
  }

  const activeFrameTitle = selectableFrames.find((f) => (f.frameId ?? f.sectionId) === frameId)?.title ?? "Selected slide";
  const includedSummary = isZip
    ? `All ${Math.max(1, frames.length)} slides rendered as ${slideFormat.toUpperCase()} (${theme}) plus manifest.json.`
    : scope === "selection" && selectableElementIds.length > 0
      ? `${selectableElementIds.length} selected element(s) and their bound labels rendered as ${isImage ? `${theme} ${format.toUpperCase()}` : ".excalidraw JSON"}.`
      : scope === "frame" && selectableFrames.length > 0
        ? `Slide "${activeFrameTitle}" rendered as ${isImage ? `${theme} ${format.toUpperCase()}` : ".excalidraw JSON"}.`
        : `Full note canvas (${Math.max(1, frames.length)} section(s)) rendered as ${isImage ? `${theme} ${format.toUpperCase()}` : ".excalidraw JSON"}.`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title="Export"
      description={note?.title}
      size="lg"
      testId="export-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button onClick={run} loading={busy} loadingText="Exporting…" data-testid="export-submit">
            <Download className="h-4 w-4" aria-hidden="true" />
            Export
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormAlert>{error}</FormAlert>
        <RadioGroup legend="Format" name={`${name}-format`} value={format} onChange={setFormat} options={FORMATS} disabled={busy} />

        {!isZip && (selectableFrames.length > 0 || selectableElementIds.length > 0) && (
          <div className="space-y-3 rounded-lg border border-stone-200 bg-canvas/60 p-3">
            <RadioGroup
              legend="Include"
              name={`${name}-scope`}
              value={scope}
              onChange={setScope}
              disabled={busy}
              options={[
                { value: "full", label: "Full scene", hint: "Entire note canvas" },
                ...(selectableFrames.length > 0
                  ? [{ value: "frame", label: "Single slide / section", hint: `${selectableFrames.length} available` }]
                  : []),
                {
                  value: "selection",
                  label: "Current selection",
                  hint:
                    selectableElementIds.length > 0
                      ? `${selectableElementIds.length} element${selectableElementIds.length === 1 ? "" : "s"} selected`
                      : "Select elements on canvas first",
                  disabled: selectableElementIds.length === 0,
                },
              ]}
            />
            {scope === "frame" && (
              <SelectField
                label="Slide / section"
                value={frameId}
                disabled={busy}
                onChange={(e) => setFrameId(e.target.value)}
              >
                {selectableFrames.map((f) => {
                  const id = f.frameId ?? f.sectionId;
                  return (
                    <option key={id} value={id}>
                      {f.title}
                    </option>
                  );
                })}
              </SelectField>
            )}
          </div>
        )}

        {isZip && (
          <RadioGroup
            legend="Slide image format inside ZIP"
            name={`${name}-slide-format`}
            value={slideFormat}
            onChange={setSlideFormat}
            disabled={busy}
            options={[
              { value: "png", label: "PNG slides", hint: "Best for presentations" },
              { value: "svg", label: "SVG slides", hint: "Crisp vector graphics" },
            ]}
          />
        )}

        <RadioGroup
          legend="Diagram theme"
          name={`${name}-theme`}
          value={theme}
          onChange={setTheme}
          disabled={busy || !isImage}
          options={[
            { value: "light", label: "Light", hint: "Dark ink on white" },
            { value: "dark", label: "Dark", hint: "Light ink on dark" },
          ]}
        />
        <label className={clsx("flex items-center gap-2 text-sm text-stone-800", !isImage && "opacity-60")}>
          <input type="checkbox" checked={isImage && transparent} disabled={busy || !isImage} onChange={(e) => setTransparent(e.target.checked)} className="h-4 w-4 accent-accent-700" />
          Transparent background
        </label>
        <div className="rounded-lg border border-stone-200 bg-canvas/60 px-3 py-2 text-xs text-stone-700" data-testid="export-included-summary">
          <span className="font-semibold text-stone-900">What is included: </span>
          {includedSummary}
        </div>
        <p className="text-xs text-stone-600">
          {isZip
            ? `Exports ${Math.max(1, frames.length)} ordered slides plus manifest.json in a ZIP archive.`
            : isImage
              ? "The diagram theme only affects the exported file, not how Visualify looks."
              : "The .excalidraw file opens in Excalidraw with every element editable."}
        </p>
        {result?.downloadUrl && (
          <FormAlert tone="success">
            Export ready.{" "}
            <a href={result.downloadUrl} rel="noopener" className="font-medium underline" data-testid="export-download-link">
              Download again
            </a>{" "}
            (link valid for 10 minutes)
          </FormAlert>
        )}
      </div>
    </Modal>
  );
}
