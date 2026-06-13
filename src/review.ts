import { invoke } from "@tauri-apps/api/core";
import { makeResizable } from "./resize";
import { currentTheme, onThemeChange } from "./theme";

// Mirrors claude-commander's ReviewSnapshot (api.rs / git/review_diff.rs /
// comment/mod.rs) — all snake_case via serde.

type LineOrigin = "context" | "addition" | "deletion";

type DiffLine = {
  origin: LineOrigin;
  old_lineno: number | null;
  new_lineno: number | null;
  content: string;
};

type Hunk = {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  header: string;
  lines: DiffLine[];
};

type FileStatus = "added" | "deleted" | "modified" | "renamed";

type FileDiff = {
  old_path: string;
  new_path: string;
  status: FileStatus;
  added: number;
  removed: number;
  hunks: Hunk[];
};

type Comment = {
  id: string;
  file: string;
  side: "old" | "new";
  line_range: [number, number];
  snippet: string;
  comment: string;
  status: "staged" | "drifted" | "applied";
  created_at: string;
};

type ReviewSnapshot = {
  base: string;
  diff: { files: FileDiff[] };
  comments: Comment[];
};

type ApplyOutcome =
  | { outcome: "nothing" }
  | { outcome: "blocked"; drifted: string[] }
  | { outcome: "applied"; path: string; count: number }
  | { outcome: "deferred"; path: string; count: number };

// ------------------------------------------------------- syntax highlighting

type ThemedToken = { content: string; color?: string };

const EXT_LANG: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  py: "python",
  go: "go",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  scss: "scss",
  html: "html",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  sql: "sql",
  xml: "xml",
  vue: "vue",
  svelte: "svelte",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let highlighterPromise: Promise<any> | null = null;

function getHighlighter() {
  highlighterPromise ??= import("shiki").then((shiki) =>
    shiki.createHighlighter({
      themes: ["catppuccin-mocha", "catppuccin-latte"],
      langs: [],
    }),
  );
  return highlighterPromise;
}

/** Per-file token cache: hunk index → line index → tokens. Reset on refresh. */
const tokenCache = new Map<string, ThemedToken[][][] | null>();

/**
 * Tokenize a file's hunks with shiki (language from the extension). Each hunk
 * is highlighted as one block so multi-line constructs mostly survive; the
 * missing cross-hunk context is an accepted approximation. Returns null when
 * the language is unknown or shiki fails — callers fall back to plain text.
 */
async function prepareHighlights(file: FileDiff): Promise<void> {
  const path = displayPath(file);
  if (tokenCache.has(path)) return;
  const ext = path.split(".").pop() ?? "";
  const lang = EXT_LANG[ext];
  if (!lang) {
    tokenCache.set(path, null);
    return;
  }
  try {
    const hl = await getHighlighter();
    await hl.loadLanguage(lang);
    const hunks = file.hunks.map((hunk) => {
      const code = hunk.lines.map((l) => l.content).join("\n");
      const result = hl.codeToTokens(code, { lang, theme: currentTheme().shiki });
      const tokens = result.tokens as ThemedToken[][];
      // Token rows must map 1:1 onto hunk lines; on any drift (e.g. line-
      // ending normalization) fall back to plain text rather than misalign.
      return tokens.length === hunk.lines.length ? tokens : [];
    });
    tokenCache.set(path, hunks);
  } catch {
    tokenCache.set(path, null);
  }
}

const reviewEl = document.querySelector<HTMLDivElement>("#review")!;
const titleEl = document.querySelector<HTMLSpanElement>("#review-title")!;
const baseEl = document.querySelector<HTMLSpanElement>("#review-base")!;
const statusEl = document.querySelector<HTMLSpanElement>("#review-status")!;
const applyEl = document.querySelector<HTMLButtonElement>("#review-apply")!;
const filesEl = document.querySelector<HTMLDivElement>("#review-files")!;
const diffEl = document.querySelector<HTMLDivElement>("#review-diff")!;

makeResizable({ key: "cc-review-files-width", target: filesEl, edge: "right", min: 180, max: 640 });

let sessionId: string | null = null;
let snapshot: ReviewSnapshot | null = null;
let selectedFile: string | null = null;

// Line selection for a new comment: inclusive index range into the rendered
// (selectable) lines of the current file, in click order.
let selection: { anchor: number; head: number } | null = null;
let draftText = ""; // survives re-renders while extending the selection
let applying = false;

function displayPath(f: FileDiff): string {
  return f.status === "deleted" ? f.old_path : f.new_path;
}

const STATUS_LETTER: Record<FileStatus, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
};

