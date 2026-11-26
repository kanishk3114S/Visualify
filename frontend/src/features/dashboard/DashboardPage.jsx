import { Link } from "react-router-dom";
import { CheckCircle2, Circle, FileImage, FileText, GraduationCap, Sparkles, Star } from "lucide-react";
import { Badge, Card, PageHeader } from "../../components/Layout.jsx";
import { ButtonLink } from "../../components/Button.jsx";
import { Spinner } from "../../components/Spinner.jsx";
import { useProfile, useUsage } from "../../hooks/useProfile.js";
import { useNotesQuery } from "../../hooks/useNotes.js";
import { DEFAULT_FILTERS, toNotesQuery } from "../../lib/libraryFilters.js";
import { formatRelative } from "../../lib/format.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { ProfileLoadError } from "../profile/ProfileLoadError.jsx";
import { Reveal, useCountUp } from "../../motion/index.js";

function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function ChecklistItem({ done, children, action }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex items-center gap-3 py-3">
      <Icon className={done ? "h-5 w-5 text-accent-700" : "h-5 w-5 text-stone-400"} aria-hidden="true" />
      <span className={done ? "flex-1 text-sm text-stone-500 line-through" : "flex-1 text-sm text-stone-800"}>
        {children}
        <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
      </span>
      {!done && action}
    </li>
  );
}

const ROADMAP = [
  { icon: GraduationCap, title: "Phase 7 sharing & study spaces", text: "Read-only share links, curated classroom decks, and source-grounded Q&A across collections." },
];

const RECENT_QUERY = toNotesQuery({ ...DEFAULT_FILTERS, sort: "updated_at" }, { limit: 5 });
const FAVORITES_QUERY = toNotesQuery({ ...DEFAULT_FILTERS, favorite: true }, { limit: 5 });

