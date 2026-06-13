// Theme picker modal: lists the themes for one appearance with a live preview as
// you browse. Enter/click commits (sets that appearance's slot and switches to it
// via chooseTheme); Esc restores the previously-applied theme.

import {
  allThemes,
  chooseTheme,
  previewTheme,
  applyTheme,
  resolveTheme,
  preferredTheme,
  type Appearance,
} from "./theme";

// Swatch roles shown per row — a quick visual read of each theme.
const SWATCH_KEYS = ["bg-base", "accent", "success", "danger", "info"];

let open = false;

export function openThemeModal(appearance: Appearance): void {
  if (open) return;
  const themes = allThemes().filter((t) => t.appearance === appearance);
  if (!themes.length) return;
  const currentId = preferredTheme(appearance).id;
  let selected = Math.max(0, themes.findIndex((t) => t.id === currentId));
  open = true;

  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  const box = document.createElement("div");
  box.className = "theme-modal";
  box.tabIndex = -1;

  const title = document.createElement("div");
  title.className = "theme-modal-title";
  title.textContent = appearance === "dark" ? "Set dark theme" : "Set light theme";
  const list = document.createElement("div");
  list.className = "theme-modal-list";
  const hint = document.createElement("div");
  hint.className = "theme-modal-hint";
  hint.textContent = "↑↓ preview · Enter keep · Esc cancel";
  box.append(title, list, hint);
  overlay.appendChild(box);

  const rows = themes.map((t, i) => {
    const row = document.createElement("div");
    row.className = "theme-modal-row";
    const swatches = document.createElement("span");
    swatches.className = "theme-swatches";
    for (const key of SWATCH_KEYS) {
      const dot = document.createElement("span");
      dot.className = "theme-swatch";
      dot.style.background = t.cssVars[key] ?? "transparent";
      swatches.appendChild(dot);
    }
    const label = document.createElement("span");
    label.className = "theme-modal-label";
    label.textContent = t.label;
    row.append(swatches, label);
    if (t.id === currentId) {
      const cur = document.createElement("span");
      cur.className = "theme-modal-current";
      cur.textContent = "current";
      row.appendChild(cur);
    }
    if (t.source === "custom") {
      const tag = document.createElement("span");
      tag.className = "theme-modal-tag";
      tag.textContent = "custom";
      row.appendChild(tag);
    }
    row.addEventListener("mouseenter", () => select(i));
    row.addEventListener("click", commit);
    list.appendChild(row);
    return row;
  });

  function render(): void {
    rows.forEach((r, i) => r.classList.toggle("selected", i === selected));
    rows[selected]?.scrollIntoView({ block: "nearest" });
  }
  function select(i: number): void {
    selected = i;
    previewTheme(themes[selected]);
    render();
  }
  function close(): void {
    open = false;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  }
  function commit(): void {
    chooseTheme(themes[selected]);
    close();
  }
  function cancel(): void {
    applyTheme(resolveTheme()); // revert to the saved selection
    close();
  }
  function onKey(e: KeyboardEvent): void {
    e.stopPropagation(); // owns the keyboard while open
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); select(Math.min(selected + 1, themes.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); select(Math.max(selected - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); commit(); }
  }

  document.addEventListener("keydown", onKey, true);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cancel(); });

  document.body.appendChild(overlay);
  render();
  previewTheme(themes[selected]); // live-preview the current selection on open
  box.focus();
}
