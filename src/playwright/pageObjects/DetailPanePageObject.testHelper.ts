import { expect, type Locator } from "@playwright/test";
import { AppPageObject } from "./AppPageObject.testHelper";

// Drives the session detail pane (#detail), opened from a sidebar row's ⓘ
// action. Selects existing ids/classes; state assertions read the fake via
// window.__CC_SIM__ (fake, not mock).
export class DetailPanePageObject extends AppPageObject {
  private readonly pane = this.page.locator("#detail");

  /** Open the detail pane from a session row's ⓘ action and wait for the
   *  first get_session_detail round-trip (the diffstat leaves "Loading…"). */
  open(title: string): Promise<void> {
    return this.step(`open: ${title}`, async () => {
      const row = this.page
        .locator("#sessions .session-row")
        .filter({ has: this.page.locator(".title", { hasText: title }) });
      await row.hover();
      await row.getByTitle("Session details").click();
      await expect(this.pane).toBeVisible();
      await expect(this.diffstat()).not.toHaveText("Loading…");
    });
  }

  /** The pinned action bar between the header and the meta rows. */
  actionBar(): Locator {
    return this.pane.locator("#detail-actions");
  }

  reviewButton(): Locator {
    return this.actionBar().locator("#detail-review");
  }

  prButton(): Locator {
    return this.actionBar().locator("#detail-pr");
  }

  /** The element the action bar directly follows — proves it's pinned at the
   *  top of the pane rather than in a footer. */
  precedingElementOfActionBar(): Promise<string | null> {
    return this.page.evaluate(
      () => document.querySelector("#detail-actions")?.previousElementSibling?.tagName ?? null,
    );
  }

  /** The uppercase "Changes · N files" micro-label. */
  changesLabel(): Locator {
    return this.pane.locator("#detail-changes-label");
  }

  diffstat(): Locator {
    return this.pane.locator("#detail-diffstat");
  }

  addedCount(): Locator {
    return this.diffstat().locator(".diffstat-counts .added");
  }

  removedCount(): Locator {
    return this.diffstat().locator(".diffstat-counts .removed");
  }

  proportionalBar(): Locator {
    return this.diffstat().locator(".diffstat-bar");
  }

  /** A meta row's value by its label (e.g. metaValue("Branch")). */
  metaValue(label: string): Promise<string> {
    return this.page.evaluate((label) => {
      const terms = [...document.querySelectorAll<HTMLElement>("#detail-meta dt")];
      const dt = terms.find((el) => el.textContent === label);
      return dt?.nextElementSibling?.textContent ?? "";
    }, label);
  }

  /** URLs the frontend asked the platform opener to launch — assert Open PR. */
  openedUrls(): Promise<string[]> {
    return this.page.evaluate(
      () =>
        (window as unknown as { __CC_SIM__: { getOpenedUrls(): string[] } })
          .__CC_SIM__.getOpenedUrls(),
    );
  }
}
