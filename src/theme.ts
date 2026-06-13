// GUI-owned theming. A small registry of themes — each covering CSS custom
// properties, the xterm terminal palette, and the Shiki highlighter id — plus a
// manager that resolves the active theme from GUI-local preferences and the OS
// appearance. Deliberately independent of claude-commander's config: prefs live
// in localStorage, not the shared Config (settings.ts).
//
// Phase 2 wires the CSS-var surface only. `terminal` and `shiki` are carried on
// each Theme now so Phases 3 (terminal retheme) and 4 (Shiki) just consume them
// via the onThemeChange subscription.

import type { ITheme } from "@xterm/xterm";

export type Appearance = "light" | "dark";
export type Mode = "light" | "dark" | "system";

export interface Theme {
  id: string;
  label: string;
  appearance: Appearance;
  /** Semantic CSS custom properties, keyed without the leading `--`. */
  cssVars: Record<string, string>;
  /** Full xterm palette (consumed in Phase 3). */
  terminal: ITheme;
  /** Bundled Shiki theme id (consumed in Phase 4). */
  shiki: string;
}

const MOCHA: Theme = {
  id: "catppuccin-mocha",
  label: "Catppuccin Mocha",
  appearance: "dark",
  cssVars: {
    "bg-base": "#1e1e2e",
    "bg-elevated": "#181825",
    "bg-inset": "#11111b",
    border: "#313244",
    "border-strong": "#45475a",
    text: "#cdd6f4",
    "text-muted": "#a6adc8",
    "text-dim": "#6c7086",
    accent: "#89b4fa",
    success: "#a6e3a1",
    danger: "#f38ba8",
    warning: "#f9e2af",
    attention: "#fab387",
    info: "#cba6f7",
    cyan: "#89dceb",
  },
  terminal: {
    foreground: "#cdd6f4",
    background: "#1e1e2e",
    cursor: "#f5e0dc",
    cursorAccent: "#1e1e2e",
    selectionBackground: "#585b70",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
  shiki: "catppuccin-mocha",
};

const LATTE: Theme = {
  id: "catppuccin-latte",
  label: "Catppuccin Latte",
  appearance: "light",
  cssVars: {
    "bg-base": "#eff1f5",
    "bg-elevated": "#e6e9ef",
    "bg-inset": "#dce0e8",
    border: "#ccd0da",
    "border-strong": "#bcc0cc",
    text: "#4c4f69",
    "text-muted": "#6c6f85",
    "text-dim": "#9ca0b0",
    accent: "#1e66f5",
    success: "#40a02b",
    danger: "#d20f39",
    warning: "#df8e1d",
    attention: "#fe640b",
    info: "#8839ef",
    cyan: "#04a5e5",
  },
  terminal: {
    foreground: "#4c4f69",
    background: "#eff1f5",
    cursor: "#dc8a78",
    cursorAccent: "#eff1f5",
    selectionBackground: "#acb0be",
    black: "#5c5f77",
    red: "#d20f39",
    green: "#40a02b",
    yellow: "#df8e1d",
    blue: "#1e66f5",
    magenta: "#ea76cb",
    cyan: "#179299",
    white: "#acb0be",
    brightBlack: "#6c6f85",
    brightRed: "#d20f39",
    brightGreen: "#40a02b",
    brightYellow: "#df8e1d",
    brightBlue: "#1e66f5",
    brightMagenta: "#ea76cb",
    brightCyan: "#179299",
    brightWhite: "#bcc0cc",
  },
  shiki: "catppuccin-latte",
};

export const THEMES: Record<string, Theme> = {
  [MOCHA.id]: MOCHA,
  [LATTE.id]: LATTE,
};

// localStorage keys — GUI-local, intentionally not in commander config.
const KEY_MODE = "cc-theme-mode";
const KEY_LIGHT = "cc-theme-light";
const KEY_DARK = "cc-theme-dark";

const DEFAULT_MODE: Mode = "system";

export function getMode(): Mode {
  const v = localStorage.getItem(KEY_MODE);
  return v === "light" || v === "dark" || v === "system" ? v : DEFAULT_MODE;
}

function getLightTheme(): Theme {
  return THEMES[localStorage.getItem(KEY_LIGHT) ?? ""] ?? LATTE;
}

function getDarkTheme(): Theme {
  return THEMES[localStorage.getItem(KEY_DARK) ?? ""] ?? MOCHA;
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The theme that should be active given the current prefs + OS appearance. */
export function resolveTheme(): Theme {
  const mode = getMode();
  const dark = mode === "system" ? systemPrefersDark() : mode === "dark";
  return dark ? getDarkTheme() : getLightTheme();
}

let active: Theme | null = null;

export function currentTheme(): Theme {
  return active ?? resolveTheme();
}

type Listener = (theme: Theme) => void;
const listeners = new Set<Listener>();

/** Subscribe to theme changes (Phase 3/4 wire terminal + Shiki here). */
export function onThemeChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Apply a theme's CSS custom properties and notify subscribers. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.cssVars)) {
    root.style.setProperty(`--${k}`, v);
  }
  root.dataset.appearance = theme.appearance;
  active = theme;
  for (const cb of listeners) cb(theme);
}

export function setMode(mode: Mode): void {
  localStorage.setItem(KEY_MODE, mode);
  applyTheme(resolveTheme());
}

/** Re-resolve and apply, but only while following the OS (mode === "system"). */
export function followSystem(): void {
  if (getMode() === "system") applyTheme(resolveTheme());
}

/** Initialize from stored prefs + current OS appearance. Call once at boot. */
export function initTheme(): void {
  applyTheme(resolveTheme());
  // matchMedia is the reliable appearance signal inside WKWebView; the native
  // Tauri theme event (wired in main.ts) is the cross-platform primary.
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", followSystem);
}
