import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./ProtectedRoute.jsx";
import { PublicOnlyRoute } from "./PublicOnlyRoute.jsx";
import { AppShell } from "./AppShell.jsx";
import { RouteErrorBoundary } from "./RouteErrorBoundary.jsx";
import { FullPageSpinner } from "../components/Spinner.jsx";
import { PublicLayout } from "../features/marketing/PublicLayout.jsx";
import { LandingPage } from "../features/marketing/LandingPage.jsx";
import { FeaturesPage } from "../features/marketing/FeaturesPage.jsx";
import { PrivacyPage, TermsPage } from "../features/marketing/LegalPages.jsx";
import { NotFoundPage } from "../features/marketing/NotFoundPage.jsx";
import { LoginPage } from "../features/auth/LoginPage.jsx";
import { SignupPage } from "../features/auth/SignupPage.jsx";
import { ForgotPasswordPage } from "../features/auth/ForgotPasswordPage.jsx";
import { ResetPasswordPage } from "../features/auth/ResetPasswordPage.jsx";
import { AuthCallbackPage } from "../features/auth/AuthCallbackPage.jsx";
import { DashboardPage } from "../features/dashboard/DashboardPage.jsx";
import { ProfilePage } from "../features/profile/ProfilePage.jsx";
import { SettingsPage } from "../features/profile/SettingsPage.jsx";
import { AccountSettingsPage } from "../features/profile/AccountSettingsPage.jsx";
import { PreferencesPage } from "../features/profile/PreferencesPage.jsx";
import { CreatePage } from "../features/create/CreatePage.jsx";
import { GenerationResultPage } from "../features/generation/GenerationResultPage.jsx";
import { LibraryPage } from "../features/notes/LibraryPage.jsx";
import { NoteReadPage } from "../features/notes/NoteReadPage.jsx";
import { NoteEditorPage } from "../features/notes/NoteEditorPage.jsx";
import { NotePresentPage } from "../features/notes/NotePresentPage.jsx";

// Phase 0 editor harness: gated to dev builds only so Playwright coverage
// keeps working on the dev server without exposing /spike in production builds.
const ExcalidrawSpikePage = import.meta.env.DEV ? lazy(() => import("../features/spike/ExcalidrawSpikePage.jsx")) : null;

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { path: "/", element: <LandingPage /> },
          { path: "/features", element: <FeaturesPage /> },
          { path: "/privacy", element: <PrivacyPage /> },
          { path: "/terms", element: <TermsPage /> },
          { path: "/404", element: <NotFoundPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
      {
        element: <PublicOnlyRoute />,
        children: [
          { path: "/login", element: <LoginPage /> },
          { path: "/signup", element: <SignupPage /> },
          { path: "/forgot-password", element: <ForgotPasswordPage /> },
        ],
      },
      // Callback routes must work whether or not a session exists.
      { path: "/reset-password", element: <ResetPasswordPage /> },
      { path: "/auth/callback", element: <AuthCallbackPage /> },
      {
        path: "/app",
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: "create", element: <CreatePage /> },
              // Full-bleed: the workspace manages its own layout (PRD 6.4).
              { path: "generations/:jobId", element: <GenerationResultPage />, handle: { fullWidth: true } },
              { path: "notes", element: <LibraryPage />, handle: { wide: true } },
              { path: "folders/:folderId", element: <LibraryPage />, handle: { wide: true } },
              { path: "notes/:noteId", element: <NoteReadPage /> },
              { path: "notes/:noteId/edit", element: <NoteEditorPage />, handle: { fullWidth: true } },
              { path: "notes/:noteId/present", element: <NotePresentPage />, handle: { fullWidth: true } },
              { path: "profile", element: <ProfilePage /> },
              { path: "settings", element: <SettingsPage /> },
              { path: "settings/account", element: <AccountSettingsPage /> },
              { path: "settings/preferences", element: <PreferencesPage /> },
              { path: "*", element: <Navigate to="/404" replace /> },
            ],
          },
        ],
      },
      ...(import.meta.env.DEV && ExcalidrawSpikePage
        ? [
            {
              path: "/spike/excalidraw",
              element: (
                <Suspense fallback={<FullPageSpinner label="Loading editor" />}>
                  <ExcalidrawSpikePage />
                </Suspense>
              ),
            },
          ]
        : []),
    ],
  },
]);
