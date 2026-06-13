import { expect, type Locator } from "@playwright/test";
import { AppPageObject } from "./AppPageObject.testHelper";

// Drives the in-app confirm/prompt dialogs (.confirm-overlay), exercising their
// real resolve semantics. The dialog functions return a Promise; we kick one off
// without awaiting (stashing the eventual value on window.__dlg), interact with
// the rendered overlay, then read the resolved value. A sentinel distinguishes
// "still open" from a legitimate false/null result.
const PENDING = "__pending__";

export class DialogsPageObject extends AppPageObject {
  private readonly overlay = this.page.locator(".confirm-overlay");
  private readonly confirmBtn = this.overlay.locator(".confirm-buttons button").last();
  private readonly cancelBtn = this.overlay.locator(".confirm-buttons button").first();
  private readonly input = this.overlay.locator("input");

  /** Open a confirm dialog; resolves once it's on screen (not when it closes). */
  openConfirm(message: string, label = "Confirm"): Promise<void> {
    return this.step(`openConfirm: ${label}`, async () => {
      await this.page.evaluate(
        ([m, l, pending]) => {
          (window as unknown as { __dlg: unknown }).__dlg = pending;
          window.__CC_DIALOGS__.confirmDialog(m, l).then((r) => {
            (window as unknown as { __dlg: unknown }).__dlg = r;
          });
        },
        [message, label, PENDING] as const,
      );
      await expect(this.overlay).toBeVisible();
    });
  }

  openPrompt(message: string, placeholder = "", label = "Save"): Promise<void> {
    return this.step(`openPrompt: ${label}`, async () => {
      await this.page.evaluate(
        ([m, p, l, pending]) => {
          (window as unknown as { __dlg: unknown }).__dlg = pending;
          window.__CC_DIALOGS__.promptDialog(m, p, l).then((r) => {
            (window as unknown as { __dlg: unknown }).__dlg = r;
          });
        },
        [message, placeholder, label, PENDING] as const,
      );
      await expect(this.overlay).toBeVisible();
      await expect(this.input).toBeFocused();
    });
  }

  clickConfirm(): Promise<void> {
    return this.step("clickConfirm", () => this.confirmBtn.click());
  }

  clickCancel(): Promise<void> {
    return this.step("clickCancel", () => this.cancelBtn.click());
  }

  pressEnter(): Promise<void> {
    return this.step("pressEnter", () => this.page.keyboard.press("Enter"));
  }

  pressEscape(): Promise<void> {
    return this.step("pressEscape", () => this.page.keyboard.press("Escape"));
  }

  clickBackdrop(): Promise<void> {
    return this.step("clickBackdrop", () => this.overlay.click({ position: { x: 4, y: 4 } }));
  }

  focusCancel(): Promise<void> {
    return this.step("focusCancel", () => this.cancelBtn.focus());
  }

  fillInput(value: string): Promise<void> {
    return this.step(`fillInput: ${value}`, () => this.input.fill(value));
  }

  inputField(): Locator {
    return this.input;
  }

  /** Wait for the dialog's promise to settle and return its resolved value. */
  async result(): Promise<boolean | string | null> {
    await expect
      .poll(() => this.page.evaluate(() => (window as unknown as { __dlg: unknown }).__dlg))
      .not.toBe(PENDING);
    return this.page.evaluate(
      () => (window as unknown as { __dlg: boolean | string | null }).__dlg,
    );
  }
}
