import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'cb-admin-theme';

function getInitialTheme(): Theme {
  // Check localStorage first
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // Fallback to system preference
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

// ── Module-level singleton store ───────────────────────────
// Theme state must be shared: `main.tsx` reads it to drive the antd
// ConfigProvider (algorithm + tokens), while `Layout.tsx` renders the toggle.
// If each caller kept its own useState, toggling from Layout would flip the
// CSS variables (via <html data-theme>) but the ConfigProvider would never
// re-render — leaving antd tables / inputs / dropdowns stuck on the old theme.
let currentTheme: Theme = getInitialTheme();
const listeners = new Set<() => void>();

function applyTheme(t: Theme) {
  currentTheme = t;
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
  listeners.forEach((fn) => fn());
}

// Correct the <html data-theme> attribute (index.html defaults to "dark")
// before first paint so it matches the stored/system preference.
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', currentTheme);
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): Theme {
  return currentTheme;
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot);
  const toggleTheme = useCallback(() => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }, []);
  const setTheme = useCallback((t: Theme) => {
    applyTheme(t);
  }, []);
  return { theme, toggleTheme, setTheme };
}
