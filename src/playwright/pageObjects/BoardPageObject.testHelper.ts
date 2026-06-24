import { expect, type Locator } from "@playwright/test";
import { AppPageObject } from "./AppPageObject.testHelper";

// Drives the Board layout (#board): the title-bar [Board] segment switch, the
// per-project columns, the agent cards, the filter pills + search, the card
// quick actions, and the bottom dock. The docked terminal reuses the Console
// terminal machinery (one PTY re-parented into #board-dock-surface), so its
// byte stream is driven through the same fake as TerminalPageObject.
export class BoardPageObject extends AppPageObject {
  private readonly board = this.page.locator("#board");
  private readonly columns = this.board.locator("#board-columns .board-col");
  private readonly cards = this.board.locator(".agent-card");
  private readonly pills = this.board.locator("#board-filter .board-pill");
  private readonly searchInput = this.board.locator("#board-filter .board-search");
  private readonly dock = this.board.locator("#board-dock");
  private readonly dockSurface = this.dock.locator("#board-dock-surface");
  private readonly dockName = this.dock.locator("#board-dock-name");
  private readonly dockPlaceholder = this.dock.locator("#board-dock-placeholder");
  private readonly dockScreen = this.dockSurface.locator(".term-container.active .xterm");

  /** Switch to the Board layout via the title-bar [Board] segment. */
  enter(): Promise<void> {
    return this.step("enter", async () => {
      await this.page.locator("#tb-board").click();
      await expect(this.board).not.toHaveClass(/hidden/);
    });
  }

  // ----- columns -----
  columnCount(): Promise<number> {
    return this.columns.count();
  }

  /** Project column names, left to right. */
  columnNames(): Locator {
    return this.columns.locator(".board-col-name");
  }

  /** The column whose header matches `projectName`. */
  column(projectName: string): Locator {
    return this.columns.filter({
      has: this.page.locator(".board-col-name", { hasText: projectName }),
    });
  }

  /** A column's visible-card count (the header badge). */
  columnCount_(projectName: string): Promise<string> {
    return this.column(projectName).locator(".board-col-count").innerText();
  }

  // ----- cards -----
  cardCount(): Promise<number> {
    return this.cards.count();
  }

  /** Visible card titles, in DOM order. */
  cardTitles(): Locator {
    return this.cards.locator(".card-title");
  }

  /** The card whose title matches `title`. */
  card(title: string): Locator {
    return this.cards.filter({
      has: this.page.locator(".card-title", { hasText: title }),
    });
  }

  // ----- filter + search -----
  /** Click a filter pill by its label (e.g. "Running", "Needs review"). */
  setFilter(label: string): Promise<void> {
    return this.step(`setFilter: ${label}`, async () => {
      await this.pills.filter({ hasText: label }).click();
      await expect(this.pills.filter({ hasText: label })).toHaveClass(/active/);
    });
  }

  /** Toggle a section filter pill on/off by its section name. */
  toggleSectionFilter(name: string): Promise<void> {
    return this.step(`toggleSectionFilter: ${name}`, () =>
      this.board
        .locator("#board-filter .board-pill.section", { hasText: name })
        .click(),
    );
  }

  /** Toggle the "Hide empty" projects switch. */
  toggleHideEmpty(): Promise<void> {
    return this.step("toggleHideEmpty", () =>
      this.board.locator("#board-filter .board-pill.hide-empty").click(),
    );
  }

  /** Type into the board search field (filters cards by name). */
  search(text: string): Promise<void> {
    return this.step(`search: ${text}`, () => this.searchInput.fill(text));
  }

  // ----- quick actions -----
  /** Click a card's ▸ attach button (docks the session's terminal). */
  attachFromCard(title: string): Promise<void> {
    return this.step(`attachFromCard: ${title}`, () =>
      this.card(title).locator(".card-action.attach").click(),
    );
  }

  /** Click a card's body (not a quick-action button) — also attaches. The
   *  card title is a safe non-button region. */
  clickCard(title: string): Promise<void> {
    return this.step(`clickCard: ${title}`, () =>
      this.card(title).locator(".card-title").click(),
    );
  }

  /** Click a card's ± review button. */
  reviewFromCard(title: string): Promise<void> {
    return this.step(`reviewFromCard: ${title}`, () =>
      this.card(title).locator(".card-action.review").click(),
    );
  }

  // ----- dock -----
  dockName_(): Promise<string> {
    return this.dockName.innerText();
  }

  dockPlaceholderVisible(): Promise<boolean> {
    return this.dockPlaceholder.isVisible();
  }

  /** Assert the docked terminal's rendered screen contains `text`. */
  async expectDockScreenContains(text: string): Promise<void> {
    await expect(this.dockScreen).toContainText(text);
  }

  /** Push UTF-8 text to a session's PTY, as the backend would over the Channel. */
  pushText(name: string, text: string): Promise<void> {
    return this.step(`pushText: ${text}`, () =>
      this.page.evaluate(
        ([n, t]) => {
          const bytes = Array.from(new TextEncoder().encode(t));
          (
            window as unknown as { __CC_SIM__: { pushPtyBytes(name: string, b: number[]): void } }
          ).__CC_SIM__.pushPtyBytes(n, bytes);
        },
        [name, text] as const,
      ),
    );
  }
}
