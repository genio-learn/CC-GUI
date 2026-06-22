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

test.describe("drag a session to a section", () => {
  test.use({
    seed: {
      snapshot: makeSnapshot({
        view_mode: "sections",
        section_names: ["Review", "Done"],
        sections: [
          { name: "In Progress", session_ids: ["sess-1"] },
          { name: "Review", session_ids: ["sess-2"] },
          { name: "Done", session_ids: [] },
        ],
        groups: [
          {
            id: "proj-1",
            name: "acme",
            repo_path: "/repos/acme",
            pull_blocked: null,
            sessions: [
              makeSession({ title: "fix login bug", current_section: null }),
              makeSession({ id: "sess-2", title: "ship feature", current_section: "Review" }),
            ],
          },
        ],
      }),
      reviews: {},
    },
  });

  test("dropping on a named section pins the session there", async ({ sidebar }) => {
    await sidebar.dragSessionToSection("fix login bug", "Done");

    // The frontend re-rendered from the rebuilt snapshot: the row now sits under
    // "Done", and the fake's buckets agree.
    await expect(async () => {
      expect(await sidebar.renderedSectionOf("fix login bug")).toBe("Done");
    }).toPass();
    const buckets = await sidebar.storedSectionBuckets();
    expect(buckets?.find((b) => b.name === "Done")?.session_ids).toEqual(["sess-1"]);
    expect(buckets?.find((b) => b.name === "In Progress")?.session_ids).toEqual([]);
    expect(await sidebar.storedSectionMoves()).toEqual([{ id: "sess-1", section: "Done" }]);
  });

  test("dropping on the current section is a no-op (no move dispatched)", async ({ sidebar }) => {
    await sidebar.dragSessionToSection("ship feature", "Review");

    // Give any erroneous invoke a chance to land before asserting nothing fired.
    await sidebar.dragSessionToSection("fix login bug", "Done");
    await expect(async () => {
      expect(await sidebar.renderedSectionOf("fix login bug")).toBe("Done");
    }).toPass();

    const moves = await sidebar.storedSectionMoves();
    expect(moves).not.toContainEqual({ id: "sess-2", section: "Review" });
    expect(moves).toEqual([{ id: "sess-1", section: "Done" }]);
  });

  test("dropping on In Progress clears the pin (section: null)", async ({ sidebar }) => {
    await sidebar.dragSessionToSection("ship feature", "In Progress");

    await expect(async () => {
      expect(await sidebar.renderedSectionOf("ship feature")).toBe("In Progress");
    }).toPass();
    const buckets = await sidebar.storedSectionBuckets();
    expect(buckets?.find((b) => b.name === "In Progress")?.session_ids).toContain("sess-2");
    expect(buckets?.find((b) => b.name === "Review")?.session_ids).toEqual([]);
    expect(await sidebar.storedSectionMoves()).toEqual([{ id: "sess-2", section: null }]);
  });
});

test("no full-width new-session button in project view", async ({ sidebar }) => {
  await expect(sidebar.newSessionButton()).toHaveCount(0);
});

test.describe("project sub-headers in section views", () => {
  test.use({
    seed: {
      snapshot: makeSnapshot({
        view_mode: "sections",
        section_names: ["Review"],
        sections: [
          { name: "In Progress", session_ids: ["sess-1", "sess-2"] },
          { name: "Review", session_ids: [] },
        ],
        groups: [
          {
            id: "proj-1",
            name: "acme",
            repo_path: "/repos/acme",
            pull_blocked: null,
            sessions: [makeSession({ id: "sess-1", title: "acme work" })],
          },
          {
            id: "proj-2",
            name: "beta",
            repo_path: "/repos/beta",
            pull_blocked: null,
            sessions: [
              makeSession({
                id: "sess-2",
                title: "beta work",
                project_id: "proj-2",
                project_name: "beta",
              }),
            ],
          },
        ],
      }),
      reviews: {},
    },
  });

  test("clusters a section's sessions under their project sub-header", async ({ sidebar }) => {
    await expect(sidebar.newSessionButton()).toBeVisible();
    expect(await sidebar.subheaderNames()).toEqual(["acme", "beta"]);
    expect(await sidebar.renderedProjectOf("acme work")).toBe("acme");
    expect(await sidebar.renderedProjectOf("beta work")).toBe("beta");
  });

  test("a sub-header's + creates a session in that project", async ({ sidebar }) => {
    await sidebar.createViaSubheader("beta", "beta extra");

    await expect(async () => {
      expect((await sidebar.storedSessions()).map((s) => s.title)).toContain("beta extra");
    }).toPass();
    const created = (await sidebar.storedSessions()).find((s) => s.title === "beta extra");
    expect(created?.project_id).toBe("proj-2");
  });
});

test.describe("creating in a sessionless project (section view)", () => {
  test.use({
    seed: {
      snapshot: makeSnapshot({
        view_mode: "sections",
        section_names: ["Review"],
        sections: [
          { name: "In Progress", session_ids: ["sess-1"] },
          { name: "Review", session_ids: [] },
        ],
        groups: [
          {
            id: "proj-1",
            name: "acme",
            repo_path: "/repos/acme",
            pull_blocked: null,
            sessions: [makeSession({ id: "sess-1", title: "acme work" })],
          },
          {
            id: "proj-2",
            name: "beta",
            repo_path: "/repos/beta",
            pull_blocked: null,
            sessions: [],
          },
        ],
      }),
      reviews: {},
    },
  });

  test("the full-width button reaches a project with no sessions", async ({ sidebar }) => {
    // A sessionless project has no sub-header to hang a "+" on — it's absent.
    expect(await sidebar.subheaderNames()).toEqual(["acme"]);

    await sidebar.createViaButton("beta", "beta first");

    await expect(async () => {
      expect((await sidebar.storedSessions()).map((s) => s.title)).toContain("beta first");
    }).toPass();
    // The new session is bucketed into In Progress and rendered under a fresh
    // beta sub-header.
    await expect(async () => {
      expect(await sidebar.renderedProjectOf("beta first")).toBe("beta");
    }).toPass();
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
