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
import type { ThemeRegistrationRaw } from "shiki";

export type Appearance = "light" | "dark";
export type Mode = "light" | "dark" | "system";

export interface Theme {
  id: string;
  label: string;
  appearance: Appearance;
  /** Where the theme came from — built-ins vs. user files (for picker grouping). */
  source: "builtin" | "custom";
  /** Built-in id this theme inherited unset cssVars/terminal/shiki from, if any. */
  base?: string;
  /** Semantic CSS custom properties, keyed without the leading `--`. */
  cssVars: Record<string, string>;
  /** Full xterm palette (consumed in Phase 3). */
  terminal: ITheme;
  /** A bundled Shiki theme id, or a full TextMate theme object (custom themes). */
  shiki: string | ThemeRegistrationRaw;
}

const MOCHA: Theme = {
  id: "catppuccin-mocha",
  label: "Catppuccin Mocha",
  appearance: "dark",
  source: "builtin",
  cssVars: {
    "bg-base": "#1e1e2e",
    "bg-elevated": "#191926",
    "bg-inset": "#11111b",
    border: "#343650",
    "border-strong": "#4a4c68",
    text: "#e4e8fb",
    "text-muted": "#b7bedd",
    "text-dim": "#8a90ad",
    accent: "#8fb8ff",
    success: "#a9e6a4",
    danger: "#f58fab",
    warning: "#f6dd9c",
    attention: "#fab387",
    info: "#cba6f7",
    cyan: "#8fe0ee",
    surface2: "#5c5f78",
    overlay1: "#7f849c",
    subtext1: "#bac2de",
    "accent-tool": "#b4befe",
    "attn-blocked": "#eba0ac",
    "tag-cool": "#94e2d5",
  },
  terminal: {
    foreground: "#e4e8fb",
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
  source: "builtin",
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
    surface2: "#acb0be",
    overlay1: "#8c8fa1",
    subtext1: "#5c5f77",
    "accent-tool": "#7287fd",
    "attn-blocked": "#e64553",
    "tag-cool": "#179299",
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

const FRAPPE: Theme = {
  id: "catppuccin-frappe",
  label: "Catppuccin Frappé",
  appearance: "dark",
  source: "builtin",
  cssVars: {
    "bg-base": "#303446",
    "bg-elevated": "#292c3c",
    "bg-inset": "#232634",
    border: "#414559",
    "border-strong": "#51576d",
    text: "#c6d0f5",
    "text-muted": "#a5adce",
    "text-dim": "#737994",
    accent: "#8caaee",
    success: "#a6d189",
    danger: "#e78284",
    warning: "#e5c890",
    attention: "#ef9f76",
    info: "#ca9ee6",
    cyan: "#99d1db",
    surface2: "#626880",
    overlay1: "#838ba7",
    subtext1: "#b5bfe2",
    "accent-tool": "#babbf1",
    "attn-blocked": "#ea999c",
    "tag-cool": "#81c8be",
  },
  terminal: {
    foreground: "#c6d0f5",
    background: "#303446",
    cursor: "#f2d5cf",
    cursorAccent: "#303446",
    selectionBackground: "#626880",
    black: "#51576d",
    red: "#e78284",
    green: "#a6d189",
    yellow: "#e5c890",
    blue: "#8caaee",
    magenta: "#f4b8e4",
    cyan: "#81c8be",
    white: "#b5bfe2",
    brightBlack: "#626880",
    brightRed: "#e78284",
    brightGreen: "#a6d189",
    brightYellow: "#e5c890",
    brightBlue: "#8caaee",
    brightMagenta: "#f4b8e4",
    brightCyan: "#81c8be",
    brightWhite: "#a5adce",
  },
  shiki: "catppuccin-frappe",
};

const MACCHIATO: Theme = {
  id: "catppuccin-macchiato",
  label: "Catppuccin Macchiato",
  appearance: "dark",
  source: "builtin",
  cssVars: {
    "bg-base": "#24273a",
    "bg-elevated": "#1e2030",
    "bg-inset": "#181926",
    border: "#363a4f",
    "border-strong": "#494d64",
    text: "#cad3f5",
    "text-muted": "#a5adcb",
    "text-dim": "#6e738d",
    accent: "#8aadf4",
    success: "#a6da95",
    danger: "#ed8796",
    warning: "#eed49f",
    attention: "#f5a97f",
    info: "#c6a0f6",
    cyan: "#91d7e3",
    surface2: "#5b6078",
    overlay1: "#8087a2",
    subtext1: "#b8c0e0",
    "accent-tool": "#b7bdf8",
    "attn-blocked": "#ee99a0",
    "tag-cool": "#8bd5ca",
  },
  terminal: {
    foreground: "#cad3f5",
    background: "#24273a",
    cursor: "#f4dbd6",
    cursorAccent: "#24273a",
    selectionBackground: "#5b6078",
    black: "#494d64",
    red: "#ed8796",
    green: "#a6da95",
    yellow: "#eed49f",
    blue: "#8aadf4",
    magenta: "#f5bde6",
    cyan: "#8bd5ca",
    white: "#b8c0e0",
    brightBlack: "#5b6078",
    brightRed: "#ed8796",
    brightGreen: "#a6da95",
    brightYellow: "#eed49f",
    brightBlue: "#8aadf4",
    brightMagenta: "#f5bde6",
    brightCyan: "#8bd5ca",
    brightWhite: "#a5adcb",
  },
  shiki: "catppuccin-macchiato",
};

const TOKYO_NIGHT: Theme = {
  id: "tokyo-night",
  label: "Tokyo Night",
  appearance: "dark",
  source: "builtin",
  cssVars: {
    "bg-base": "#1a1b26",
    "bg-elevated": "#16161e",
    "bg-inset": "#13131a",
    border: "#292e42",
    "border-strong": "#414868",
    text: "#c0caf5",
    "text-muted": "#a9b1d6",
    "text-dim": "#565f89",
    accent: "#7aa2f7",
    success: "#9ece6a",
    danger: "#f7768e",
    warning: "#e0af68",
    attention: "#ff9e64",
    info: "#bb9af7",
    cyan: "#7dcfff",
    surface2: "#414868",
    overlay1: "#565f89",
    subtext1: "#a9b1d6",
    "accent-tool": "#bb9af7",
    "attn-blocked": "#ff9e64",
    "tag-cool": "#7dcfff",
  },
  terminal: {
    foreground: "#c0caf5",
    background: "#1a1b26",
    cursor: "#c0caf5",
    cursorAccent: "#1a1b26",
    selectionBackground: "#283457",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
  },
  shiki: "tokyo-night",
};

const ONE_DARK: Theme = {
  id: "one-dark-pro",
  label: "One Dark Pro",
  appearance: "dark",
  source: "builtin",
  cssVars: {
    "bg-base": "#282c34",
    "bg-elevated": "#21252b",
    "bg-inset": "#1b1f23",
    border: "#3e4451",
    "border-strong": "#4b5263",
    text: "#abb2bf",
    "text-muted": "#828997",
    "text-dim": "#5c6370",
    accent: "#61afef",
    success: "#98c379",
    danger: "#e06c75",
    warning: "#e5c07b",
    attention: "#d19a66",
    info: "#c678dd",
    cyan: "#56b6c2",
    surface2: "#4b5263",
    overlay1: "#5c6370",
    subtext1: "#828997",
    "accent-tool": "#c678dd",
    "attn-blocked": "#d19a66",
    "tag-cool": "#56b6c2",
  },
  terminal: {
    foreground: "#abb2bf",
    background: "#282c34",
    cursor: "#528bff",
    cursorAccent: "#282c34",
    selectionBackground: "#3e4451",
    black: "#3f4451",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#d19a66",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
  shiki: "one-dark-pro",
};

const DRACULA: Theme = {
  id: "dracula",
  label: "Dracula",
  appearance: "dark",
  source: "builtin",
  cssVars: {
    "bg-base": "#282a36",
    "bg-elevated": "#21222c",
    "bg-inset": "#191a21",
    border: "#44475a",
    "border-strong": "#6272a4",
    text: "#f8f8f2",
    "text-muted": "#c0c2ce",
    "text-dim": "#6272a4",
    accent: "#bd93f9",
    success: "#50fa7b",
    danger: "#ff5555",
    warning: "#f1fa8c",
    attention: "#ffb86c",
    info: "#ff79c6",
    cyan: "#8be9fd",
    surface2: "#565a73",
    overlay1: "#6272a4",
    subtext1: "#c0c2ce",
    "accent-tool": "#d6acff",
    "attn-blocked": "#ff6e6e",
    "tag-cool": "#8be9fd",
  },
  terminal: {
    foreground: "#f8f8f2",
    background: "#282a36",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "#44475a",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
  shiki: "dracula",
};

const NORD: Theme = {
  id: "nord",
  label: "Nord",
  appearance: "dark",
  source: "builtin",
  cssVars: {
    "bg-base": "#2e3440",
    "bg-elevated": "#2b3039",
    "bg-inset": "#272b33",
    border: "#3b4252",
    "border-strong": "#434c5e",
    text: "#eceff4",
    "text-muted": "#d8dee9",
    "text-dim": "#4c566a",
    accent: "#88c0d0",
    success: "#a3be8c",
    danger: "#bf616a",
    warning: "#ebcb8b",
    attention: "#d08770",
    info: "#b48ead",
    cyan: "#8fbcbb",
    surface2: "#434c5e",
    overlay1: "#4c566a",
    subtext1: "#d8dee9",
    "accent-tool": "#b48ead",
    "attn-blocked": "#d08770",
    "tag-cool": "#8fbcbb",
  },
  terminal: {
    foreground: "#d8dee9",
    background: "#2e3440",
    cursor: "#d8dee9",
    cursorAccent: "#2e3440",
    selectionBackground: "#434c5e",
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  },
  shiki: "nord",
};

const GITHUB_LIGHT: Theme = {
  id: "github-light",
  label: "GitHub Light",
  appearance: "light",
  source: "builtin",
  cssVars: {
    "bg-base": "#ffffff",
    "bg-elevated": "#f6f8fa",
    "bg-inset": "#eaeef2",
    border: "#d0d7de",
    "border-strong": "#afb8c1",
    text: "#1f2328",
    "text-muted": "#656d76",
    "text-dim": "#6e7781",
    accent: "#0969da",
    success: "#1a7f37",
    danger: "#cf222e",
    warning: "#9a6700",
    attention: "#bc4c00",
    info: "#8250df",
    cyan: "#1b7c83",
    surface2: "#eaeef2",
    overlay1: "#6e7781",
    subtext1: "#656d76",
    "accent-tool": "#8250df",
    "attn-blocked": "#bc4c00",
    "tag-cool": "#1b7c83",
  },
  terminal: {
    foreground: "#1f2328",
    background: "#ffffff",
    cursor: "#1f2328",
    cursorAccent: "#ffffff",
    selectionBackground: "#b6e3ff",
    black: "#24292f",
    red: "#cf222e",
    green: "#116329",
    yellow: "#4d2d00",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#6e7781",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#1a7f37",
    brightYellow: "#633c01",
    brightBlue: "#218bff",
    brightMagenta: "#a475f9",
    brightCyan: "#3192aa",
    brightWhite: "#8c959f",
  },
  shiki: "github-light",
};

const SOLARIZED_LIGHT: Theme = {
  id: "solarized-light",
  label: "Solarized Light",
  appearance: "light",
  source: "builtin",
  cssVars: {
    "bg-base": "#fdf6e3",
    "bg-elevated": "#eee8d5",
    "bg-inset": "#e3ddc9",
    border: "#e3dcc7",
    "border-strong": "#cbc4ac",
    text: "#586e75",
    "text-muted": "#657b83",
    "text-dim": "#93a1a1",
    accent: "#268bd2",
    success: "#859900",
    danger: "#dc322f",
    warning: "#b58900",
    attention: "#cb4b16",
    info: "#6c71c4",
    cyan: "#2aa198",
    surface2: "#dcd5bf",
    overlay1: "#93a1a1",
    subtext1: "#657b83",
    "accent-tool": "#6c71c4",
    "attn-blocked": "#cb4b16",
    "tag-cool": "#2aa198",
  },
  terminal: {
    foreground: "#657b83",
    background: "#fdf6e3",
    cursor: "#586e75",
    cursorAccent: "#fdf6e3",
    selectionBackground: "#eee8d5",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
  shiki: "solarized-light",
};

/** The built-in themes — the registry seed, and the only set vite.config.ts sees.
 *  Order here drives the picker's per-appearance list order; the first dark/light
 *  entry is also the fallback (Mocha / Latte) for an unknown preferred id. */
export const THEMES: Record<string, Theme> = {
  [MOCHA.id]: MOCHA,
  [FRAPPE.id]: FRAPPE,
  [MACCHIATO.id]: MACCHIATO,
  [TOKYO_NIGHT.id]: TOKYO_NIGHT,
  [ONE_DARK.id]: ONE_DARK,
  [DRACULA.id]: DRACULA,
  [NORD.id]: NORD,
  [LATTE.id]: LATTE,
  [GITHUB_LIGHT.id]: GITHUB_LIGHT,
  [SOLARIZED_LIGHT.id]: SOLARIZED_LIGHT,
};

// --------------------------------------------------- custom theme registry

// User-authored themes, registered at runtime from disk (see main.ts). Kept
// separate from THEMES so the built-in seed stays a static, build-time-safe
// export; lookups consult the merged view.
let customThemes: Record<string, Theme> = {};

function mergedThemes(): Record<string, Theme> {
  return { ...THEMES, ...customThemes };
}

/** Replace the custom theme set (validated upstream). Built-ins are untouched. */
export function registerCustomThemes(themes: Theme[]): void {
  customThemes = Object.fromEntries(themes.map((t) => [t.id, t]));
}

/** All selectable themes — built-ins first, then custom — for the picker. */
export function allThemes(): Theme[] {
  return Object.values(mergedThemes());
}

// --------------------------------------------------------- theme validation

/** The 21 per-theme color tokens; the source of truth is the built-in shape. */
const VAR_KEYS = Object.keys(MOCHA.cssVars);
/** Bundled Shiki ids we can actually load (only Catppuccin ships in the bundle). */
const SHIKI_IDS = new Set(
  Object.values(THEMES).flatMap((t) => (typeof t.shiki === "string" ? [t.shiki] : [])),
);
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

function builtinFor(appearance: Appearance): Theme {
  return Object.values(THEMES).find((t) => t.appearance === appearance)!;
}

export type ValidationResult = { theme: Theme } | { error: string };

/**
 * Validate + normalize a parsed theme file into a `Theme`. Unset cssVars/terminal
 * entries inherit from a base built-in (the `base` field, or the one matching
 * `appearance`); individual bad-hex overrides are dropped (fall back to inherited)
 * rather than failing the whole theme. Only structural problems — missing
 * id/label/appearance, or an id colliding with a built-in — reject the theme.
 * Pure: no Tauri, no DOM, so it stays Node-importable alongside the rest of the file.
 */
export function validateTheme(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) return { error: "not an object" };
  const r = raw as Record<string, unknown>;

  const id = r.id;
  if (typeof id !== "string" || !id.trim()) return { error: 'missing or invalid "id"' };
  if (id in THEMES) return { error: `id "${id}" collides with a built-in theme` };

  if (typeof r.label !== "string" || !r.label.trim())
    return { error: `theme "${id}": missing "label"` };
  const label = r.label;

  if (r.appearance !== "light" && r.appearance !== "dark")
    return { error: `theme "${id}": "appearance" must be "light" or "dark"` };
  const appearance = r.appearance;

  const base =
    typeof r.base === "string" && r.base in THEMES ? THEMES[r.base] : builtinFor(appearance);

  // cssVars: clone the base, override known keys that carry a valid hex value.
  const cssVars = { ...base.cssVars };
  const rawVars = (r.cssVars ?? {}) as Record<string, unknown>;
  for (const key of VAR_KEYS) {
    if (isHex(rawVars[key])) cssVars[key] = rawVars[key] as string;
  }

  // terminal: clone the base, override any entry that carries a valid hex value.
  const terminal: ITheme = { ...base.terminal };
  for (const [key, value] of Object.entries((r.terminal ?? {}) as Record<string, unknown>)) {
    if (isHex(value)) (terminal as Record<string, string>)[key] = value;
  }

  // shiki: a supplied object wins (name forced to the theme id so review.ts can
  // key on it); a *bundled* id string is honoured; anything else (absent, or a
  // non-bundled id we can't load) inherits the base built-in's id.
  let shiki: Theme["shiki"];
  if (typeof r.shiki === "object" && r.shiki !== null) {
    shiki = { ...(r.shiki as ThemeRegistrationRaw), name: id };
  } else if (typeof r.shiki === "string" && SHIKI_IDS.has(r.shiki)) {
    shiki = r.shiki;
  } else {
    shiki = base.shiki;
  }

  return {
    theme: { id, label, appearance, source: "custom", base: base.id, cssVars, terminal, shiki },
  };
}

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
  return mergedThemes()[localStorage.getItem(KEY_LIGHT) ?? ""] ?? LATTE;
}

function getDarkTheme(): Theme {
  return mergedThemes()[localStorage.getItem(KEY_DARK) ?? ""] ?? MOCHA;
}

/** The theme currently filling the preferred slot for an appearance (what the
 *  picker marks "current" and starts on). */
export function preferredTheme(appearance: Appearance): Theme {
  return appearance === "dark" ? getDarkTheme() : getLightTheme();
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

// Cache key for the active theme's resolved cssVars, per appearance. The
// pre-paint boot script (vite.config.ts) replays this before first paint so a
// custom theme — unknown at build time — doesn't flash the built-in defaults.
const KEY_VARS = (a: Appearance) => `cc-theme-vars-${a}`;

function applyVars(theme: Theme): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.cssVars)) {
    root.style.setProperty(`--${k}`, v);
  }
  root.dataset.appearance = theme.appearance;
  active = theme;
  for (const cb of listeners) cb(theme);
}

/** Apply a theme (CSS vars + xterm/Shiki via listeners) and cache its vars for
 *  the no-flash boot replay. */
export function applyTheme(theme: Theme): void {
  applyVars(theme);
  localStorage.setItem(KEY_VARS(theme.appearance), JSON.stringify(theme.cssVars));
}

/** Apply a theme transiently for previewing — no cache write, no pref change.
 *  Revert with `applyTheme(resolveTheme())` to fall back to the saved selection. */
export function previewTheme(theme: Theme): void {
  applyVars(theme);
}

export function setMode(mode: Mode): void {
  localStorage.setItem(KEY_MODE, mode);
  applyTheme(resolveTheme());
}

/**
 * Pick a specific theme: record it as the preferred theme for its appearance and
 * switch to that appearance now. System mode (followSystem) later reuses these
 * preferred-light/-dark slots, so the choice persists across OS-appearance flips.
 */
export function chooseTheme(theme: Theme): void {
  localStorage.setItem(theme.appearance === "dark" ? KEY_DARK : KEY_LIGHT, theme.id);
  setMode(theme.appearance);
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
