// Fuzzy command/session palette (Cmd/Ctrl+K). Sessions attach on Enter;
// commands run their action. Subsequence match with a simple score:
// earlier + contiguous matches rank higher.

import { noTextAssist } from "./dom";

export type PaletteEntry = {
  label: string;
  hint: string;
  action: () => void;
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
const input = noTextAssist(document.createElement("input"));
input.placeholder = "Jump to session or run a command…";
const list = document.createElement("div");
list.className = "palette-list";
box.append(input, list);
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

function refilter(): void {
  const q = input.value.trim();
  filtered = !q
    ? entries.slice(0, 30)
    : entries
        .map((e) => ({ e, s: score(q, `${e.label} ${e.hint}`) }))
        .filter((x): x is { e: PaletteEntry; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .slice(0, 30)
        .map((x) => x.e);
  selected = Math.min(selected, Math.max(0, filtered.length - 1));
  renderList();
}

function renderList(): void {
  list.innerHTML = "";
  filtered.forEach((e, i) => {
    const row = document.createElement("div");
    row.className = "palette-row";
    row.classList.toggle("selected", i === selected);
    const label = document.createElement("span");
    label.textContent = e.label;
    const hint = document.createElement("span");
    hint.className = "palette-hint";
    hint.textContent = e.hint;
    row.append(label, hint);
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
