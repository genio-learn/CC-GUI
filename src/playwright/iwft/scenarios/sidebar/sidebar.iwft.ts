import { test, expect } from "../../support/fixture.testHelper";
import { makeSession, makeSnapshot } from "../../network/seed.testHelper";

test("renders the seeded snapshot", async ({ sidebar }) => {
  await expect(sidebar.titles()).toHaveText(["fix login bug"]);
  expect(await sidebar.viewLabel()).toBe("View: Project");
});

test("cycles the view mode", async ({ sidebar }) => {
  await sidebar.cycleView();

  // set_view_mode mutated the fake; the frontend re-read it via get_groups.
  expect(await sidebar.storedViewMode()).toBe("sections");
  await expect(async () => {
    expect(await sidebar.viewLabel()).toBe("View: Sections");
  }).toPass();
});

test("creates a session (Enter commits)", async ({ sidebar }) => {
  await sidebar.createSession("acme", "add metrics");

  await expect(sidebar.titles()).toHaveText(["fix login bug", "add metrics"]);
  const stored = await sidebar.storedSessions();
  expect(stored.map((s) => s.title)).toContain("add metrics");
});

test("create can be cancelled (Esc leaves no new session)", async ({ sidebar }) => {
  await sidebar.cancelCreateSession("acme", "throwaway");

  await expect(sidebar.titles()).toHaveText(["fix login bug"]);
  const stored = await sidebar.storedSessions();
  expect(stored.map((s) => s.title)).not.toContain("throwaway");
});

test("renames a session inline", async ({ sidebar }) => {
  await sidebar.rename("fix login bug", "fix logout bug");

  await expect(sidebar.titles()).toHaveText(["fix logout bug"]);
  const stored = await sidebar.storedSessions();
  expect(stored[0].title).toBe("fix logout bug");
});

test("delete optimistically removes the row and the fake confirms it gone", async ({
  sidebar,
}) => {
  await sidebar.deleteViaRowAction("fix login bug");

  await expect(sidebar.rowCount()).resolves.toBe(0);
  expect(await sidebar.storedSessions()).toHaveLength(0);
});

test("a pushed snapshot re-renders the sidebar (event-push, no user action)", async ({
  sidebar,
}) => {
  await sidebar.pushSnapshot(
    makeSnapshot({
      groups: [
        {
          id: "proj-1",
          name: "acme",
          repo_path: "/repos/acme",
          pull_blocked: null,
          sessions: [makeSession(), makeSession({ id: "sess-2", title: "pushed in" })],
        },
      ],
    }),
  );

  await expect(sidebar.titles()).toHaveText(["fix login bug", "pushed in"]);
});

test.describe("glyphs and badges", () => {
  test.use({
    seed: {
      snapshot: makeSnapshot({
        groups: [
          {
            id: "proj-1",
            name: "acme",
            repo_path: "/repos/acme",
            pull_blocked: "uncommitted changes",
            sessions: [
              makeSession({
                title: "needs attention",
                unread: true,
                has_pending_comments: true,
                agent_state: "waitingforinput",
              }),
              makeSession({ id: "sess-2", title: "stopped one", status: "stopped" }),
            ],
          },
        ],
      }),
      reviews: {},
    },
  });

  test("shows unread, comment, pull-blocked, and status glyphs", async ({ sidebar }) => {
    await expect(sidebar.unreadDot("needs attention")).toBeVisible();
    await expect(sidebar.commentBadge("needs attention")).toBeVisible();
    await expect(sidebar.pullBlocked("acme")).toBeVisible();
    expect(await sidebar.glyphClass("needs attention")).toContain("agent-waiting");
    expect(await sidebar.glyphClass("stopped one")).toContain("status-stopped");
  });
});

test.describe("delete merged-PR sessions", () => {
  test.use({
    seed: {
      snapshot: makeSnapshot({
        groups: [
          {
            id: "proj-1",
            name: "acme",
            repo_path: "/repos/acme",
            pull_blocked: null,
            sessions: [
              makeSession({ title: "active work" }),
              makeSession({
                id: "sess-2",
                title: "shipped feature",
                pr_number: 42,
                pr_state: "merged",
              }),
            ],
          },
        ],
      }),
      reviews: {},
    },
  });

  test("sweeps only the merged-PR session", async ({ sidebar }) => {
    await sidebar.deleteMergedSessions();

    await expect(sidebar.titles()).toHaveText(["active work"]);
    const stored = await sidebar.storedSessions();
    expect(stored.map((s) => s.title)).toEqual(["active work"]);
  });
});
