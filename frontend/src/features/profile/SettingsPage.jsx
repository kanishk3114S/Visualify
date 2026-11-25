import { Link } from "react-router-dom";
import { ChevronRight, KeyRound, SlidersHorizontal, User } from "lucide-react";
import { Card, PageHeader } from "../../components/Layout.jsx";

const SECTIONS = [
  { to: "/app/profile", icon: User, title: "Profile", text: "Display name, username, bio and photo." },
  { to: "/app/settings/account", icon: KeyRound, title: "Account", text: "Email, password and signed-in sessions." },
  { to: "/app/settings/preferences", icon: SlidersHorizontal, title: "Preferences", text: "Learning level and default export format." },
];

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Manage your account and preferences." />
      <Card as="nav" aria-label="Settings sections" className="divide-y divide-stone-100">
        {SECTIONS.map(({ to, icon: Icon, title, text }) => (
          <Link key={to} to={to} className="flex items-center gap-4 px-5 py-4 hover:bg-stone-50 first:rounded-t-xl last:rounded-b-xl">
            <Icon className="h-5 w-5 text-accent-700" aria-hidden="true" />
            <span className="flex-1">
              <span className="block text-sm font-medium text-stone-900">{title}</span>
              <span className="block text-sm text-stone-600">{text}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-stone-400" aria-hidden="true" />
          </Link>
        ))}
      </Card>
    </>
  );
}
