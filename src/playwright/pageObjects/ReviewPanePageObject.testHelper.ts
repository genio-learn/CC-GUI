import { expect, type Locator } from "@playwright/test";
import { AppPageObject } from "./AppPageObject.testHelper";
import type { Comment } from "../../review/model";

// Drives the review pane (#review). Selects existing stable ids/classes — the
// review surface is well-identified, so no data-test attributes are needed yet.
export class ReviewPanePageObject extends AppPageObject {
  private readonly pane = this.page.locator("#review");
  private readonly diff = this.page.locator("#review-diff");
  private readonly applyButton = this.page.locator("#review-apply");
  private readonly status = this.page.locator("#review-status");

  /** Hover the first session row (its actions are hidden until hover) and open
   *  its review diff. */
  openFirstSession(): Promise<void> {
    return this.step("openFirstSession", async () => {
      const row = this.page.locator(".session-row").first();
      await row.hover();
      await row.getByTitle("Review diff").click();
      await expect(this.pane).toBeVisible();
    });
  }

  private line(text: string): Locator {
    return this.diff.locator(".diff-line", { hasText: text });
  }

  /** Click a diff line to start a single-line comment selection. */
  selectLine(text: string): Promise<void> {
    return this.step(`selectLine: ${text}`, async () => {
      await this.line(text).click();
      await expect(this.diff.locator("textarea")).toBeVisible();
    });
  }

  /** Type into the open comment editor and save it. */
  writeComment(text: string): Promise<void> {
    return this.step(`writeComment: ${text}`, async () => {
      await this.diff.locator("textarea").fill(text);
      await this.diff.locator(".editor-buttons button", { hasText: "Comment" }).click();
      await expect(this.diff.locator("textarea")).toHaveCount(0);
    });
  }

  /** Bodies of the rendered (saved) comment blocks, top to bottom. */
  commentBodies(): Locator {
    return this.diff.locator(".review-comment:not(.editor) .comment-body");
  }

  deleteFirstComment(): Promise<void> {
    return this.step("deleteFirstComment", async () => {
      await this.diff.locator(".review-comment .comment-delete").first().click();
    });
  }

  apply(): Promise<void> {
    return this.step("apply", () => this.applyButton.click());
  }

  applyLocator(): Locator {
    return this.applyButton;
  }

  statusText(): Promise<string> {
    return this.status.innerText();
  }

  /** What the fake backend now holds for this session — the state-based assertion. */
  storedComments(sessionId: string): Promise<Comment[]> {
    return this.page.evaluate(
      (id) => (window as unknown as { __CC_SIM__: { getComments(i: string): Comment[] } }).__CC_SIM__.getComments(id),
      sessionId,
    );
  }
}
