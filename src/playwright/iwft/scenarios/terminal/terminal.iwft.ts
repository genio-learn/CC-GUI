import { test, expect } from "../../support/fixture.testHelper";
import { SESSION_ID } from "../../network/seed.testHelper";

// Default seed's session attaches under this tmux name (see makeSession).
const TMUX = `cc-${SESSION_ID}`;

test("attaching opens a tab and streamed PTY bytes render", async ({ terminal }) => {
  await terminal.attach("fix login bug");

  await expect(terminal.tabLabels()).toHaveText(["fix login bug"]);
  expect(await terminal.placeholderVisible()).toBe(false);

  await terminal.pushText(TMUX, "hello-term");
  await terminal.expectScreenContains("hello-term");
});

test("Cmd+W closes the active terminal tab", async ({ terminal }) => {
  await terminal.attach("fix login bug");
  await terminal.closeWithCmdW();

  expect(await terminal.tabCount()).toBe(0);
  expect(await terminal.placeholderVisible()).toBe(true);
});

test("the tab close button closes the tab", async ({ terminal }) => {
  await terminal.attach("fix login bug");
  await terminal.closeActiveTabButton();

  expect(await terminal.tabCount()).toBe(0);
});

test("a PTY end auto-restarts and re-attaches a fresh tab", async ({ terminal, page }) => {
  await terminal.attach("fix login bug");
  await terminal.emitExit(TMUX, true); // program exited → restart_fresh + re-attach

  // The re-attach rebuilds a live tab: still one tab, no longer marked dead.
  const tab = page.locator("#tabs .tab");
  await expect(tab).toHaveCount(1);
  await expect(tab).not.toHaveClass(/dead/);
});