function NoteList({ query, empty, testId }) {
  if (query.isPending) return <Spinner label="Loading notes" className="text-accent-700" />;
  if (query.isError) return <p className="text-sm text-red-700">{query.error.message}</p>;
  if (!query.data.items.length) return <p className="text-sm text-stone-600">{empty}</p>;
  return (
    <ul className="divide-y divide-stone-100" data-testid={testId}>
      {query.data.items.map((n) => (
        <li key={n.id}>
          <Link
            to={`/app/notes/${n.id}`}
            viewTransition
            className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-stone-50"
          >
            <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-stone-200 bg-stone-50">
              {n.previewUrl ? (
                <img src={n.previewUrl} alt="" className="h-full w-full object-contain" referrerPolicy="no-referrer" />
              ) : (
                <FileImage className="h-4 w-4 text-stone-400" aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-stone-900">{n.title}</span>
              <span className="block truncate text-xs text-stone-600">
                {n.subject ? `${n.subject} · ` : ""}Updated {formatRelative(n.updatedAt)}
              </span>
            </span>
            {n.sourceType && n.sourceType !== "prompt" && (
              <Badge tone="neutral">{n.sourceType === "pdf" ? "PDF" : "Image"}</Badge>
            )}
            {n.isFavorite && <Star className="h-4 w-4 shrink-0 fill-current text-amber-800" aria-label="Favorite" />}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data: profile, isPending, isError, error, refetch } = useProfile();
  const usageQuery = useUsage();
  const recent = useNotesQuery(RECENT_QUERY);
  const favorites = useNotesQuery(FAVORITES_QUERY);

  const name = profile?.display_name || user?.email?.split("@")[0] || "";
  const profileComplete = Boolean(profile?.display_name && profile?.username);
  const hasAvatar = Boolean(profile?.avatar_url);
  const noteCount = recent.data?.total ?? 0;
  const favoritesTotal = favorites.data?.total ?? 0;
  const animatedNoteCount = useCountUp(noteCount, { enabled: !recent.isPending });
  const animatedFavCount = useCountUp(favoritesTotal, { enabled: !favorites.isPending });
  const hasNotes = noteCount > 0;
  const usage = usageQuery.data;
  const usagePct = usage?.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
  const quotaReached = Boolean(usage && usage.remaining <= 0);

  return (
    <>
      <PageHeader title={isPending ? "Welcome" : `${greeting()}${name ? `, ${name}` : ""}`} description="Your visual learning workspace." />

      {isError && <ProfileLoadError onRetry={refetch} error={error} />}

      <div className="grid gap-6 md:grid-cols-5">
        <Reveal delay={0} y={10} className="md:col-span-3">
        <Card className="flex h-full flex-col p-6" aria-labelledby="create-cta">
          <Sparkles className="h-6 w-6 text-accent-700" aria-hidden="true" />
          <h2 id="create-cta" className="mt-3 text-base font-semibold text-stone-900">
            Turn a topic, PDF or image into a visual
          </h2>
          <p className="mt-1 flex-1 text-sm text-stone-600">
            Describe a topic, upload a PDF with page selection, or upload handwritten notes to get an editable diagram and explanation.
          </p>
          <ButtonLink to="/app/create" className="mt-4 self-start">
            Create visual notes
          </ButtonLink>
        </Card>
        </Reveal>

        <Reveal delay={60} y={10} className="md:col-span-2">
        <Card className="h-full p-6" aria-labelledby="library-stats">
          <h2 id="library-stats" className="text-base font-semibold text-stone-900">
            Your library
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-4" data-testid="library-stats">
            <div>
              <dt className="text-xs text-stone-600">Saved notes</dt>
              <dd className="text-2xl font-semibold tabular-nums text-stone-900">{recent.isPending ? "–" : animatedNoteCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-600">Favorites</dt>
              <dd className="text-2xl font-semibold tabular-nums text-stone-900">{favorites.isPending ? "–" : animatedFavCount}</dd>
            </div>
          </dl>
          <Link to="/app/notes" viewTransition className="mt-4 inline-block text-sm font-medium text-accent-700 underline-offset-2 hover:text-accent-800 hover:underline">
            Open library →
          </Link>
        </Card>
        </Reveal>

        <Reveal delay={110} y={10} className="md:col-span-5">
        <Card className="p-6" aria-labelledby="usage-meter-heading" data-testid="usage-meter">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="usage-meter-heading" className="text-base font-semibold text-stone-900">
                Usage this month
              </h2>
              <p className="text-xs text-stone-600">
                {usage?.resetsAt
                  ? `Resets on ${new Date(usage.resetsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} (UTC)`
                  : "Monthly AI visual generations and study companion allowance"}
              </p>
            </div>
            <Badge tone={quotaReached ? "soon" : "accent"} data-testid="usage-meter-badge">
              {usageQuery.isPending ? "Loading…" : `${usage?.used ?? 0} / ${usage?.limit ?? 50} used`}
            </Badge>
          </div>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-200"
            role="progressbar"
            aria-label="Monthly AI quota usage"
            aria-valuenow={usage?.used ?? 0}
            aria-valuemin={0}
            aria-valuemax={usage?.limit ?? 50}
          >
            <div
              className={quotaReached ? "h-full rounded-full bg-amber-600 transition-[width] duration-500 ease-[var(--ease-out)]" : "h-full rounded-full bg-accent-700 transition-[width] duration-500 ease-[var(--ease-out)]"}
              style={{ width: `${usagePct}%` }}
            />
          </div>
          {usage?.breakdown && (
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-600">
              <div>
                <dt className="inline">Generations: </dt>
                <dd className="inline font-semibold tabular-nums text-stone-900">{usage.breakdown.generations ?? 0}</dd>
              </div>
              <div>
                <dt className="inline">Study companion: </dt>
                <dd className="inline font-semibold tabular-nums text-stone-900">{usage.breakdown.companion ?? 0}</dd>
              </div>
              <div>
                <dt className="inline">Exports: </dt>
                <dd className="inline font-semibold tabular-nums text-stone-900">{usage.breakdown.exports ?? 0}</dd>
              </div>
            </dl>
          )}
          {quotaReached && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              You have reached this month&apos;s AI generation quota. Saved notes, editing, presentation mode, and exports remain available.
            </p>
          )}
        </Card>
        </Reveal>

        <Card className="p-6 md:col-span-3" aria-labelledby="recent-notes">
          <h2 id="recent-notes" className="mb-2 text-base font-semibold text-stone-900">
            Recent notes
          </h2>
          <NoteList query={recent} testId="recent-notes" empty="Nothing saved yet. Create a visual and choose Save to library." />
        </Card>

        <Card className="p-6 md:col-span-2" aria-labelledby="favorite-notes">
          <h2 id="favorite-notes" className="mb-2 text-base font-semibold text-stone-900">
            Favorites
          </h2>
          <NoteList query={favorites} testId="favorite-notes" empty="Star a note to pin it here." />
        </Card>

        <Card className="p-6 md:col-span-5" aria-labelledby="getting-started">
          <h2 id="getting-started" className="text-base font-semibold text-stone-900">
            Getting started
          </h2>
          <ul className="mt-2 divide-y divide-stone-100">
            <ChecklistItem done>Create your account</ChecklistItem>
            <ChecklistItem done={hasNotes} action={<ButtonLink to="/app/create" variant="secondary" size="sm">Create</ButtonLink>}>
              Generate and save your first visual note
            </ChecklistItem>
            <ChecklistItem done={profileComplete} action={<ButtonLink to="/app/profile" variant="secondary" size="sm">Edit profile</ButtonLink>}>
              Add your name and a username
            </ChecklistItem>
            <ChecklistItem done={hasAvatar} action={<ButtonLink to="/app/profile" variant="secondary" size="sm">Add photo</ButtonLink>}>
              Upload a profile photo
            </ChecklistItem>
          </ul>
        </Card>
      </div>

      <section className="mt-10" aria-labelledby="coming-next">
        <div className="mb-4 flex items-center gap-3">
          <h2 id="coming-next" className="text-base font-semibold text-stone-900">
            Coming next
          </h2>
          <Badge tone="soon">Not available yet</Badge>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {ROADMAP.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl border border-dashed border-stone-300 bg-surface/60 p-5">
              <Icon className="h-5 w-5 text-stone-500" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-semibold text-stone-800">{title}</h3>
              <p className="mt-1 text-sm text-stone-600">{text}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
