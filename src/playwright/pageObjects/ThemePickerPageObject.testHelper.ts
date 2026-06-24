import { expect, type Locator } from "@playwright/test";
import { AppPageObject } from "./AppPageObject.testHelper";

type Appearance = "dark" | "light";

// Drives the theme picker popover (.theme-modal / .theme-popover), reached
// through the palette command "Theme: Set {dark,light} theme…". The popover
// lists every theme (both appearances) prepended by a "Follow system" row;
// the resolved active theme carries a ✓ (.theme-modal-check). Asserts the
// observable effects: the live-previewed CSS variables on :root and the
// persisted localStorage prefs (cc-theme-mode / cc-theme-{dark,light} /
// cc-theme-vars-*).
export class ThemePickerPageObject extends AppPageObject {
  private readonly modal = this.page.locator(".theme-modal");
  // Theme rows only — excludes the prepended follow-system toggle row, so
  // indexing/labels reason about concrete themes.
  private readonly rows = this.modal.locator(".theme-modal-row:not(.theme-follow-row)");

  /** Open the picker for an appearance via its palette command. */
  open(appearance: Appearance): Promise<void> {
    return this.step(`open: ${appearance}`, async () => {
      await this.page.keyboard.press("ControlOrMeta+k");
      const input = this.page.locator("#palette input");
      await input.fill(`Set ${appearance} theme`);
      await input.press("Enter");
      await expect(this.modal).toBeVisible();
    });
  }

  down(): Promise<void> {
    return this.step("down", () => this.page.keyboard.press("ArrowDown"));
  }

  up(): Promise<void> {
    return this.step("up", () => this.page.keyboard.press("ArrowUp"));
  }

  commitEnter(): Promise<void> {
    return this.step("commitEnter", async () => {
      await this.page.keyboard.press("Enter");
      await expect(this.modal).toBeHidden();
    });
  }

  cancelEsc(): Promise<void> {
    return this.step("cancelEsc", async () => {
      await this.page.keyboard.press("Escape");
      await expect(this.modal).toBeHidden();
    });
  }

  clickRow(label: string): Promise<void> {
    return this.step(`clickRow: ${label}`, () =>
      this.rows.filter({ hasText: label }).click(),
    );
  }

  selectedLabel(): Promise<string> {
    return this.modal.locator(".theme-modal-row.selected .theme-modal-label").innerText();
  }

  /** Label of the row marked active with the ✓ check. */
  currentLabel(): Promise<string> {
    return this.rows
      .filter({ has: this.page.locator(".theme-modal-check") })
      .locator(".theme-modal-label")
      .innerText();
  }

  customTaggedRows(): Locator {
    return this.rows.filter({ has: this.page.locator(".theme-modal-tag") });
  }

  isOpen(): Promise<boolean> {
    return this.modal.isVisible();
  }

  /** A CSS variable currently applied to :root — the live-preview signal. */
  cssVar(name: string): Promise<string> {
    return this.page.evaluate(
      (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
      name,
    );
  }

  storedThemeId(appearance: Appearance): Promise<string | null> {
    const key = appearance === "dark" ? "cc-theme-dark" : "cc-theme-light";
    return this.page.evaluate((k) => localStorage.getItem(k), key);
  }

  storedMode(): Promise<string | null> {
    return this.page.evaluate(() => localStorage.getItem("cc-theme-mode"));
  }
}
