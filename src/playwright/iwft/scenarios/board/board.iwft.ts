import { test, expect } from "../../support/fixture.testHelper";
import { makeSession, makeSnapshot } from "../../network/seed.testHelper";

// The Board renders the same snapshot `groups` as the sidebar — one column per
// project, agent cards inside — and re-parents the active session's terminal
// into the dock. Seed: three projects (one sessionless) and three sessions
// with distinct liveness so the filters/search have something to narrow.
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

test("switching to Board renders a column per project with the seeded cards", async ({
  board,
}) => {
  await board.enter();

  // One column per project — including the sessionless "ember".
  await expect(board.columnNames()).toHaveText(["atlas", "beacon", "ember"]);

  // Cards land under their project, and the empty column shows a zero count.
  await expect(board.column("atlas").locator(".card-title")).toHaveText([
    "fix login bug",
    "update docs",
  ]);
  await expect(board.column("beacon").locator(".card-title")).toHaveText(["tune cache"]);
  expect(await board.columnCount_("ember")).toBe("0");
});

test("the Running pill narrows to running cards and updates column counts", async ({ board }) => {
  await board.enter();
  await board.setFilter("Running");

  // Only the two running sessions remain; the finished "update docs" is hidden.
  await expect(board.cardTitles()).toHaveText(["fix login bug", "tune cache"]);
  expect(await board.columnCount_("atlas")).toBe("1");
  expect(await board.columnCount_("beacon")).toBe("1");
});

test("the Needs review pill narrows to sessions with pending comments", async ({ board }) => {
  await board.enter();
  await board.setFilter("Needs review");

  await expect(board.cardTitles()).toHaveText(["update docs"]);
});

test("search narrows cards by name", async ({ board }) => {
  await board.enter();
  await board.search("cache");

  await expect(board.cardTitles()).toHaveText(["tune cache"]);
  expect(await board.columnCount_("atlas")).toBe("0");
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

test("the Hide empty toggle omits sessionless project columns", async ({ board }) => {
  await board.enter();
  await expect(board.columnNames()).toHaveText(["atlas", "beacon", "ember"]);

  // "ember" has no sessions, so hiding empty columns drops it.
  await board.toggleHideEmpty();
  await expect(board.columnNames()).toHaveText(["atlas", "beacon"]);

  // Toggling back restores it.
  await board.toggleHideEmpty();
  await expect(board.columnNames()).toHaveText(["atlas", "beacon", "ember"]);
});

test("a custom-section pill narrows cards to that section and composes with search", async ({
  board,
}) => {
  await board.enter();

  // The "Review" section holds the two atlas sessions.
  await board.toggleSectionFilter("Review");
  await expect(board.cardTitles()).toHaveText(["fix login bug", "update docs"]);

  // Composes with search: narrow within the section.
  await board.search("login");
  await expect(board.cardTitles()).toHaveText(["fix login bug"]);

  // Clearing search, switching to "Build" shows only the beacon session.
  await board.search("");
  await board.toggleSectionFilter("Review"); // toggle Review off
  await board.toggleSectionFilter("Build");
  await expect(board.cardTitles()).toHaveText(["tune cache"]);
});
