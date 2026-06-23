// Fuzzy command/session palette (Cmd/Ctrl+K). Sessions attach on Enter;
// commands run their action. Subsequence match with a simple score:
// earlier + contiguous matches rank higher.

import { noTextAssist } from "./dom";

export type PaletteEntry = {
  label: string;
  hint: string;
  action: () => void;
  /** Which section the entry renders under. Defaults to "command" so command
   *  providers need no change; the session provider marks its entries. */
  kind?: "session" | "command";
  /** Session-only: liveness-dot class (e.g. "dot-running") and the project +
   *  human-readable state shown alongside the name. */
  dotClass?: string;
  project?: string;
  state?: string;
};

let providers: (() => PaletteEntry[])[] = [];

export function registerPaletteProvider(p: () => PaletteEntry[]): void {
  providers.push(p);
}

export function score(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let s = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      s += 10 + streak * 5 - ti; // contiguous + early bonus
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? s : null;
}

const overlay = document.createElement("div");
overlay.id = "palette";
overlay.classList.add("hidden");
const box = document.createElement("div");
box.className = "palette-box";
const header = document.createElement("div");
header.className = "palette-header";
const kbd = document.createElement("span");
kbd.className = "palette-kbd";
kbd.textContent = "⌘";
const input = noTextAssist(document.createElement("input"));
input.placeholder = "Jump to session or run a command…";
const esc = document.createElement("span");
esc.className = "palette-esc";
esc.textContent = "esc";
header.append(kbd, input, esc);
const list = document.createElement("div");
list.className = "palette-list";
box.append(header, list);
overlay.appendChild(box);
document.body.appendChild(overlay);

let entries: PaletteEntry[] = [];
let filtered: PaletteEntry[] = [];
let selected = 0;

function openPalette(): void {
  entries = providers.flatMap((p) => p());
  input.value = "";
  selected = 0;
  overlay.classList.remove("hidden");
  refilter();
  setTimeout(() => input.focus(), 0);
}

function closePalette(): void {
  overlay.classList.add("hidden");
}

export function togglePalette(): void {
  if (overlay.classList.contains("hidden")) openPalette();
  else closePalette();
}

/** Sessions render in their own section above Commands, so group them ahead of
 *  commands while preserving the per-kind order (provider order or score). */
function kindRank(e: PaletteEntry): number {
  return e.kind === "session" ? 0 : 1;
}

function refilter(): void {
  const q = input.value.trim();
  const ranked = !q
    ? entries.slice(0, 30)
    : entries
        .map((e) => ({ e, s: score(q, `${e.label} ${e.hint}`) }))
        .filter((x): x is { e: PaletteEntry; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .slice(0, 30)
        .map((x) => x.e);
  // Stable group-by-kind: sessions first, commands after, order within each
  // kind preserved (Array.sort is stable on V8).
  filtered = ranked.slice().sort((a, b) => kindRank(a) - kindRank(b));
  selected = Math.min(selected, Math.max(0, filtered.length - 1));
  renderList();
}

function groupLabel(kind: PaletteEntry["kind"]): string {
  return kind === "session" ? "Sessions" : "Commands";
}

function renderList(): void {
  list.innerHTML = "";
  let lastKind: PaletteEntry["kind"] | null = null;
  filtered.forEach((e, i) => {
    const kind = e.kind ?? "command";
    if (kind !== lastKind) {
      const group = document.createElement("div");
      group.className = "palette-group";
      group.textContent = groupLabel(kind);
      list.appendChild(group);
      lastKind = kind;
    }
    const row = document.createElement("div");
    row.className = "palette-row";
    row.classList.toggle("selected", i === selected);
    // Label stays the first <span> child (test/page-object contract).
    const label = document.createElement("span");
    label.className = "palette-label";
    label.textContent = e.label;
    if (kind === "session") {
      // Non-<span> so the label stays the row's first <span> (test contract).
      const dot = document.createElement("i");
      dot.className = `palette-dot dot ${e.dotClass ?? ""}`.trim();
      const project = document.createElement("span");
      project.className = "palette-meta";
      project.textContent = e.project ?? "";
      const state = document.createElement("span");
      state.className = "palette-state";
      state.textContent = e.state ?? "";
      row.append(dot, label, project, state);
    } else {
      // Non-<span> so the label stays the row's first <span> (test contract).
      const icon = document.createElement("i");
      icon.className = "palette-icon";
      icon.textContent = "⌥";
      const hint = document.createElement("span");
      hint.className = "palette-hint";
      hint.textContent = e.hint;
      row.append(icon, label, hint);
    }
    row.addEventListener("click", () => {
      closePalette();
      e.action();
    });
    list.appendChild(row);
  });
}

input.addEventListener("input", () => {
  selected = 0;
  refilter();
});
input.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Escape") closePalette();
  if (e.key === "ArrowDown") {
    selected = Math.min(selected + 1, filtered.length - 1);
    renderList();
  }
  if (e.key === "ArrowUp") {
    selected = Math.max(selected - 1, 0);
    renderList();
  }
  if (e.key === "Enter" && filtered[selected]) {
    closePalette();
    filtered[selected].action();
  }
});
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closePalette();
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    if (overlay.classList.contains("hidden")) openPalette();
    else closePalette();
  }
});
