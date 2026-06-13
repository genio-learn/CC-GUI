import { defineConfig, type Plugin } from "vite";
import { THEMES, type Theme } from "./src/theme";

// No-flash boot: inject the default light/dark CSS var sets (derived from the
// theme registry — single source, no drift) plus a tiny pre-paint script that
// picks the appearance from localStorage + the OS preference before first paint.
// `html[data-appearance=…]` (specificity 0,1,1) overrides the :root defaults
// (0,1,0) regardless of source order; runtime inline styles from applyTheme()
// override both after hydration.
function themeBoot(): Plugin {
  const byAppearance = (a: Theme["appearance"]) =>
    Object.values(THEMES).find((t) => t.appearance === a)!;
  const block = (sel: string, t: Theme) =>
    `${sel}{${Object.entries(t.cssVars)
      .map(([k, v]) => `--${k}:${v}`)
      .join(";")}}`;
  const css =
    block('html[data-appearance="dark"]', byAppearance("dark")) +
    block('html[data-appearance="light"]', byAppearance("light"));
  const script =
    "try{var m=localStorage.getItem('cc-theme-mode')||'system';" +
    "var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);" +
    "document.documentElement.dataset.appearance=d?'dark':'light';}catch(e){}";
  return {
    name: "theme-boot",
    transformIndexHtml: () => [
      { tag: "style", injectTo: "head", children: css },
      { tag: "script", injectTo: "head", children: script },
    ],
  };
}

// Tauri expects a fixed dev port (see src-tauri/tauri.conf.json devUrl)
export default defineConfig({
  plugins: [themeBoot()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
