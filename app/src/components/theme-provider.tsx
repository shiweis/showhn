"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

/** Holds a theme the visitor picked by clicking. Without it the site follows the OS setting. */
const CHOICE_KEY = "theme-choice";
/** An earlier version wrote this on every visit, clicked or not, so it says nothing. No longer read. */
const LEGACY_KEY = "theme";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
}>({ theme: "light", toggle: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

const listeners = new Set<() => void>();

function shownTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function show(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  for (const listener of listeners) listener();
}

function storedChoice(): string | null {
  try {
    return localStorage.getItem(CHOICE_KEY);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Until the visitor picks a theme, keep following the OS setting as it changes.
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const followSystem = (event: MediaQueryListEvent) => {
    if (!storedChoice()) show(event.matches ? "dark" : "light");
  };
  system.addEventListener("change", followSystem);

  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // storage unavailable: nothing to clean up
  }

  return () => {
    listeners.delete(listener);
    system.removeEventListener("change", followSystem);
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The inline script in the layout has already put the right class on <html>
  // before the first paint. This only reads that class. Loading the page never
  // changes it and never writes to storage: doing both from an effect is what
  // made dark-mode visitors see a flash of the light theme, and what saved the
  // OS setting as if it were a choice. The server snapshot is "light" so
  // hydration matches the server's markup.
  const theme = useSyncExternalStore<Theme>(subscribe, shownTheme, () => "light");

  const toggle = () => {
    const next: Theme = shownTheme() === "light" ? "dark" : "light";
    try {
      localStorage.setItem(CHOICE_KEY, next);
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
    show(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
