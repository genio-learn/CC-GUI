import { test, expect } from "../../support/fixture.testHelper";
import { defaultSeed } from "../../network/seed.testHelper";

// Default seed's session attaches under this tmux name (see makeSession).
const TMUX = "cc-sess-1";

test.use({
  seed: {
    ...defaultSeed(),
    fileTree: {
      "": [
        { name: "src", is_dir: true, size: 0 },
        { name: "README.md", is_dir: false, size: 1200 },
        { name: ".hidden", is_dir: false, size: 10 },
      ],
      src: [
        { name: "main.ts", is_dir: false, size: 5000 },
        { name: "review.ts", is_dir: false, size: 3000 },
      ],
    },
  },
});

test("Cmd+E opens the explorer rooted at the repo; hidden files are off by default", async ({
  fileExplorer,
}) => {
  await fileExplorer.open();

  await expect(fileExplorer.rows()).toHaveCount(2); // .hidden excluded
  await expect(fileExplorer.row("src")).toBeVisible();
  await expect(fileExplorer.row("README.md")).toBeVisible();
  await expect(fileExplorer.row(".hidden")).toHaveCount(0);
  expect(await fileExplorer.crumbsText()).toBe("acme");
});

test("Enter drills into a folder; breadcrumb and contents update", async ({ fileExplorer }) => {
  await fileExplorer.open();

  // Directories sort first, so the cursor starts on src/.
  expect(await fileExplorer.cursorName()).toBe("src/");
  await fileExplorer.press("Enter");

  await expect(fileExplorer.row("main.ts")).toBeVisible();
  await expect(fileExplorer.row("review.ts")).toBeVisible();
  expect(await fileExplorer.crumbsText()).toContain("src");
});

test("opening a file writes an @path reference into the active terminal and closes", async ({
  fileExplorer,
}) => {
  await fileExplorer.open();
  await fileExplorer.press("Enter"); // into src/
  expect(await fileExplorer.cursorName()).toBe("main.ts");

  await fileExplorer.press("Enter"); // reference the file

  await expect(fileExplorer.paneLocator()).toBeHidden();
  expect(await fileExplorer.ptyWrites()).toContainEqual({
    tmuxSession: TMUX,
    data: "@src/main.ts ",
  });
});

test("the . key toggles hidden files", async ({ fileExplorer }) => {
  await fileExplorer.open();
  await expect(fileExplorer.row(".hidden")).toHaveCount(0);

  await fileExplorer.press(".");

  await expect(fileExplorer.row(".hidden")).toBeVisible();
});

test("/ filters the current directory", async ({ fileExplorer }) => {
  await fileExplorer.open();

  await fileExplorer.press("/");
  await fileExplorer.type("read");

  await expect(fileExplorer.rows()).toHaveCount(1);
  await expect(fileExplorer.row("README.md")).toBeVisible();
});

test("Backspace navigates up to the parent", async ({ fileExplorer }) => {
  await fileExplorer.open();
  await fileExplorer.press("Enter"); // into src/
  await expect(fileExplorer.row("main.ts")).toBeVisible();

  await fileExplorer.press("Backspace");

  await expect(fileExplorer.row("src")).toBeVisible();
  expect(await fileExplorer.crumbsText()).toBe("acme");
});

test("Esc and Cmd+E both close the explorer", async ({ fileExplorer }) => {
  await fileExplorer.open();
  await fileExplorer.press("Escape");
  await expect(fileExplorer.paneLocator()).toBeHidden();

  await fileExplorer.open();
  await fileExplorer.press("Meta+e");
  await expect(fileExplorer.paneLocator()).toBeHidden();
});
