// Theme picker popover: anchored top-right under the title-bar "◐" button. Lists
// every theme with a 3-color preview plus a "follow system" toggle, with a live
// preview as you browse. Enter/click commits (chooseTheme, or setMode("system")
// for the toggle); Esc / outside-click restores the previously-applied theme.

import {
  allThemes,
  chooseTheme,
  previewTheme,
  applyTheme,
  resolveTheme,
  currentTheme,
  preferredTheme,
  getMode,
  setMode,
  type Appearance,
} from "./theme";

// Swatch roles shown per row — a quick three-color read of each theme.
const SWATCH_KEYS = ["bg-base", "accent", "info"];

let open = false;

// `appearance` (passed by the palette's per-slot commands) only seeds the initial
// selection; the popover always lists every theme regardless.
export function openThemeModal(appearance?: Appearance): void {
  if (open) return;
  const themes = allThemes();
  if (!themes.length) return;
  const anchor = document.querySelector<HTMLElement>("#tb-theme");
  const followingSystem = getMode() === "system";
  // The resolved active theme always carries the ✓ check, even while following
  // system — it's the theme currently on screen.
  const activeId = currentTheme().id;
  // Seed selection: opening with an explicit appearance highlights that
  // appearance's preferred theme (even in system mode, so [Set dark theme…]
  // lands on the dark slot); otherwise the active theme.
  const seedId = appearance ? preferredTheme(appearance).id : activeId;
  // Rows are [follow-system, ...themes]; -1 marks the toggle as the selected
  // row. Seed onto a concrete theme when an appearance was requested, else the
  // follow-system row when following system.
  let selected =
    appearance || !followingSystem
      ? Math.max(0, themes.findIndex((t) => t.id === seedId))
      : -1;
  open = true;

  // A full-inset, transparent layer catches outside-clicks/Esc (no dark scrim —
  // this is a popover, not a modal); the panel is positioned under the anchor.
  const overlay = document.createElement("div");
  overlay.className = "theme-popover-layer";
  const box = document.createElement("div");
  box.className = "theme-modal theme-popover";
  box.tabIndex = -1;

  const list = document.createElement("div");
  list.className = "theme-modal-list";

  // Follow-system toggle row (logically index -1).
  const followRow = document.createElement("div");
  followRow.className = "theme-modal-row theme-follow-row";
  const followLabel = document.createElement("span");
  followLabel.className = "theme-modal-label";
  followLabel.textContent = "Follow system";
  const followToggle = document.createElement("span");
  followToggle.className = "theme-follow-toggle";
  followToggle.classList.toggle("on", followingSystem);
  followRow.append(followLabel, followToggle);
  followRow.addEventListener("mouseenter", () => select(-1));
  followRow.addEventListener("click", commit);
  list.appendChild(followRow);

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
    if (t.id === activeId) {
      const check = document.createElement("span");
      check.className = "theme-modal-check";
      check.textContent = "✓";
      row.appendChild(check);
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

  box.append(list);
  overlay.appendChild(box);

  function render(): void {
    followRow.classList.toggle("selected", selected === -1);
    rows.forEach((r, i) => r.classList.toggle("selected", i === selected));
    if (selected === -1) followRow.scrollIntoView({ block: "nearest" });
    else rows[selected]?.scrollIntoView({ block: "nearest" });
  }
  function select(i: number): void {
    selected = i;
    // Live-preview: the OS-resolved theme for the follow-system row, else the theme.
    previewTheme(i === -1 ? resolveTheme() : themes[i]);
    render();
  }
  function close(): void {
    open = false;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  }
  function commit(): void {
    if (selected === -1) setMode("system");
    else chooseTheme(themes[selected]);
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
    else if (e.key === "ArrowUp") { e.preventDefault(); select(Math.max(selected - 1, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); commit(); }
  }

  document.addEventListener("keydown", onKey, true);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cancel(); });

  document.body.appendChild(overlay);
  positionPopover(box, anchor);
  render();
  select(selected); // live-preview the seeded selection on open
  box.focus();
}

// Anchor the panel's top-right corner under the trigger button, clamped to the
// viewport (mirrors the context-menu clamping in menu.ts).
function positionPopover(box: HTMLElement, anchor: HTMLElement | null): void {
  const { innerWidth, innerHeight } = window;
  const rect = box.getBoundingClientRect();
  const a = anchor?.getBoundingClientRect();
  const gap = 6;
  const top = a ? a.bottom + gap : 52;
  const right = a ? innerWidth - a.right : 10;
  box.style.top = `${Math.min(top, innerHeight - rect.height - 4)}px`;
  box.style.right = `${Math.max(right, 4)}px`;
}
