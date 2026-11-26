import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge, Card, PageHeader } from "../../components/Layout.jsx";
import { Button, ButtonLink } from "../../components/Button.jsx";
import { SegmentedControl } from "../../components/SegmentedControl.jsx";
import { Spinner } from "../../components/Spinner.jsx";
import { adminApi } from "../../lib/apiClient.js";

const RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function formatPercent(ratio) {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatLatency(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function formatUsd(usd) {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return "—";
  return `$${usd.toFixed(4)}`;
}

/**
 * Admin-only aggregated PRD §14.1 launch metrics view.
 * Direct navigation by non-admin accounts receives a 403 from /api/v1/admin/metrics
 * and renders a clean denied state without exposing internal errors.
 */
export function AdminMetricsPage() {
  const [days, setDays] = useState("30");
  const [anchorMs, setAnchorMs] = useState(() => Date.now());

  const window = useMemo(() => {
    const spanDays = Number(days) || 30;
    const to = new Date(anchorMs).toISOString();
    const from = new Date(anchorMs - spanDays * DAY_MS).toISOString();
    return { from, to };
  }, [days, anchorMs]);

  const query = useQuery({
    queryKey: ["admin", "metrics", days, anchorMs],
    queryFn: ({ signal }) => adminApi.metrics({ ...window, signal }),
    retry: (failureCount, error) => error?.status !== 403 && failureCount < 1,
  });

  if (query.isError && query.error?.status === 403) {
    return (
      <div className="space-y-6 animate-fade-up" data-testid="admin-metrics-forbidden">
        <PageHeader
          title="Administrator access required"
          description="Product metrics are restricted to Visualify operators."
          actions={
            <ButtonLink to="/app" variant="secondary">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to dashboard
            </ButtonLink>
          }
        />
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
            <div className="space-y-1 text-sm text-stone-700">
              <p className="font-medium text-stone-900">Your account does not have administrator permissions.</p>
              <p>If you expected operator access, ask an owner to add your user ID to the server admin allowlist.</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const metrics = query.data?.metrics ?? {};
  const counts = query.data?.counts ?? {};
  const p50 = metrics.timeToFirstUsefulVisualMs?.p50 ?? null;
  const p95 = metrics.timeToFirstUsefulVisualMs?.p95 ?? null;

  const tiles = [
    {
      label: "Activation rate (24h)",
      value: formatPercent(metrics.activationRate),
      target: "Target >= 50%",
      detail: `${counts.activatedUsers ?? 0} of ${counts.signups ?? 0} signups generated and saved`,
    },
    {
      label: "Generation completion",
      value: formatPercent(metrics.generationCompletionRate),
      target: "Target >= 92%",
      detail: `${counts.generationCompleted ?? 0} completed (excluding ${counts.generationCancelled ?? 0} cancelled)`,
    },
    {
      label: "Time to first visual",
      value: p50 !== null ? `${formatLatency(p50)} p50` : "—",
      target: "Target < 12s p50 / < 25s p95",
      detail: p95 !== null ? `p95: ${formatLatency(p95)}` : "No completed jobs in window",
    },
    {
      label: "Save rate",
      value: formatPercent(metrics.saveRate),
      target: "Target >= 65%",
      detail: `${counts.notesSaved ?? 0} saved across ${counts.generationCompleted ?? 0} completed jobs`,
    },
    {
      label: "7-day library return",
      value: formatPercent(metrics.sevenDayLibraryReturnRate),
      target: "Target >= 35%",
      detail: `${counts.returnUsers ?? 0} of ${counts.returnEligibleUsers ?? 0} note savers reopened`,
    },
    {
      label: "Export rate",
      value: formatPercent(metrics.exportRate),
      target: "Target >= 30%",
      detail: `${counts.notesExported ?? 0} saved notes exported`,
    },
    {
      label: "Edit engagement",
      value: formatPercent(metrics.editEngagementRate),
      target: "Target >= 25%",
      detail: `${counts.notesEdited ?? 0} saved notes customized`,
    },
    {
      label: "Regeneration rate",
      value: formatPercent(metrics.regenerationRate),
      target: "Target < 25%",
      detail: `${counts.generationRepaired ?? 0} repaired + ${counts.regenerationActions ?? 0} retries/section regens`,
    },
    {
      label: "Cost per visual (est.)",
      value: formatUsd(metrics.costPerCompletedVisualUsd),
      target: "Model token estimate",
      detail: `${(counts.promptTokens ?? 0).toLocaleString()} in / ${(counts.outputTokens ?? 0).toLocaleString()} out tokens`,
    },
  ];

  return (
    <div className="space-y-8 animate-fade-up" data-testid="admin-metrics-page">
      <PageHeader
        title="Launch metrics"
        description="Aggregated PRD §14.1 product telemetry computed without storing prompts, emails, or file names."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              label="Reporting window"
              options={RANGE_OPTIONS}
              value={days}
              onChange={(next) => {
                setDays(next);
                setAnchorMs(Date.now());
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAnchorMs(Date.now())}
              disabled={query.isFetching}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
          </div>
        }
      />

      {query.isPending ? (
        <Card className="p-8">
          <Spinner label="Loading metrics" className="text-accent-700" />
        </Card>
      ) : query.isError ? (
        <Card className="border-red-200 p-6">
          <p className="text-sm font-medium text-red-700">
            {query.error?.message || "Unable to load product metrics right now."}
          </p>
        </Card>
      ) : (
        <>
          <section aria-label="Primary metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((tile) => (
              <Card key={tile.label} className="flex flex-col justify-between p-5">
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-medium text-stone-700">{tile.label}</h2>
                    <Badge tone="neutral">{tile.target}</Badge>
                  </div>
                  <p className="text-2xl font-semibold tracking-tight text-stone-900">{tile.value}</p>
                </div>
                <p className="mt-3 text-xs text-stone-600">{tile.detail}</p>
              </Card>
            ))}
          </section>

          <Card className="overflow-hidden">
            <div className="border-b border-stone-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-stone-900">Window activity breakdown</h2>
              <p className="mt-0.5 text-xs text-stone-600">
                <code>onboarding_completed</code>: N/A in MVP (authenticated accounts land directly on the workspace dashboard).
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-xs font-medium uppercase tracking-wide text-stone-600">
                    <th scope="col" className="px-5 py-3">Signal</th>
                    <th scope="col" className="px-5 py-3 text-right">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 text-stone-800">
                  <tr>
                    <td className="px-5 py-3">Signups completed</td>
                    <td className="px-5 py-3 text-right font-medium">{counts.signups ?? 0}</td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3">Activated within 24h</td>
                    <td className="px-5 py-3 text-right font-medium">{counts.activatedUsers ?? 0}</td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3">Generations started</td>
                    <td className="px-5 py-3 text-right font-medium">{counts.generationStarted ?? 0}</td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3">Generations completed</td>
                    <td className="px-5 py-3 text-right font-medium">{counts.generationCompleted ?? 0}</td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3">Generations failed / cancelled</td>
                    <td className="px-5 py-3 text-right font-medium">
                      {counts.generationFailed ?? 0} / {counts.generationCancelled ?? 0}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3">Notes saved / edited / exported</td>
                    <td className="px-5 py-3 text-right font-medium">
                      {counts.notesSaved ?? 0} / {counts.notesEdited ?? 0} / {counts.notesExported ?? 0}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
