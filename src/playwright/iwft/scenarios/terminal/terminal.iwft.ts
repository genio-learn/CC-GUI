import { test, expect } from "../../support/fixture.testHelper";
import { SESSION_ID, makeSession, makeSnapshot } from "../../network/seed.testHelper";

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

test("selecting text copies it to the clipboard and clears the highlight", async ({
  terminal,
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await terminal.attach("fix login bug");
  await terminal.pushText(TMUX, "copyme123");
  await terminal.expectScreenContains("copyme123");

  // Drag across the first row to make a selection, as a user would.
  const screen = page.locator("#terminals .term-container.active .xterm-screen");
  const box = (await screen.boundingBox())!;
  const y = box.y + 6; // first row
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, y, { steps: 12 });
  await page.mouse.up();

  // Finishing the selection copies it (no Cmd+C) and clears the highlight.
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("copyme");
  await expect(page.locator(".xterm-selection div")).toHaveCount(0);
});

test("Cmd+Click opens a URL externally; a plain click does not", async ({ terminal, page }) => {
  await terminal.attach("fix login bug");
  await terminal.pushText(TMUX, "https://example.com/foo");
  await terminal.expectScreenContains("example.com");

  const screen = page.locator("#terminals .term-container.active .xterm-screen");
  const box = (await screen.boundingBox())!;
  const x = box.x + 40; // ~6 cells in → inside the URL on row 0
  const y = box.y + 6;

  // A plain click places the cursor; it must not open anything.
  await page.mouse.click(x, y);
  expect(await page.evaluate(() => window.__CC_SIM__.getOpenedUrls())).toEqual([]);

  // Cmd+Click routes the link through open_external.
  await page.keyboard.down("Meta");
  await page.mouse.click(x, y);
  await page.keyboard.up("Meta");
  await expect
    .poll(() => page.evaluate(() => window.__CC_SIM__.getOpenedUrls()))
    .toContain("https://example.com/foo");
});

test.describe("tab reorder", () => {
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
              makeSession({ id: "s-a", title: "alpha", tmux_session_name: "cc-s-a" }),
              makeSession({ id: "s-b", title: "beta", tmux_session_name: "cc-s-b" }),
              makeSession({ id: "s-c", title: "gamma", tmux_session_name: "cc-s-c" }),
            ],
          },
        ],
      }),
      reviews: {},
      keybindings: {},
      config: {},
    },
  });

  test("dragging a tab reorders the strip and index navigation", async ({ sidebar, page }) => {
    void sidebar; // boots the app against the 3-session seed
    const attach = async (title: string, expectCount: number) => {
      await page
        .locator(".session-row")
        .filter({ has: page.locator(".title", { hasText: title }) })
        .locator(".row-main")
        .click();
      await expect(page.locator("#tabs .tab")).toHaveCount(expectCount);
    };
    await attach("alpha", 1);
    await attach("beta", 2);
    await attach("gamma", 3);
    await expect(page.locator("#tabs .tab .tab-label")).toHaveText(["alpha", "beta", "gamma"]);

    // Drag tab 0 (alpha) past the last tab. Playwright can't fire trusted native
    // HTML5 DnD from mouse moves, so dispatch the sequence the handlers listen
    // for: dragstart marks the dragged tab, dragover on #tabs positions the drop
    // marker by clientX, drop commits the Map order, dragend cleans up.
    await page.evaluate(() => {
      const tabs = document.querySelectorAll<HTMLElement>("#tabs .tab");
      const strip = document.querySelector("#tabs")!;
      const last = tabs[2].getBoundingClientRect();
      const at = { bubbles: true, clientX: last.right - 2, clientY: last.top + 2 };
      tabs[0].dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
      strip.dispatchEvent(new DragEvent("dragover", at));
      strip.dispatchEvent(new DragEvent("drop", at));
      tabs[0].dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    });
    await expect(page.locator("#tabs .tab .tab-label")).toHaveText(["beta", "gamma", "alpha"]);

    // Index navigation follows the new order: Cmd+1 activates the first tab.
    await page.keyboard.press("Meta+1");
    await expect(page.locator("#tabs .tab.active .tab-label")).toHaveText("beta");
  });
});
