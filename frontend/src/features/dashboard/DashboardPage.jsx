import { Link } from "react-router-dom";
import { CheckCircle2, Circle, FileText, FolderOpen, PenTool, Sparkles } from "lucide-react";
import { Badge, Card, PageHeader } from "../../components/Layout.jsx";
import { ButtonLink } from "../../components/Button.jsx";
import { useProfile } from "../../hooks/useProfile.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { ProfileLoadError } from "../profile/ProfileLoadError.jsx";

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
  { icon: FolderOpen, title: "Notes library", text: "Save, organise, search and version your visual notes." },
  { icon: PenTool, title: "Downloads", text: "Export notes as PNG, SVG or .excalidraw files." },
  { icon: FileText, title: "PDF and image inputs", text: "Turn lecture slides and handwritten notes into visuals." },
];

export function DashboardPage() {
  const { user } = useAuth();
  const { data: profile, isPending, isError, error, refetch } = useProfile();

  const name = profile?.display_name || user?.email?.split("@")[0] || "";
  const profileComplete = Boolean(profile?.display_name && profile?.username);
  const hasAvatar = Boolean(profile?.avatar_url);

  return (
    <>
      <PageHeader
        title={isPending ? "Welcome" : `${greeting()}${name ? `, ${name}` : ""}`}
        description="Your visual learning workspace."
      />

      {isError && <ProfileLoadError onRetry={refetch} error={error} />}

      <div className="grid gap-6 md:grid-cols-5">
        <Card className="p-6 md:col-span-3" aria-labelledby="getting-started">
          <h2 id="getting-started" className="text-base font-semibold text-stone-900">
            Getting started
          </h2>
          <p className="mt-1 text-sm text-stone-600">A few steps to set up your account.</p>
          <ul className="mt-3 divide-y divide-stone-100">
            <ChecklistItem done>Create your account</ChecklistItem>
            <ChecklistItem
              done={profileComplete}
              action={
                <ButtonLink to="/app/profile" variant="secondary" size="sm">
                  Edit profile
                </ButtonLink>
              }
            >
              Add your name and a username
            </ChecklistItem>
            <ChecklistItem
              done={hasAvatar}
              action={
                <ButtonLink to="/app/profile" variant="secondary" size="sm">
                  Add photo
                </ButtonLink>
              }
            >
              Upload a profile photo
            </ChecklistItem>
          </ul>
        </Card>

        <Card className="flex flex-col p-6 md:col-span-2" aria-labelledby="create-cta">
          <Sparkles className="h-6 w-6 text-accent-700" aria-hidden="true" />
          <h2 id="create-cta" className="mt-3 text-base font-semibold text-stone-900">
            Turn a topic into a visual
          </h2>
          <p className="mt-1 flex-1 text-sm text-stone-600">
            Describe a topic and get an editable diagram with a section-by-section explanation.
          </p>
          <ButtonLink to="/app/create" className="mt-4 self-start">
            Create visual notes
          </ButtonLink>
          <Link
            to="/spike/excalidraw"
            className="mt-3 text-sm font-medium text-accent-700 underline-offset-2 hover:text-accent-800 hover:underline"
          >
            Or try a blank canvas →
          </Link>
        </Card>
      </div>

      <section className="mt-10" aria-labelledby="coming-next">
        <div className="mb-4 flex items-center gap-3">
          <h2 id="coming-next" className="text-base font-semibold text-stone-900">
            Coming next
          </h2>
          <Badge tone="soon">Not available yet</Badge>
        </div>
        <ul className="grid gap-4 sm:grid-cols-3">
          {ROADMAP.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl border border-dashed border-stone-300 bg-white/60 p-5">
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
