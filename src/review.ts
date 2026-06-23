import { invoke } from "@tauri-apps/api/core";
import { createOnigurumaEngine } from "@shikijs/engine-oniguruma";
import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageInput,
  type ThemeInput,
} from "shiki/core";
import { noTextAssist } from "./dom";
import { makeResizable } from "./resize";
import { currentTheme, onThemeChange, type Theme } from "./theme";
import {
  buildDraft,
  commentsByAnchor,
  describeOutcome,
  displayPath,
  imageMime,
  STATUS_LETTER,
  type ApplyOutcome,
  type Comment,
  type DiffLine,
  type FileDiff,
  type ReviewSnapshot,
} from "./review/model";

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

// Fine-grained Shiki loaders: we bundle only the languages EXT_LANG can name and
// the theme ids the built-in registry uses. Importing the full "shiki" bundle
// instead emits a lazy chunk for every one of Shiki's ~270 langs and ~60 themes
// (almost all unused). Each lang module inlines its embedded grammars (e.g. vue →
// html/css/ts), so loading one is self-contained.
const LANG_LOADERS: Record<string, LanguageInput> = {
  rust: () => import("@shikijs/langs/rust"),
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  python: () => import("@shikijs/langs/python"),
  go: () => import("@shikijs/langs/go"),
  ruby: () => import("@shikijs/langs/ruby"),
  java: () => import("@shikijs/langs/java"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  swift: () => import("@shikijs/langs/swift"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  html: () => import("@shikijs/langs/html"),
  json: () => import("@shikijs/langs/json"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  markdown: () => import("@shikijs/langs/markdown"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  xml: () => import("@shikijs/langs/xml"),
  vue: () => import("@shikijs/langs/vue"),
  svelte: () => import("@shikijs/langs/svelte"),
};

const THEME_LOADERS: Record<string, ThemeInput> = {
  "catppuccin-mocha": () => import("@shikijs/themes/catppuccin-mocha"),
  "catppuccin-latte": () => import("@shikijs/themes/catppuccin-latte"),
  "catppuccin-frappe": () => import("@shikijs/themes/catppuccin-frappe"),
  "catppuccin-macchiato": () => import("@shikijs/themes/catppuccin-macchiato"),
  "tokyo-night": () => import("@shikijs/themes/tokyo-night"),
  "one-dark-pro": () => import("@shikijs/themes/one-dark-pro"),
  dracula: () => import("@shikijs/themes/dracula"),
  nord: () => import("@shikijs/themes/nord"),
  "github-light": () => import("@shikijs/themes/github-light"),
  "solarized-light": () => import("@shikijs/themes/solarized-light"),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter() {
  // Languages and themes load on demand (loadLanguage / ensureShikiTheme) rather
  // than up front: built-ins are bundled ids, custom themes supply a full TextMate
  // object at runtime, so the set isn't known when the highlighter is created.
  highlighterPromise ??= createHighlighterCore({
    themes: [],
    langs: [],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });
  return highlighterPromise;
}

// Shiki language ids already registered in the highlighter, so we never double-load.
const loadedLangs = new Set<string>();

// Shiki theme names already registered in the highlighter, so we never double-load.
const loadedThemes = new Set<string>();

/**
 * Ensure the given theme's Shiki theme is loaded, and return the name to pass to
 * codeToTokens. A built-in's `shiki` is a bundled id (loaded by string); a custom
 * theme's is a full TextMate object whose `name` validateTheme forced to the theme
 * id. Keyed by that name so repeated renders reuse the already-loaded theme.
 */
async function ensureShikiTheme(hl: HighlighterCore, theme: Theme): Promise<string> {
  const shiki = theme.shiki;
  const name = typeof shiki === "string" ? shiki : (shiki.name ?? theme.id);
  if (!loadedThemes.has(name)) {
    // A built-in id loads via its bundled loader; a custom theme's TextMate object
    // is passed straight through.
    await hl.loadTheme(typeof shiki === "string" ? THEME_LOADERS[shiki] : shiki);
    loadedThemes.add(name);
  }
  return name;
}

/** Per-file token cache: hunk index → line index → tokens. Reset on refresh. */
const tokenCache = new Map<string, ThemedToken[][][] | null>();

/** Image data-URL cache, keyed by `${path}\0${side}`. Reset on refresh so a new
 *  snapshot re-reads the bytes; avoids re-fetching on theme change / re-render. */
const imageCache = new Map<string, string>();

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
    if (!loadedLangs.has(lang)) {
      await hl.loadLanguage(LANG_LOADERS[lang]);
      loadedLangs.add(lang);
    }
    const themeName = await ensureShikiTheme(hl, currentTheme());
    const hunks = file.hunks.map((hunk) => {
      const code = hunk.lines.map((l) => l.content).join("\n");
      const result = hl.codeToTokens(code, { lang, theme: themeName });
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
  imageCache.clear();
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
  const draft = buildDraft(lines);
  if (!draft) return;
  try {
    await invoke("create_comment", {
      id: sessionId,
      file: displayPath(file),
      side: draft.side,
      lineRange: draft.lineRange,
      snippet: draft.snippet,
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
  const textarea = noTextAssist(document.createElement("textarea"));
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
  const mime = imageMime(file);
  if (mime) {
    void renderImageDiff(file, mime);
    return;
  }
  const anchors = commentsByAnchor(snapshot.comments, displayPath(file));

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

// ------------------------------------------------------------------ images

/** Fetch one side of an image as a data URL, memoized for this snapshot. */
async function loadImage(
  id: string,
  path: string,
  side: "old" | "new",
  mime: string,
): Promise<string> {
  const key = `${path} ${side}`;
  const cached = imageCache.get(key);
  if (cached) return cached;
  const b64 = await invoke<string>("read_review_image", { id, path, side });
  const url = `data:${mime};base64,${b64}`;
  imageCache.set(key, url);
  return url;
}

/**
 * Render an image file as a before/after comparison instead of text hunks.
 * Added files show only the working image, deleted only the base, and modified
 * files a juxtapose slider. Async because it reads the bytes from the backend;
 * guards against the file/session changing while loading.
 */
async function renderImageDiff(file: FileDiff, mime: string): Promise<void> {
  const id = sessionId;
  const path = displayPath(file);
  if (!id) return;

  const needOld = file.status !== "added";
  const needNew = file.status !== "deleted";
  // A rename moves the blob, so each side lives at its own path; for every
  // other status old_path === new_path.
  const oldPath = file.old_path;
  const newPath = file.new_path;
  const someUncached =
    (needOld && !imageCache.has(`${oldPath} old`)) ||
    (needNew && !imageCache.has(`${newPath} new`));
  if (someUncached) diffEl.innerHTML = '<div class="review-empty">Loading image…</div>';

  let oldUrl: string | null = null;
  let newUrl: string | null = null;
  try {
    if (needOld) oldUrl = await loadImage(id, oldPath, "old", mime);
    if (needNew) newUrl = await loadImage(id, newPath, "new", mime);
  } catch (e) {
    if (sessionId !== id || selectedFile !== path) return;
    diffEl.innerHTML = "";
    const err = document.createElement("div");
    err.className = "review-empty error";
    err.textContent = `Failed to load image: ${e}`;
    diffEl.appendChild(err);
    return;
  }
  if (sessionId !== id || selectedFile !== path) return; // switched away while loading

  diffEl.innerHTML = "";
  const pane = document.createElement("div");
  pane.className = "review-image-pane";
  if (oldUrl && newUrl) pane.appendChild(buildJuxtapose(oldUrl, newUrl));
  else if (newUrl) pane.appendChild(buildSingleImage(newUrl, "added (working)"));
  else if (oldUrl) pane.appendChild(buildSingleImage(oldUrl, "deleted (base)"));
  diffEl.appendChild(pane);
}

function buildSingleImage(url: string, label: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "review-image single";
  const img = document.createElement("img");
  img.src = url;
  img.alt = label;
  const cap = document.createElement("span");
  cap.className = "ji-label";
  cap.textContent = label;
  wrap.append(img, cap);
  return wrap;
}

/** A juxtapose slider: working image underneath, base clipped on top, with a
 *  draggable (and arrow-key-able) divider wiping between them. */
function buildJuxtapose(oldUrl: string, newUrl: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "review-image juxtapose";
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "slider");
  wrap.setAttribute("aria-label", "Image comparison — drag or use arrow keys to wipe");
  wrap.setAttribute("aria-valuemin", "0");
  wrap.setAttribute("aria-valuemax", "100");

  const baseImg = document.createElement("img"); // bottom layer = working (new)
  baseImg.className = "ji-base";
  baseImg.src = newUrl;
  baseImg.alt = "working";

  const overlay = document.createElement("img"); // top layer = base (old), clipped
  overlay.className = "ji-overlay";
  overlay.src = oldUrl;
  overlay.alt = "base";

  const divider = document.createElement("div");
  divider.className = "ji-divider";
  const handle = document.createElement("div");
  handle.className = "ji-handle";
  divider.appendChild(handle);

  const labelOld = document.createElement("span");
  labelOld.className = "ji-label ji-label-old";
  labelOld.textContent = "base";
  const labelNew = document.createElement("span");
  labelNew.className = "ji-label ji-label-new";
  labelNew.textContent = "working";

  wrap.append(baseImg, overlay, divider, labelOld, labelNew);

  let pos = 50;
  const apply = (): void => {
    overlay.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
    divider.style.left = `${pos}%`;
    wrap.setAttribute("aria-valuenow", String(Math.round(pos)));
  };
  apply();

  const setFromX = (clientX: number): void => {
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0) return;
    pos = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    apply();
  };

  let dragging = false;
  wrap.addEventListener("pointerdown", (e) => {
    dragging = true;
    wrap.setPointerCapture(e.pointerId);
    setFromX(e.clientX);
  });
  wrap.addEventListener("pointermove", (e) => {
    if (dragging) setFromX(e.clientX);
  });
  const stop = (e: PointerEvent): void => {
    dragging = false;
    if (wrap.hasPointerCapture(e.pointerId)) wrap.releasePointerCapture(e.pointerId);
  };
  wrap.addEventListener("pointerup", stop);
  wrap.addEventListener("pointercancel", stop);
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") pos = Math.max(0, pos - 2);
    else if (e.key === "ArrowRight") pos = Math.min(100, pos + 2);
    else return;
    e.preventDefault();
    apply();
  });

  return wrap;
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
