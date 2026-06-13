import { test, expect } from "../../support/fixture.testHelper";

test("Cmd/K opens the palette", async ({ palette }) => {
  await palette.open();
  expect(await palette.isOpen()).toBe(true);
  // NB: Cmd/K can't *close* it — the focused input stops propagation before the
  // global chord handler sees the key. Closing is Esc / backdrop (below).
});

test("filtering narrows entries and ranks the best match first", async ({ palette }) => {
  await palette.open();
  await palette.type("se");

  // "Settings" — contiguous, early — outranks the looser subsequence matches.
  await expect(palette.labels()).toHaveText("Settings");
});

test("↑/↓ move the selection", async ({ palette }) => {
  await palette.open();

  // Unfiltered, the session provider's entry is first, commands follow.
  expect(await palette.selectedLabel()).toBe("fix login bug");
  await palette.down();
  expect(await palette.selectedLabel()).toBe("Cycle view mode");
  await palette.up();
  expect(await palette.selectedLabel()).toBe("fix login bug");
});

test("Enter runs the selected entry's action", async ({ palette, page }) => {
  await palette.open();
  await palette.type("settings");
  await palette.enter();

  // Palette closed and its action fired (Settings opened its overlay).
  expect(await palette.isOpen()).toBe(false);
  await expect(page.locator("#settings-overlay")).toBeVisible();
});

test("Escape closes the palette", async ({ palette }) => {
  await palette.open();
  await palette.closeWithEscape();
  expect(await palette.isOpen()).toBe(false);
});

test("clicking the backdrop closes the palette", async ({ palette }) => {
  await palette.open();
  await palette.closeWithBackdrop();
  expect(await palette.isOpen()).toBe(false);
});