export async function openReview(id: string, title: string): Promise<void> {
  sessionId = id;
  titleEl.textContent = title;
  baseEl.textContent = "";
  statusEl.textContent = "";
  clearSelection();
  filesEl.innerHTML = "";
  diffEl.innerHTML = '<div class="review-empty">Loading…</div>';
  reviewEl.classList.remove("hidden");
  await refresh();
}

async function refresh(): Promise<void> {
  if (!sessionId) return;
  const id = sessionId;
  let snap: ReviewSnapshot;
  try {
    snap = await invoke<ReviewSnapshot>("open_review", { id });
  } catch (e) {
    diffEl.innerHTML = "";
    const err = document.createElement("div");
    err.className = "review-empty error";
    err.textContent = `Failed to open review: ${e}`;
    diffEl.appendChild(err);
    return;
  }
  if (sessionId !== id) return; // closed or switched while loading
  snapshot = snap;
  tokenCache.clear();
  baseEl.textContent = `vs ${snap.base}`;
  if (!snap.diff.files.some((f) => displayPath(f) === selectedFile)) {
    selectedFile = snap.diff.files.length ? displayPath(snap.diff.files[0]) : null;
    clearSelection();
  }
  renderFiles();
  renderDiff();
  renderApply();
  highlightCurrentFile();
}

/** Tokenize the selected file in the background, then re-render with color. */
function highlightCurrentFile(): void {
  const file = currentFile();
  if (!file || tokenCache.has(displayPath(file))) return;
  const path = displayPath(file);
  void prepareHighlights(file).then(() => {
    // Still looking at the same file once tokens are ready?
    if (selectedFile === path && tokenCache.get(path)) renderDiff();
  });
}

// Re-highlight on theme change. Token colors are baked into the rendered spans
// (span.style.color), so clearing the cache is not enough — we must re-tokenize
// the open file with the new theme and rebuild the DOM. Mirrors refresh()'s
// render-then-highlight sequence.
onThemeChange(() => {
  if (!sessionId) return; // review not open
  tokenCache.clear();
  renderDiff();
  highlightCurrentFile();
});

export function closeReview(): void {
  sessionId = null;
  snapshot = null;
  clearSelection();
  reviewEl.classList.add("hidden");
}

function clearSelection(): void {
  selection = null;
  draftText = "";
}

function currentFile(): FileDiff | undefined {
  return snapshot?.diff.files.find((f) => displayPath(f) === selectedFile);
}

// ------------------------------------------------------------------- files

function renderFiles(): void {
  filesEl.innerHTML = "";
  if (!snapshot) return;
  const commentCounts = new Map<string, number>();
  for (const c of snapshot.comments) {
    commentCounts.set(c.file, (commentCounts.get(c.file) ?? 0) + 1);
  }
  // Diff files arrive path-sorted, so same-directory files are contiguous:
  // emit a directory header whenever the dirname changes and show basenames.
  let lastDir: string | null = null;
  for (const f of snapshot.diff.files) {
    const path = displayPath(f);
    const slash = path.lastIndexOf("/");
    const dir = slash === -1 ? "" : path.slice(0, slash);
    if (dir !== lastDir) {
      lastDir = dir;
      const header = document.createElement("div");
      header.className = "review-dir";
      header.textContent = dir === "" ? "./" : `${dir}/`;
      header.title = header.textContent;
      filesEl.appendChild(header);
    }

    const row = document.createElement("div");
    row.className = "review-file";
    row.classList.toggle("active", path === selectedFile);

    const status = document.createElement("span");
    status.className = `file-status file-${f.status}`;
    status.textContent = STATUS_LETTER[f.status];

    const name = document.createElement("span");
    name.className = "file-path";
    name.textContent = path.slice(slash + 1);
    name.title = f.status === "renamed" ? `${f.old_path} → ${f.new_path}` : path;

    const counts = document.createElement("span");
    counts.className = "file-counts";
    const comments = commentCounts.get(path);
    if (comments) {
      const c = document.createElement("span");
      c.className = "file-comments";
      c.textContent = `🗨${comments}`;
      counts.appendChild(c);
    }
    const added = document.createElement("span");
    added.className = "added";
    added.textContent = `+${f.added}`;
    const removed = document.createElement("span");
    removed.className = "removed";
    removed.textContent = `-${f.removed}`;
    counts.append(added, removed);

    row.append(status, name, counts);
    row.addEventListener("click", () => {
      selectedFile = path;
      clearSelection();
      renderFiles();
      renderDiff();
      highlightCurrentFile();
    });
    filesEl.appendChild(row);
  }
  if (!snapshot.diff.files.length) {
    const empty = document.createElement("div");
    empty.className = "review-empty";
    empty.textContent = "No changes";
    filesEl.appendChild(empty);
  }
}

