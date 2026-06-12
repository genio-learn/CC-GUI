import { invoke } from "@tauri-apps/api/core";

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

const reviewEl = document.querySelector<HTMLDivElement>("#review")!;
const titleEl = document.querySelector<HTMLSpanElement>("#review-title")!;
const baseEl = document.querySelector<HTMLSpanElement>("#review-base")!;
const filesEl = document.querySelector<HTMLDivElement>("#review-files")!;
const diffEl = document.querySelector<HTMLDivElement>("#review-diff")!;

let sessionId: string | null = null;
let snapshot: ReviewSnapshot | null = null;
let selectedFile: string | null = null;

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
  baseEl.textContent = `vs ${snap.base}`;
  if (!snap.diff.files.some((f) => displayPath(f) === selectedFile)) {
    selectedFile = snap.diff.files.length ? displayPath(snap.diff.files[0]) : null;
  }
  renderFiles();
  renderDiff();
}

export function closeReview(): void {
  sessionId = null;
  snapshot = null;
  reviewEl.classList.add("hidden");
}

function renderFiles(): void {
  filesEl.innerHTML = "";
  if (!snapshot) return;
  const commentCounts = new Map<string, number>();
  for (const c of snapshot.comments) {
    commentCounts.set(c.file, (commentCounts.get(c.file) ?? 0) + 1);
  }
  for (const f of snapshot.diff.files) {
    const path = displayPath(f);
    const row = document.createElement("div");
    row.className = "review-file";
    row.classList.toggle("active", path === selectedFile);

    const status = document.createElement("span");
    status.className = `file-status file-${f.status}`;
    status.textContent = STATUS_LETTER[f.status];

    const name = document.createElement("span");
    name.className = "file-path";
    name.textContent = path;
    name.title = f.status === "renamed" ? `${f.old_path} → ${f.new_path}` : path;

    const counts = document.createElement("span");
    counts.className = "file-counts";
    const comments = commentCounts.get(path);
    counts.innerHTML = "";
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
      renderFiles();
      renderDiff();
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
  const body = document.createElement("div");
  body.className = "comment-body";
  body.textContent = c.comment;
  block.append(head, body);
  return block;
}

function renderDiff(): void {
  diffEl.innerHTML = "";
  if (!snapshot) return;
  const file = snapshot.diff.files.find((f) => displayPath(f) === selectedFile);
  if (!file) {
    const empty = document.createElement("div");
    empty.className = "review-empty";
    empty.textContent = "No changes";
    diffEl.appendChild(empty);
    return;
  }
  const anchors = commentsByAnchor(displayPath(file));

  for (const hunk of file.hunks) {
    const header = document.createElement("div");
    header.className = "hunk-header";
    header.textContent =
      `@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@` +
      (hunk.header ? ` ${hunk.header}` : "");
    diffEl.appendChild(header);

    for (const line of hunk.lines) {
      const row = document.createElement("div");
      row.className = `diff-line diff-${line.origin}`;

      const oldNo = document.createElement("span");
      oldNo.className = "lineno";
      oldNo.textContent = line.old_lineno?.toString() ?? "";
      const newNo = document.createElement("span");
      newNo.className = "lineno";
      newNo.textContent = line.new_lineno?.toString() ?? "";

      const marker = { context: " ", addition: "+", deletion: "-" }[line.origin];
      const content = document.createElement("span");
      content.className = "line-content";
      content.textContent = `${marker}${line.content}`;

      row.append(oldNo, newNo, content);
      diffEl.appendChild(row);

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
}

document.querySelector("#review-close")!.addEventListener("click", closeReview);
document.querySelector("#review-refresh")!.addEventListener("click", () => void refresh());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !reviewEl.classList.contains("hidden")) closeReview();
});
