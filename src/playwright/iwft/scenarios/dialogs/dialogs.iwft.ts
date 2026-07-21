import { test, expect } from "../../support/fixture.testHelper";

test.describe("confirmDialog", () => {
  test("Confirm resolves true", async ({ dialogs }) => {
    await dialogs.openConfirm("Proceed?", "Delete");
    await dialogs.clickConfirm();
    expect(await dialogs.result()).toBe(true);
  });

  test("Cancel resolves false", async ({ dialogs }) => {
    await dialogs.openConfirm("Proceed?", "Delete");
    await dialogs.clickCancel();
    expect(await dialogs.result()).toBe(false);
  });

  test("Esc resolves false", async ({ dialogs }) => {
    await dialogs.openConfirm("Proceed?", "Delete");
    await dialogs.pressEscape();
    expect(await dialogs.result()).toBe(false);
  });

  test("backdrop click resolves false", async ({ dialogs }) => {
    await dialogs.openConfirm("Proceed?", "Delete");
    await dialogs.clickBackdrop();
    expect(await dialogs.result()).toBe(false);
  });

  test("Enter resolves true (confirm is focused by default)", async ({ dialogs }) => {
    await dialogs.openConfirm("Proceed?", "Delete");
    await dialogs.pressEnter();
    expect(await dialogs.result()).toBe(true);
  });

  test("Enter on a focused Cancel resolves false", async ({ dialogs }) => {
    await dialogs.openConfirm("Proceed?", "Delete");
    await dialogs.focusCancel();
    await dialogs.pressEnter();
    expect(await dialogs.result()).toBe(false);
  });
});

test.describe("deleteSessionDialog", () => {
  test("consequences render as an itemized checklist beside the icon badge", async ({
    dialogs,
  }) => {
    await dialogs.openDelete("migrate-db-pool", "cc/migrate-db-pool");

    await expect(dialogs.deleteIcon()).toHaveText("⌦");
    await expect(dialogs.deleteHeading()).toHaveText("Delete session");
    await expect(dialogs.deleteName()).toHaveText("migrate-db-pool");
    // One line per effect: two ✕ cuts, then the truthful ✓ branch-kept line.
    await expect(dialogs.deleteChecklist()).toHaveText([
      "✕Kills the running agent",
      "✕Removes the worktree + tmux session",
      "✓Keeps the branch cc/migrate-db-pool",
    ]);
    // The copy stays truthful: the backend never deletes the branch.
    await expect(dialogs.deleteKeepLine()).toContainText("Keeps the branch");
  });

  test("Delete resolves true; Cancel guard still holds", async ({ dialogs }) => {
    await dialogs.openDelete("migrate-db-pool", "cc/migrate-db-pool");
    await dialogs.clickConfirm();
    expect(await dialogs.result()).toBe(true);

    // Enter on a focused Cancel still cancels (the typed/confirmed guard).
    await dialogs.openDelete("migrate-db-pool", "cc/migrate-db-pool");
    await dialogs.focusCancel();
    await dialogs.pressEnter();
    expect(await dialogs.result()).toBe(false);
  });
});

test.describe("promptDialog", () => {
  test("Save resolves the trimmed input", async ({ dialogs }) => {
    await dialogs.openPrompt("Name?", "title…");
    await dialogs.fillInput("  hello  ");
    await dialogs.clickConfirm();
    expect(await dialogs.result()).toBe("hello");
  });

  test("Enter resolves the input", async ({ dialogs }) => {
    await dialogs.openPrompt("Name?");
    await dialogs.fillInput("via-enter");
    await dialogs.pressEnter();
    expect(await dialogs.result()).toBe("via-enter");
  });

  test("empty input resolves null", async ({ dialogs }) => {
    await dialogs.openPrompt("Name?");
    await dialogs.clickConfirm();
    expect(await dialogs.result()).toBeNull();
  });

  test("Cancel resolves null", async ({ dialogs }) => {
    await dialogs.openPrompt("Name?");
    await dialogs.fillInput("discarded");
    await dialogs.clickCancel();
    expect(await dialogs.result()).toBeNull();
  });

  test("Esc resolves null", async ({ dialogs }) => {
    await dialogs.openPrompt("Name?");
    await dialogs.pressEscape();
    expect(await dialogs.result()).toBeNull();
  });
});
