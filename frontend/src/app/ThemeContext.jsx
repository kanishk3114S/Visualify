import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { applyTheme, isThemeMode, readStoredMode, resolveTheme, storeMode } from "../lib/theme.js";
import { useAuth } from "../features/auth/AuthContext.jsx";
import { useProfile, useUpdateProfile } from "../hooks/useProfile.js";

const ThemeContext = createContext(null);
const DARK_QUERY = "(prefers-color-scheme: dark)";

function useSystemPrefersDark() {
  const [dark, setDark] = useState(() => globalThis.matchMedia?.(DARK_QUERY).matches ?? false);
  useEffect(() => {
    const mql = globalThis.matchMedia?.(DARK_QUERY);
    if (!mql) return undefined;
    const onChange = (e) => setDark(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return dark;
}

/**
 * App-wide Light / Dark / System theme. Persists to localStorage immediately
 * (works signed out) and, when signed in, to profile.preferences.theme.
 */
export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => readStoredMode());
  const prefersDark = useSystemPrefersDark();
  const resolvedTheme = resolveTheme(mode, prefersDark);

  useEffect(() => {
    const doc = globalThis.document;
    const style = doc?.createElement?.("style");
    if (style) {
      style.appendChild(doc.createTextNode("*,*::before,*::after{transition:none!important}"));
      doc.head?.appendChild(style);
    }
    applyTheme(resolvedTheme);
    if (style) {
      // Force style flush before removing suppression so theme tokens apply instantaneously.
      void doc.body?.offsetHeight;
      style.remove();
    }
  }, [resolvedTheme]);

  const setMode = useCallback((next) => {
    if (!isThemeMode(next)) return;
    storeMode(next);
    setModeState(next);
  }, []);

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "visualify:theme" && isThemeMode(e.newValue)) setModeState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(() => ({ mode, resolvedTheme, setMode }), [mode, resolvedTheme, setMode]);
  return (
    <ThemeContext.Provider value={value}>
      <ProfileThemeSync mode={mode} setMode={setMode} />
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * When a user's profile first loads in this tab, the saved profile theme wins
 * (it follows them across devices). Later changes go the other way: the
 * toggle writes to both localStorage and the profile.
 */
function ProfileThemeSync({ mode, setMode }) {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const syncedFor = useRef(null);
  useEffect(() => {
    if (!user?.id) {
      syncedFor.current = null;
      return;
    }
    if (!profile || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    const saved = profile.preferences?.theme;
    if (isThemeMode(saved) && saved !== mode) setMode(saved);
  }, [user?.id, profile, mode, setMode]);
  return null;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/** Changes the theme and, when signed in, saves it to the profile. */
export function useThemeChooser() {
  const { mode, resolvedTheme, setMode } = useTheme();
  const { user } = useAuth();
  const update = useUpdateProfile();
  const choose = useCallback(
    (next) => {
      if (!isThemeMode(next) || next === mode) return;
      setMode(next);
      if (user?.id) update.mutate({ preferences: { theme: next } });
    },
    [mode, setMode, user?.id, update]
  );
  return { mode, resolvedTheme, choose, saving: update.isPending };
}