// ---------------------------------------------------------------- comments

/** Comments anchored to a line: keyed by `${side}:${end-of-range lineno}`. */
function commentsByAnchor(path: string): Map<string, Comment[]> {
  const map = new Map<string, Comment[]>();
  if (!snapshot) return map;
  for (const c of snapshot.comments) {
    if (c.file !== path) continue;
    const key = `${c.side}:${c.line_range[1]}`;
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  return map;
}

function renderCommentBlock(c: Comment): HTMLDivElement {
  const block = document.createElement("div");
  block.className = "review-comment";
  const head = document.createElement("div");
  head.className = "comment-head";
  const badge = document.createElement("span");
  badge.className = `comment-status comment-${c.status}`;
  badge.textContent = c.status;
  const range = document.createElement("span");
  range.className = "comment-range";
  const [start, end] = c.line_range;
  range.textContent = `${c.side} ${start === end ? start : `${start}–${end}`}`;
  head.append(badge, range);
  if (c.status !== "applied") {
    const spacer = document.createElement("span");
    spacer.className = "spacer";
    const del = document.createElement("button");
    del.className = "comment-delete";
    del.textContent = "✕";
    del.title = "Delete comment";
    del.addEventListener("click", () => void deleteComment(c.id));
    head.append(spacer, del);
  }
  const body = document.createElement("div");
  body.className = "comment-body";
  body.textContent = c.comment;
  block.append(head, body);
  return block;
}

async function deleteComment(commentId: string): Promise<void> {
  if (!sessionId) return;
  try {
    await invoke("delete_comment", { id: sessionId, commentId });
  } catch (e) {
    statusEl.textContent = `delete failed: ${e}`;
    return;
  }
  await refresh();
}

/**
 * Build the comment draft from the selected lines, mirroring the TUI's
 * `build_draft`: the New side wins unless the selection is purely deletions,
 * and the snippet/line range come from that side's lines only.
 */
async function saveComment(lines: DiffLine[], comment: string): Promise<void> {
  const file = currentFile();
  if (!sessionId || !file || !comment.trim()) return;
  const side = lines.some((l) => l.new_lineno !== null) ? "new" : "old";
  const collected = lines
    .map((l) => ({ n: side === "new" ? l.new_lineno : l.old_lineno, content: l.content }))
    .filter((x): x is { n: number; content: string } => x.n !== null);
  if (!collected.length) return;
  const nums = collected.map((x) => x.n);
  try {
    await invoke("create_comment", {
      id: sessionId,
      file: displayPath(file),
      side,
      lineRange: [Math.min(...nums), Math.max(...nums)],
      snippet: collected.map((x) => x.content).join("\n"),
      comment: comment.trim(),
    });
  } catch (e) {
    statusEl.textContent = `comment failed: ${e}`;
    return;
  }
  clearSelection();
  await refresh();
}

function renderCommentEditor(lines: DiffLine[]): HTMLDivElement {
  const box = document.createElement("div");
  box.className = "review-comment editor";
  const textarea = document.createElement("textarea");
  textarea.placeholder = "Leave a comment for the agent… (Cmd/Ctrl+Enter to save, Esc to cancel)";
  textarea.rows = 3;
  textarea.value = draftText;
  textarea.addEventListener("input", () => {
    draftText = textarea.value;
  });
  textarea.addEventListener("keydown", (e) => {
    e.stopPropagation(); // keep Esc from closing the whole review view
    if (e.key === "Escape") {
      clearSelection();
      renderDiff();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      void saveComment(lines, textarea.value);
    }
  });

  const buttons = document.createElement("div");
  buttons.className = "editor-buttons";
  const cancel = document.createElement("button");
  cancel.className = "row-action";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    clearSelection();
    renderDiff();
  });
  const save = document.createElement("button");
  save.className = "row-action";
  save.textContent = "Comment";
  save.addEventListener("click", () => void saveComment(lines, textarea.value));
  buttons.append(cancel, save);

  box.append(textarea, buttons);
  setTimeout(() => {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, 0);
  return box;
}

// -------------------------------------------------------------------- diff

