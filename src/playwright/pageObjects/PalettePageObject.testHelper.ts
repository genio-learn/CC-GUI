import { expect, type Locator } from "@playwright/test";
import { AppPageObject } from "./AppPageObject.testHelper";

// Drives the command/session palette (#palette). Pure-frontend surface — no
// backend fake involved beyond whatever action an entry triggers.
export class PalettePageObject extends AppPageObject {
  private readonly overlay = this.page.locator("#palette");
  private readonly input = this.overlay.locator("input");
  private readonly rows = this.overlay.locator(".palette-row");

  /** Toggle the palette open with Cmd/Ctrl+K and wait for it to show. */
  open(): Promise<void> {
    return this.step("open", async () => {
      await this.page.keyboard.press("ControlOrMeta+k");
      await expect(this.overlay).toBeVisible();
      await expect(this.input).toBeFocused();
    });
  }

  closeWithEscape(): Promise<void> {
    return this.step("closeWithEscape", async () => {
      await this.input.press("Escape");
      await expect(this.overlay).toBeHidden();
    });
  }

  /** Click the backdrop (overlay corner, clear of the centered box). */
  closeWithBackdrop(): Promise<void> {
    return this.step("closeWithBackdrop", async () => {
      await this.overlay.click({ position: { x: 4, y: 4 } });
      await expect(this.overlay).toBeHidden();
    });
  }

  type(query: string): Promise<void> {
    return this.step(`type: ${query}`, () => this.input.fill(query));
  }

  down(): Promise<void> {
    return this.step("down", () => this.input.press("ArrowDown"));
  }

  up(): Promise<void> {
    return this.step("up", () => this.input.press("ArrowUp"));
  }

  enter(): Promise<void> {
    return this.step("enter", () => this.input.press("Enter"));
  }

  /** Click the row whose label matches. */
  clickRow(label: string): Promise<void> {
    return this.step(`clickRow: ${label}`, () =>
      this.rows.filter({ hasText: label }).click(),
    );
  }

  isOpen(): Promise<boolean> {
    return this.overlay.isVisible();
  }

  /** Row labels in rank order (label span is the first child). */
  labels(): Locator {
    return this.rows.locator("span").first();
  }

  rowTexts(): Promise<string[]> {
    return this.rows.evaluateAll((rows) =>
      rows.map((r) => r.querySelector("span")!.textContent ?? ""),
    );
  }

  rowCount(): Promise<number> {
    return this.rows.count();
  }

  /** Label of the currently highlighted row. */
  selectedLabel(): Promise<string> {
    return this.overlay.locator(".palette-row.selected span").first().innerText();
  }

  /** The row whose label span matches. */
  private row(label: string): Locator {
    return this.rows.filter({ has: this.page.locator(".palette-label", { hasText: label }) });
  }

  /** A session row's project-identity square (its proj-N class carries the
   *  project colour). */
  projSquare(label: string): Locator {
    return this.row(label).locator(".palette-proj");
  }

  /** A session row's labeled state pill (shared status-chip markup). */
  statePill(label: string): Locator {
    return this.row(label).locator(".palette-state");
  }

  /** A command row's leading icon (tinted when the command declares a tone). */
  commandIcon(label: string): Locator {
    return this.row(label).locator(".palette-icon");
  }
}
