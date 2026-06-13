import { describe, it, expect } from "vitest";
import {
  buildDraft,
  commentsByAnchor,
  describeOutcome,
  displayPath,
  STATUS_LETTER,
  type Comment,
  type DiffLine,
  type FileDiff,
} from "./model";

const line = (over: Partial<DiffLine> = {}): DiffLine => ({
  origin: "context",
  old_lineno: null,
  new_lineno: null,
  content: "",
  ...over,
});

const comment = (over: Partial<Comment> = {}): Comment => ({
  id: "c1",
  file: "src/a.ts",
  side: "new",
  line_range: [10, 10],
  snippet: "",
  comment: "hi",
  status: "staged",
  created_at: "2026-01-01",
  ...over,
});

const file = (over: Partial<FileDiff> = {}): FileDiff => ({
  old_path: "old.ts",
  new_path: "new.ts",
  status: "modified",
  added: 0,
  removed: 0,
  hunks: [],
  ...over,
});

describe("buildDraft", () => {
  it("prefers the new side when any selected line has a new lineno", () => {
    const draft = buildDraft([
      line({ origin: "context", old_lineno: 4, new_lineno: 4, content: "ctx" }),
      line({ origin: "addition", old_lineno: null, new_lineno: 5, content: "added" }),
    ]);
    expect(draft).toEqual({ side: "new", lineRange: [4, 5], snippet: "ctx\nadded" });
  });

  it("drops deletion lines (no new lineno) from a new-side draft", () => {
    const draft = buildDraft([
      line({ origin: "deletion", old_lineno: 7, new_lineno: null, content: "gone" }),
      line({ origin: "addition", old_lineno: null, new_lineno: 8, content: "kept" }),
    ]);
    // side is "new" (an addition is present); the deletion has no new lineno so
    // it's excluded from range + snippet.
    expect(draft).toEqual({ side: "new", lineRange: [8, 8], snippet: "kept" });
  });

  it("falls back to the old side for a pure-deletion selection", () => {
    const draft = buildDraft([
      line({ origin: "deletion", old_lineno: 11, new_lineno: null, content: "a" }),
      line({ origin: "deletion", old_lineno: 12, new_lineno: null, content: "b" }),
    ]);
    expect(draft).toEqual({ side: "old", lineRange: [11, 12], snippet: "a\nb" });
  });

  it("computes range as min/max regardless of selection order", () => {
    const draft = buildDraft([
      line({ new_lineno: 20, content: "x" }),
      line({ new_lineno: 14, content: "y" }),
      line({ new_lineno: 17, content: "z" }),
    ]);
    expect(draft?.lineRange).toEqual([14, 20]);
  });

  it("returns null for an empty selection", () => {
    expect(buildDraft([])).toBeNull();
  });
});

describe("commentsByAnchor", () => {
  it("keys comments by side and end-of-range lineno", () => {
    const map = commentsByAnchor([comment({ line_range: [3, 5], side: "new" })], "src/a.ts");
    expect([...map.keys()]).toEqual(["new:5"]);
  });

  it("filters to the requested file", () => {
    const map = commentsByAnchor(
      [comment({ file: "src/a.ts" }), comment({ id: "c2", file: "src/b.ts" })],
      "src/a.ts",
    );
    expect(map.size).toBe(1);
    expect(map.get("new:10")?.map((c) => c.id)).toEqual(["c1"]);
  });

  it("groups multiple comments sharing an anchor", () => {
    const map = commentsByAnchor(
      [comment({ id: "c1" }), comment({ id: "c2" })],
      "src/a.ts",
    );
    expect(map.get("new:10")?.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("separates old- and new-side comments on the same lineno", () => {
    const map = commentsByAnchor(
      [comment({ id: "n", side: "new" }), comment({ id: "o", side: "old" })],
      "src/a.ts",
    );
    expect([...map.keys()].sort()).toEqual(["new:10", "old:10"]);
  });
});

describe("describeOutcome", () => {
  it("covers every outcome branch", () => {
    expect(describeOutcome({ outcome: "nothing" })).toBe("Nothing to apply");
    expect(describeOutcome({ outcome: "blocked", drifted: ["a", "b"] })).toBe(
      "Blocked: 2 drifted comment(s) — review or delete them first",
    );
    expect(describeOutcome({ outcome: "applied", path: "/x", count: 3 })).toBe(
      "Sent 3 comment(s) to the agent",
    );
    expect(describeOutcome({ outcome: "deferred", path: "/tmp/brief.md", count: 1 })).toBe(
      "Agent not ready — brief written to /tmp/brief.md; re-apply later",
    );
  });
});

describe("displayPath", () => {
  it("uses the old path for deletions, the new path otherwise", () => {
    expect(displayPath(file({ status: "deleted" }))).toBe("old.ts");
    expect(displayPath(file({ status: "modified" }))).toBe("new.ts");
    expect(displayPath(file({ status: "renamed" }))).toBe("new.ts");
    expect(displayPath(file({ status: "added" }))).toBe("new.ts");
  });
});

describe("STATUS_LETTER", () => {
  it("maps each status to its letter", () => {
    expect(STATUS_LETTER).toEqual({ added: "A", deleted: "D", modified: "M", renamed: "R" });
  });
});
