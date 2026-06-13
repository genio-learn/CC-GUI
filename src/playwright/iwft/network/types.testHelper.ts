// Shared shapes for the iwft backend fake. The Snapshot family mirrors main.ts
// (which doesn't export its types); the review family is reused from the app's
// own review model so the fake can't drift from what the UI parses.

import type { ReviewSnapshot } from "../../../review/model";

export type SessionRow = {
  id: string;
  title: string;
  branch: string;
  status: string;
  program: string;
  agent_state: string;
  tmux_session_name: string;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: "open" | "closed" | "merged" | null;
  pr_draft: boolean;
  pr_labels: string[];
  review_decision: string | null;
  has_pending_comments: boolean;
  unread: boolean;
  stacked_child: boolean;
  project_name: string;
  current_section: string | null;
};

export type ProjectGroup = {
  id: string;
  name: string;
  repo_path: string;
  pull_blocked: string | null;
  sessions: SessionRow[];
};

export type Snapshot = {
  groups: ProjectGroup[];
  view_mode: string;
  sections: { name: string; session_ids: string[] }[] | null;
  section_names: string[];
  commander: { enabled: boolean; running: boolean };
};

/** Everything the fake needs to answer a test's backend traffic. Plain data —
 *  it crosses into the page via addInitScript serialization. */
export type Seed = {
  snapshot: Snapshot;
  /** Keyed by session id → the review for that session (answers open_review). */
  reviews: Record<string, ReviewSnapshot>;
  keybindings?: Record<string, string[]>;
  config?: Record<string, unknown>;
  /** Raw custom themes answered to list_custom_themes (validated by theme.ts). */
  customThemes?: unknown[];
};