function renderDiff(): void {
  diffEl.innerHTML = "";
  if (!snapshot) return;
  const file = currentFile();
  if (!file) {
    const empty = document.createElement("div");
    empty.className = "review-empty";
    empty.textContent = "No changes";
    diffEl.appendChild(empty);
    return;
  }
  const anchors = commentsByAnchor(displayPath(file));

  const selStart = selection ? Math.min(selection.anchor, selection.head) : -1;
  const selEnd = selection ? Math.max(selection.anchor, selection.head) : -1;
  const flatLines: DiffLine[] = file.hunks.flatMap((h) => h.lines);
  const fileTokens = tokenCache.get(displayPath(file)) ?? null;
  let idx = 0;
  let editorAnchorRow: HTMLDivElement | null = null;

  for (const [hunkIdx, hunk] of file.hunks.entries()) {
    const header = document.createElement("div");
    header.className = "hunk-header";
    header.textContent =
      `@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@` +
      (hunk.header ? ` ${hunk.header}` : "");
    diffEl.appendChild(header);

    for (const [lineInHunk, line] of hunk.lines.entries()) {
      const lineIdx = idx++;
      const row = document.createElement("div");
      row.className = `diff-line diff-${line.origin}`;
      row.classList.toggle("selected", lineIdx >= selStart && lineIdx <= selEnd);

      const oldNo = document.createElement("span");
      oldNo.className = "lineno";
      oldNo.textContent = line.old_lineno?.toString() ?? "";
      const newNo = document.createElement("span");
      newNo.className = "lineno";
      newNo.textContent = line.new_lineno?.toString() ?? "";

      const marker = { context: " ", addition: "+", deletion: "-" }[line.origin];
      const content = document.createElement("span");
      content.className = "line-content";
      const tokens = fileTokens?.[hunkIdx]?.[lineInHunk];
      if (tokens) {
        // Syntax colors on token spans; the add/delete signal stays on the
        // row background (plain diff colors remain the un-highlighted
        // fallback via CSS).
        content.textContent = marker;
        for (const t of tokens) {
          const span = document.createElement("span");
          span.textContent = t.content;
          if (t.color) span.style.color = t.color;
          content.appendChild(span);
        }
      } else {
        content.textContent = `${marker}${line.content}`;
      }

      row.append(oldNo, newNo, content);
      row.addEventListener("click", (e) => {
        if (e.shiftKey && selection) {
          selection.head = lineIdx;
        } else if (selection?.anchor === lineIdx && selection.head === lineIdx) {
          clearSelection(); // click the sole selected line again to deselect
        } else {
          selection = { anchor: lineIdx, head: lineIdx };
        }
        renderDiff();
      });
      diffEl.appendChild(row);
      if (lineIdx === selEnd) editorAnchorRow = row;

      // Comments anchor to the end of their range on their side. Old/new line
      // numbers are unique within a file, so each comment matches one line.
      const lineComments = [
        ...(line.new_lineno ? (anchors.get(`new:${line.new_lineno}`) ?? []) : []),
        ...(line.old_lineno ? (anchors.get(`old:${line.old_lineno}`) ?? []) : []),
      ];
      for (const c of lineComments) {
        diffEl.appendChild(renderCommentBlock(c));
      }
    }
  }

  if (selection && editorAnchorRow) {
    const selLines = flatLines.slice(selStart, selEnd + 1);
    editorAnchorRow.after(renderCommentEditor(selLines));
  }
}

// ------------------------------------------------------------------- apply

function renderApply(): void {
  if (!snapshot) {
    applyEl.classList.add("hidden");
    return;
  }
  const pending = snapshot.comments.filter((c) => c.status !== "applied").length;
  applyEl.classList.toggle("hidden", pending === 0);
  applyEl.disabled = applying;
  applyEl.textContent = applying ? "Applying…" : `Apply (${pending})`;
}

function describeOutcome(o: ApplyOutcome): string {
  switch (o.outcome) {
    case "nothing":
      return "Nothing to apply";
    case "blocked":
      return `Blocked: ${o.drifted.length} drifted comment(s) — review or delete them first`;
    case "applied":
      return `Sent ${o.count} comment(s) to the agent`;
    case "deferred":
      return `Agent not ready — brief written to ${o.path}; re-apply later`;
  }
}

async function applyComments(): Promise<void> {
  if (!sessionId || applying) return;
  applying = true;
  statusEl.textContent = "";
  renderApply();
  try {
    const outcome = await invoke<ApplyOutcome>("apply_comments", { id: sessionId });
    statusEl.textContent = describeOutcome(outcome);
  } catch (e) {
    statusEl.textContent = `apply failed: ${e}`;
  }
  applying = false;
  await refresh();
}

document.querySelector("#review-close")!.addEventListener("click", closeReview);
document.querySelector("#review-refresh")!.addEventListener("click", () => void refresh());
applyEl.addEventListener("click", () => void applyComments());
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || reviewEl.classList.contains("hidden")) return;
  if (selection) {
    clearSelection();
    renderDiff();
  } else {
    closeReview();
  }
});
