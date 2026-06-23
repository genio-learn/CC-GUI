import { test, expect } from "../../support/fixture.testHelper";
import { makeSnapshot } from "../../network/seed.testHelper";

test("↑/↓ live-preview the highlighted theme", async ({ themePicker }) => {
  const before = await themePicker.cssVar("--accent");
  await themePicker.open("dark");

  // Default dark theme (Catppuccin Mocha) is highlighted and previewed first.
  expect(await themePicker.selectedLabel()).toBe("Catppuccin Mocha");

  await themePicker.down();
  expect(await themePicker.selectedLabel()).toBe("Catppuccin Frappé");
  const previewed = await themePicker.cssVar("--accent");
  expect(previewed).not.toBe(before); // :root actually re-themed live
});

test("Enter commits the highlighted theme and it survives a reload", async ({
  themePicker,
  page,
}) => {
  await themePicker.open("dark");
  await themePicker.down(); // Catppuccin Frappé
  await themePicker.commitEnter();

  expect(await themePicker.storedThemeId("dark")).toBe("catppuccin-frappe");
  expect(await themePicker.storedMode()).toBe("dark");
  const committed = await themePicker.cssVar("--accent");

  // The no-flash boot replays cc-theme-vars-dark, so the choice persists.
  await page.reload();
  await page.waitForSelector("#sessions .session-row");
  expect(await themePicker.cssVar("--accent")).toBe(committed);
});

test("Esc reverts the preview to the applied theme", async ({ themePicker }) => {
  const applied = await themePicker.cssVar("--accent"); // before any preview
  await themePicker.open("dark"); // opening previews the dark slot, re-theming :root
  expect(await themePicker.cssVar("--accent")).not.toBe(applied);
  await themePicker.down();

  await themePicker.cancelEsc(); // applyTheme(resolveTheme()) — back to the saved selection
  expect(await themePicker.cssVar("--accent")).toBe(applied);
});

test("the active theme is marked with the check", async ({ themePicker }) => {
  // Commit a concrete theme so the active selection is deterministic (the
  // default mode is "system", which resolves by OS appearance), then reopen
  // and confirm the popover marks that theme — the one actually on screen.
  await themePicker.open("dark");
  await themePicker.down(); // Catppuccin Frappé
  await themePicker.commitEnter();

  await themePicker.open("dark");
  expect(await themePicker.currentLabel()).toBe("Catppuccin Frappé");
});

test.describe("custom themes", () => {
  test.use({
    seed: {
      snapshot: makeSnapshot(),
      reviews: {},
      // list_custom_themes answers { file, content } records (content = raw theme).
      customThemes: [
        { file: "team-dark.json", content: { id: "team-dark", label: "Team Dark", appearance: "dark" } },
      ],
    },
  });

  test("a custom theme appears in the picker with a custom tag", async ({ themePicker }) => {
    await themePicker.open("dark");
    const custom = themePicker.customTaggedRows();
    await expect(custom).toHaveCount(1);
    await expect(custom).toContainText("Team Dark");
  });
});
