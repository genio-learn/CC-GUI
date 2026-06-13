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
