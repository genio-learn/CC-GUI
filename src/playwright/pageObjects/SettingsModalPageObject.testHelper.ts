import { expect, type Locator } from "@playwright/test";
import { AppPageObject } from "./AppPageObject.testHelper";

// Drives the settings modal (#settings-overlay), reached via the palette
// "Settings" command. Each config key renders a typed control keyed by data-kind
// (bool→checkbox, number→number input, string/nullable→text, array/object→JSON
// textarea). State assertion reads the fake's last save_config payload.
export class SettingsModalPageObject extends AppPageObject {
  private readonly overlay = this.page.locator("#settings-overlay");
  private readonly box = this.overlay.locator(".settings-box");

  open(): Promise<void> {
    return this.step("open", async () => {
      await this.page.keyboard.press("ControlOrMeta+k");
      const input = this.page.locator("#palette input");
      await input.fill("Settings");
      await input.press("Enter");
      await expect(this.overlay).toBeVisible();
    });
  }

  field(key: string): Locator {
    return this.box.locator(`[data-key="${key}"]`);
  }

  fieldKind(key: string): Promise<string | null> {
    return this.field(key).getAttribute("data-kind");
  }

  /** Lowercased tag name of a field's control (input / textarea). */
  fieldTag(key: string): Promise<string> {
    return this.field(key).evaluate((el) => el.tagName.toLowerCase());
  }

  fieldInputType(key: string): Promise<string | null> {
    return this.field(key).getAttribute("type");
  }

  setText(key: string, value: string): Promise<void> {
    return this.step(`setText ${key}=${value}`, () => this.field(key).fill(value));
  }

  setChecked(key: string, checked: boolean): Promise<void> {
    return this.step(`setChecked ${key}=${checked}`, () =>
      this.field(key).setChecked(checked),
    );
  }

  save(): Promise<void> {
    return this.step("save", async () => {
      await this.box.locator(".editor-buttons button", { hasText: "Save" }).click();
      await expect(this.overlay).toBeHidden();
    });
  }

  /** Click Save expecting a validation abort: an error toast, modal stays open. */
  saveExpectingError(): Promise<void> {
    return this.step("saveExpectingError", async () => {
      await this.box.locator(".editor-buttons button", { hasText: "Save" }).click();
      await expect(this.page.locator(".toast.error")).toBeVisible();
      await expect(this.overlay).toBeVisible();
    });
  }

  cancel(): Promise<void> {
    return this.step("cancel", async () => {
      await this.box.locator(".editor-buttons button", { hasText: "Cancel" }).click();
      await expect(this.overlay).toBeHidden();
    });
  }

  isOpen(): Promise<boolean> {
    return this.overlay.isVisible();
  }

  /** The config the fake last received via save_config (null if never saved). */
  savedConfig(): Promise<Record<string, unknown> | null> {
    return this.page.evaluate(
      () =>
        (
          window as unknown as {
            __CC_SIM__: { getSavedConfig(): Record<string, unknown> | null };
          }
        ).__CC_SIM__.getSavedConfig(),
    );
  }
}
