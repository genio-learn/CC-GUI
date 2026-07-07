import { test, expect } from "../../support/fixture.testHelper";
import { makeSession, makeSnapshot } from "../../network/seed.testHelper";

// The Board buckets every session across projects into one column per section
// (the "No section" catch-all first, then the configured sections), names each
// card's project, and re-parents the active session's terminal into the dock.
// Seed: three projects (one sessionless) spanning two sections so the project
// filter, section columns, and search each have something to narrow.
test.use({
  seed: {
    snapshot: makeSnapshot({
      section_names: ["Review", "Build"],
      groups: [
        {
          id: "proj-atlas",
          name: "atlas",
          repo_path: "/repos/atlas",
          pull_blocked: null,
          sessions: [
            makeSession({
              id: "s-login",
              title: "fix login bug",
              branch: "fix/login",
              status: "running",
              tmux_session_name: "cc-s-login",
              project_id: "proj-atlas",
              project_name: "atlas",
              current_section: "Review",
            }),
            makeSession({
              id: "s-docs",
              title: "update docs",
              branch: "docs/readme",
              status: "finished",
              agent_state: "done",
              has_pending_comments: true,
              tmux_session_name: "cc-s-docs",
              project_id: "proj-atlas",
              project_name: "atlas",
              current_section: "Review",
            }),
          ],
        },
        {
          id: "proj-beacon",
          name: "beacon",
          repo_path: "/repos/beacon",
          pull_blocked: null,
          sessions: [
            makeSession({
              id: "s-cache",
              title: "tune cache",
              branch: "perf/cache",
              status: "running",
              tmux_session_name: "cc-s-cache",
              project_id: "proj-beacon",
              project_name: "beacon",
              current_section: "Build",
            }),
          ],
        },
        {
          id: "proj-ember",
          name: "ember",
          repo_path: "/repos/ember",
          pull_blocked: null,
          sessions: [],
        },
      ],
    }),
    reviews: {},
    keybindings: {},
    config: {},
  },
});

test("switching to Board renders a column per section with the seeded cards", async ({
  board,
}) => {
  await board.enter();

  // One column per section — the "No section" catch-all first, then the two
  // configured sections in order.
  await expect(board.columnNames()).toHaveText(["No section", "Review", "Build"]);

  // Cards land under their section, spanning projects; the empty catch-all
  // column shows a zero count.
  await expect(board.column("Review").locator(".card-title")).toHaveText([
    "fix login bug",
    "update docs",
  ]);
  await expect(board.column("Build").locator(".card-title")).toHaveText(["tune cache"]);
  expect(await board.columnCount_("No section")).toBe("0");
});

test("each card names its own project in the header", async ({ board }) => {
  await board.enter();

  // The two Review cards come from atlas; the Build card from beacon.
  expect(await board.cardProject("fix login bug")).toBe("atlas");
  expect(await board.cardProject("update docs")).toBe("atlas");
  expect(await board.cardProject("tune cache")).toBe("beacon");
});

test("the project filter narrows cards to the selected projects", async ({ board }) => {
  await board.enter();

  // Defaults to all projects — every card shows.
  expect(await board.projectFilterLabel()).toContain("All projects");
  await expect(board.cardTitles()).toHaveText(["fix login bug", "update docs", "tune cache"]);

  // "Clear all" hides everything; picking beacon shows only its session.
  await board.openProjectFilter();
  await board.clearAllProjects();
  await expect(board.cardTitles()).toHaveText([]);

  await board.toggleProject("beacon");
  await expect(board.cardTitles()).toHaveText(["tune cache"]);
  expect(await board.projectFilterLabel()).toContain("beacon");

  // "Select all" restores every card and resets the label.
  await board.selectAllProjects();
  await expect(board.cardTitles()).toHaveText(["fix login bug", "update docs", "tune cache"]);
  expect(await board.projectFilterLabel()).toContain("All projects");
});

test("search narrows cards by name and updates column counts", async ({ board }) => {
  await board.enter();
  await board.search("cache");

  await expect(board.cardTitles()).toHaveText(["tune cache"]);
  expect(await board.columnCount_("Review")).toBe("0");
  expect(await board.columnCount_("Build")).toBe("1");
});

test("attaching from a card docks that session's terminal", async ({ board }) => {
  await board.enter();
  expect(await board.dockPlaceholderVisible()).toBe(true);

  await board.attachFromCard("fix login bug");

  // The dock header names the attached session and the placeholder is gone.
  expect(await board.dockName_()).toBe("fix login bug");
  expect(await board.dockPlaceholderVisible()).toBe(false);

  // Streamed PTY bytes render in the docked terminal (one PTY, re-parented).
  await board.pushText("cc-s-login", "docked-output");
  await board.expectDockScreenContains("docked-output");
});

test("clicking a card body also docks that session's terminal", async ({ board }) => {
  await board.enter();
  expect(await board.dockPlaceholderVisible()).toBe(true);

  // A body click (on the title, not a quick-action button) attaches like ▸.
  await board.clickCard("fix login bug");

  expect(await board.dockName_()).toBe("fix login bug");
  expect(await board.dockPlaceholderVisible()).toBe(false);

  await board.pushText("cc-s-login", "body-click-output");
  await board.expectDockScreenContains("body-click-output");
});

test("the Hide empty toggle omits section columns with no cards", async ({ board }) => {
  await board.enter();
  await expect(board.columnNames()).toHaveText(["No section", "Review", "Build"]);

  // Every seeded session is pinned to a section, so "No section" is empty and
  // hiding empty columns drops it.
  await board.toggleHideEmpty();
  await expect(board.columnNames()).toHaveText(["Review", "Build"]);

  // Toggling back restores it.
  await board.toggleHideEmpty();
  await expect(board.columnNames()).toHaveText(["No section", "Review", "Build"]);
});

test("Hide empty drops columns left empty by search", async ({ board }) => {
  await board.enter();
  await board.toggleHideEmpty();
  // Empty "No section" is already gone; Review + Build remain.
  await expect(board.columnNames()).toHaveText(["Review", "Build"]);

  // "docs" matches only the Review session; Build's lone session drops out, so
  // the now-empty Build column must also drop.
  await board.search("docs");
  await expect(board.columnNames()).toHaveText(["Review"]);
});
