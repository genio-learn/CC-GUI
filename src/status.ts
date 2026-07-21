// Shared status-chip component: shape + colour + word. The single visual
// vocabulary for session state (screen 08 of the Refined redesign), reused
// across the sidebar rows, board cards, and project headers — replacing the
// old colour-only dots and the bare ✎/⚠ glyph badges.
//
// Pure DOM, no Tauri and no imports from main.ts: the session → state
// derivation stays in main.ts (which reads applyStatusGlyph's output and passes
// the already-derived state key here), so the chips and the terminal tabs'
// compact dots stay in lockstep without a circular import.

/** Semantic colour role a chip paints itself with (background is a wash of it). */
type ChipTone = "success" | "warning" | "cyan" | "dim" | "danger" | "info";

/** Liveness states, mirroring applyStatusGlyph's `dot-*` classes 1:1
 *  (`dot-running` → "running", …). main.ts derives these from a session. */
export type StatusState =
  | "running"
  | "finished"
  | "idle"
  | "stopped"
  | "waiting"
  | "hibernated"
  | "transient";

interface ChipSpec {
  tone: ChipTone;
  /** Leading colour dot (liveness states). Mutually exclusive with `glyph`. */
  dot?: boolean;
  /** Leading glyph (✎ ⚠ ⌗ ❯ ? ☾). Mutually exclusive with `dot`. */
  glyph?: string;
  label: string;
  /** Optional count, rendered in `var(--font-mono)`. */
  count?: number;
  /** Count before the label ("✎ 3 comments") vs after ("⌗ Stack of 3"). */
  countBefore?: boolean;
  title?: string;
}

function countEl(n: number): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "chip-count";
  el.textContent = String(n);
  return el;
}

function makeChip(spec: ChipSpec): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = `status-chip tone-${spec.tone}`;
  if (spec.title) chip.title = spec.title;

  if (spec.dot) {
    const dot = document.createElement("span");
    dot.className = "chip-dot";
    chip.appendChild(dot);
  } else if (spec.glyph) {
    const g = document.createElement("span");
    g.className = "chip-glyph";
    g.textContent = spec.glyph;
    chip.appendChild(g);
  }

  const count = spec.count !== undefined ? countEl(spec.count) : null;
  if (count && spec.countBefore) chip.appendChild(count);
  const label = document.createElement("span");
  label.className = "chip-label";
  label.textContent = spec.label;
  chip.appendChild(label);
  if (count && !spec.countBefore) chip.appendChild(count);

  return chip;
}

/** state → chip presentation. `word` is the default label; the `transient`
 *  caller overrides it with the humanized status. Only one warning hue: `Done`
 *  and `Waiting` share `--warning` but differ by shape (dot vs "?") and word. */
const STATE_CHIP: Record<StatusState, { tone: ChipTone; word: string; dot?: boolean; glyph?: string }> = {
  running: { tone: "success", word: "Running", dot: true },
  finished: { tone: "warning", word: "Done", dot: true },
  idle: { tone: "cyan", word: "Idle", dot: true },
  stopped: { tone: "dim", word: "Stopped", dot: true },
  waiting: { tone: "warning", word: "Waiting", glyph: "?" },
  hibernated: { tone: "dim", word: "Hibernated", glyph: "☾" },
  transient: { tone: "warning", word: "Working", dot: true },
};

/** The labeled liveness chip for a derived session state. */
export function statusChip(
  state: StatusState,
  opts: { word?: string; title?: string } = {},
): HTMLSpanElement {
  const base = STATE_CHIP[state];
  const label = opts.word ?? base.word;
  return makeChip({
    tone: base.tone,
    dot: base.dot,
    glyph: base.glyph,
    label,
    title: opts.title ?? label,
  });
}

/** ✎ pending-review-comments badge. Spells out a count when one is known
 *  ("✎ 3 comments"); otherwise just "✎ Comments". */
export function commentsChip(count?: number, title?: string): HTMLSpanElement {
  return makeChip({
    tone: "info",
    glyph: "✎",
    label: count === undefined ? "Comments" : count === 1 ? "comment" : "comments",
    count,
    countBefore: true,
    title,
  });
}

/** ⚠ pull-blocked badge — the single reserved "this is blocked" colour
 *  (`--danger`), collapsing the old maroon/peach double-warning ambiguity. */
export function pullBlockedChip(title?: string): HTMLSpanElement {
  return makeChip({ tone: "danger", glyph: "⚠", label: "Pull blocked", title });
}

/** ⌗ cascade-stack badge ("⌗ Stack of 3"). */
export function stackChip(count: number, title?: string): HTMLSpanElement {
  return makeChip({ tone: "info", glyph: "⌗", label: "Stack of", count, title });
}

/** ❯ shell badge. Purple/info tone, grouping it with ✎ comments and ⌗ stack
 *  (all the "meta" glyphs in the decoded vocabulary are mauve) and keeping the
 *  blue --accent reserved for primary actions. The prototype's #8a7cff sits in
 *  that mauve family, not the accent blue. */
export function shellChip(title?: string): HTMLSpanElement {
  return makeChip({ tone: "info", glyph: "❯", label: "Shell", title });
}
