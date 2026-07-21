import { expect, type Locator } from "@playwright/test";
import { AppPageObject } from "./AppPageObject.testHelper";

// Drives the Board layout (#board): the title-bar [Board] segment switch, the
// per-section columns, the agent cards (each naming its project), the filter
// pills + search, the card quick actions, and the bottom dock. The docked
// terminal reuses the Console terminal machinery (one PTY re-parented into
// #board-dock-surface), so its byte stream is driven through the same fake as
// TerminalPageObject.
export class BoardPageObject extends AppPageObject {
  private readonly board = this.page.locator("#board");
  private readonly columns = this.board.locator("#board-columns .board-col");
  private readonly cards = this.board.locator(".agent-card");
  private readonly searchInput = this.board.locator("#board-filter .board-search");
  private readonly projectFilterBtn = this.board.locator("#board-filter .board-project-btn");
  private readonly projectPanel = this.board.locator("#board-filter .board-project-panel");
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

  /** Section column names, left to right (the "No section" catch-all first). */
  columnNames(): Locator {
    return this.columns.locator(".board-col-name");
  }

  /** The column whose header matches `sectionName`. */
  column(sectionName: string): Locator {
    return this.columns.filter({
      has: this.page.locator(".board-col-name", { hasText: sectionName }),
    });
  }

  /** A column's visible-card count (the header badge). */
  columnCount_(sectionName: string): Promise<string> {
    return this.column(sectionName).locator(".board-col-count").innerText();
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

  /** A card's project name (the h2 line under the session title). */
  cardProject(title: string): Promise<string> {
    return this.card(title).locator(".card-project-name").innerText();
  }

  /** A card's status-chip label — the shape+colour+word chip that replaced the
   *  bare liveness dot (e.g. "Running", "Done"). Lives on its own row under
   *  the title so long session names don't ellipsize early. */
  cardStatus(title: string): Promise<string> {
    return this.card(title).locator(".card-status-row .status-chip").innerText();
  }

  /** A card's quick-action button (▸ Attach / ± Review), always visible on the
   *  board (no hover reveal). */
  cardAction(title: string, which: "attach" | "review"): Locator {
    return this.card(title).locator(`.card-action.${which}`);
  }

  // ----- filter + search -----
  /** Toggle the "Hide empty" section-columns switch. */
  toggleHideEmpty(): Promise<void> {
    return this.step("toggleHideEmpty", () =>
      this.board.locator("#board-filter .board-pill.hide-empty").click(),
    );
  }

  /** Type into the board search field (filters cards by name). */
  search(text: string): Promise<void> {
    return this.step(`search: ${text}`, () => this.searchInput.fill(text));
  }

  // ----- project filter dropdown -----
  /** The dropdown button's summary text (e.g. "All projects ▾"). */
  projectFilterLabel(): Promise<string> {
    return this.projectFilterBtn.innerText();
  }

  /** Open the project multiselect popover. */
  openProjectFilter(): Promise<void> {
    return this.step("openProjectFilter", async () => {
      await this.projectFilterBtn.click();
      await expect(this.projectPanel).not.toHaveClass(/hidden/);
    });
  }

  /** Toggle a project's checkbox in the open popover. */
  toggleProject(name: string): Promise<void> {
    return this.step(`toggleProject: ${name}`, () =>
      this.projectPanel.locator(".board-project-row", { hasText: name }).locator("input").click(),
    );
  }

  /** Click the popover's "Select all" helper. */
  selectAllProjects(): Promise<void> {
    return this.step("selectAllProjects", () =>
      this.projectPanel.locator(".board-project-tool", { hasText: "Select all" }).click(),
    );
  }

  /** Click the popover's "Clear all" helper. */
  clearAllProjects(): Promise<void> {
    return this.step("clearAllProjects", () =>
      this.projectPanel.locator(".board-project-tool", { hasText: "Clear all" }).click(),
    );
  }

  // ----- card → section drag -----
  /** Drag a card onto a section column (pointer-based; see AppPageObject
   *  .pointerDragElement). Releasing over the column commits the re-pin. */
  dragCardToColumn(title: string, sectionName: string): Promise<void> {
    return this.step(`dragCardToColumn: ${title} → ${sectionName}`, () =>
      this.pointerDragElement(this.card(title), this.column(sectionName)),
    );
  }

  /** Drag a card over a column, report whether that column shows the accent-blue
   *  drop preview (`.card-drop-target`), then cancel with Esc so no move commits. */
  columnHighlightedWhileDragging(title: string, sectionName: string): Promise<boolean> {
    return this.step(`columnHighlightedWhileDragging: ${title} → ${sectionName}`, async () => {
      const card = await this.card(title).boundingBox();
      const col = this.column(sectionName);
      const box = await col.boundingBox();
      if (!card || !box) throw new Error(`drag target missing: "${title}" → "${sectionName}"`);
      const { mouse, keyboard } = this.page;
      await mouse.move(card.x + card.width / 2, card.y + card.height / 2);
      await mouse.down();
      await mouse.move(card.x + card.width / 2 + 6, card.y + card.height / 2, { steps: 3 });
      await mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
      const highlighted = await col.evaluate((el) => el.classList.contains("card-drop-target"));
      await keyboard.press("Escape"); // cancel the drag: no re-pin commits
      await mouse.up();
      return highlighted;
    });
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

  /** Section moves the frontend dispatched — empty after a no-op drop. */
  storedSectionMoves(): Promise<{ id: string; section: string | null }[]> {
    return this.page.evaluate(
      () =>
        (
          window as unknown as {
            __CC_SIM__: { getSectionMoves(): { id: string; section: string | null }[] };
          }
        ).__CC_SIM__.getSectionMoves(),
    );
  }

  // ----- dock -----
  dockName_(): Promise<string> {
    return this.dockName.innerText();
  }

  dockPlaceholderVisible(): Promise<boolean> {
    return this.dockPlaceholder.isVisible();
  }

  /** Is the dock panel itself showing (false once "×" collapses it)? */
  dockVisible(): Promise<boolean> {
    return this.dock.isVisible();
  }

  /** Click the dock's "×" to close the preview (collapses the whole dock). */
  closeDock(): Promise<void> {
    return this.step("closeDock", () => this.dock.locator("#board-dock-close").click());
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
