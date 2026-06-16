import { expect, type Locator } from "@playwright/test";
import { AppPageObject } from "./AppPageObject.testHelper";
import type { SessionRow } from "../iwft/network/types.testHelper";

// Drives the session sidebar (#sessions). Selects existing ids/classes — the
// sidebar markup is stable and well-named, so no data-test attributes yet.
// State assertions read the fake's snapshot via window.__CC_SIM__ rather than
// verifying which invokes fired (fake, not mock).
export class SidebarPageObject extends AppPageObject {
  private readonly sessions = this.page.locator("#sessions");
  private readonly rows = this.sessions.locator(".session-row");

  /** The row whose title cell matches `title`. */
  row(title: string): Locator {
    return this.rows.filter({ has: this.page.locator(".title", { hasText: title }) });
  }

  /** Visible session titles, top to bottom. */
  titles(): Locator {
    return this.rows.locator(".title");
  }

  rowCount(): Promise<number> {
    return this.rows.count();
  }

  // ----- view mode -----
  viewLabel(): Promise<string> {
    return this.sessions.locator(".view-bar span").first().innerText();
  }

  /** Click the view-mode cycle toggle (project → sections → section stacks). */
  cycleView(): Promise<void> {
    return this.step("cycleView", () =>
      this.sessions.locator(".view-bar button").click(),
    );
  }

  // ----- create -----
  /** Open a project's inline create-input, type a title, and commit with Enter. */
  createSession(projectName: string, title: string): Promise<void> {
    return this.step(`createSession: ${title}`, async () => {
      await this.openCreateInput(projectName);
      const input = this.sessions.locator(".create-input input");
      await input.fill(title);
      await input.press("Enter");
    });
  }

  /** Open the create-input, type, then cancel with Esc — leaves no new session. */
  cancelCreateSession(projectName: string, title: string): Promise<void> {
    return this.step("cancelCreateSession", async () => {
      await this.openCreateInput(projectName);
      const input = this.sessions.locator(".create-input input");
      await input.fill(title);
      await input.press("Escape");
      await expect(this.sessions.locator(".create-input")).toHaveCount(0);
    });
  }

  private async openCreateInput(projectName: string): Promise<void> {
    const header = this.sessions
      .locator(".project-header")
      .filter({ hasText: projectName });
    await header.hover();
    await header.getByTitle("New session in this project").click();
    await expect(this.sessions.locator(".create-input input")).toBeVisible();
  }

  // ----- rename (via row context menu → inline input) -----
  rename(title: string, newTitle: string): Promise<void> {
    return this.step(`rename: ${title} → ${newTitle}`, async () => {
      await this.openRowMenu(title);
      await this.menuItem("Rename…").click();
      const input = this.sessions.locator(".rename-input");
      await expect(input).toBeVisible();
      await input.fill(newTitle);
      await input.press("Enter");
    });
  }

  // ----- delete (row action; confirmButton needs two clicks) -----
  deleteViaRowAction(title: string): Promise<void> {
    return this.step(`deleteViaRowAction: ${title}`, async () => {
      const row = this.row(title);
      await row.hover();
      const del = row.getByTitle("Delete session (removes worktree + branch)");
      await del.click(); // arms the confirm state
      await del.click(); // confirms
    });
  }

  /** Sidebar menu → "Delete merged-PR sessions…" → confirm the dialog. */
  deleteMergedSessions(): Promise<void> {
    return this.step("deleteMergedSessions", async () => {
      await this.page.locator("#sidebar-menu").click();
      await this.menuItem("Delete merged-PR sessions…").click();
      const overlay = this.page.locator(".confirm-overlay");
      await expect(overlay).toBeVisible();
      await overlay.locator(".confirm-buttons button.danger").click();
    });
  }

  // ----- drag a session row onto a section header -----
  /** A section header by its bucket name (section view only). */
  sectionHeader(name: string): Locator {
    return this.sessions
      .locator(".project-header")
      .filter({ has: this.page.locator("span", { hasText: name }) });
  }

  /** Dispatch the HTML5 DnD sequence the handlers listen for — dragstart on the
   *  row, dragover+drop on the target section header, dragend on the row.
   *  Playwright can't fire trusted native DnD from mouse moves, and the synthetic
   *  DragEvents carry no dataTransfer (which the guarded handlers must tolerate). */
  dragSessionToSection(title: string, sectionName: string): Promise<void> {
    return this.step(`dragSessionToSection: ${title} → ${sectionName}`, () =>
      this.page.evaluate(
        ({ title, sectionName }) => {
          const rows = [...document.querySelectorAll<HTMLElement>("#sessions .session-row")];
          const row = rows.find((r) => r.querySelector(".title")?.textContent?.trim() === title);
          const headers = [
            ...document.querySelectorAll<HTMLElement>("#sessions .project-header"),
          ];
          // The name span is prefixed with a collapse chevron ("▾ " / "▸ ").
          const headerName = (h: HTMLElement) =>
            h.querySelector("span")?.textContent?.replace(/^[▾▸]\s*/, "").trim();
          const header = headers.find((h) => headerName(h) === sectionName);
          if (!row || !header) {
            throw new Error(`drag target missing: "${title}" → "${sectionName}"`);
          }
          row.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
          header.dispatchEvent(new DragEvent("dragover", { bubbles: true }));
          header.dispatchEvent(new DragEvent("drop", { bubbles: true }));
          row.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
        },
        { title, sectionName },
      ),
    );
  }

  // ----- context menu -----
  private async openRowMenu(title: string): Promise<void> {
    await this.row(title).click({ button: "right" });
    await expect(this.page.locator(".context-menu")).toBeVisible();
  }

  private menuItem(label: string): Locator {
    return this.page.locator(".context-menu .menu-item", { hasText: label });
  }

  // ----- glyphs / badges -----
  pullBlocked(projectName: string): Locator {
    return this.sessions
      .locator(".project-header")
      .filter({ hasText: projectName })
      .locator(".pull-blocked");
  }

  commentBadge(title: string): Locator {
    return this.row(title).locator(".comment-badge");
  }

  unreadDot(title: string): Locator {
    return this.row(title).locator(".unread-dot");
  }

  /** Class on a row's status glyph (e.g. agent-working, status-stopped). */
  glyphClass(title: string): Promise<string> {
    return this.row(title).locator(".glyph").getAttribute("class") as Promise<string>;
  }

  // ----- event push (drives the backend's sessions-updated path) -----
  /** Push a snapshot through the real listen() path, exactly as the backend would. */
  pushSnapshot(snapshot: unknown): Promise<void> {
    return this.step("pushSnapshot", () =>
      this.page.evaluate(
        (snap) =>
          (window as unknown as { __CC_SIM__: { pushSnapshot(s: unknown): Promise<void> } })
            .__CC_SIM__.pushSnapshot(snap),
        snapshot,
      ),
    );
  }

  // ----- state-based assertion source (the fake's live snapshot) -----
  storedSessions(): Promise<SessionRow[]> {
    return this.page.evaluate(
      () =>
        (window as unknown as { __CC_SIM__: { getSessions(): SessionRow[] } })
          .__CC_SIM__.getSessions(),
    );
  }

  storedViewMode(): Promise<string> {
    return this.page.evaluate(
      () =>
        (window as unknown as { __CC_SIM__: { getViewMode(): string } })
          .__CC_SIM__.getViewMode(),
    );
  }

  /** The fake's section buckets — assert a session's placement after a move. */
  storedSectionBuckets(): Promise<{ name: string; session_ids: string[] }[] | null> {
    return this.page.evaluate(
      () =>
        (
          window as unknown as {
            __CC_SIM__: { getSectionBuckets(): { name: string; session_ids: string[] }[] | null };
          }
        ).__CC_SIM__.getSectionBuckets(),
    );
  }

  /** The section header a row currently renders under in the DOM (the nearest
   *  preceding header), or null if not found — proves the post-move re-render. */
  renderedSectionOf(title: string): Promise<string | null> {
    return this.page.evaluate((title) => {
      let section: string | null = null;
      for (const el of document.querySelectorAll<HTMLElement>("#sessions > *")) {
        if (el.classList.contains("project-header")) {
          section = el.querySelector("span")?.textContent?.replace(/^[▾▸]\s*/, "").trim() ?? null;
        } else if (
          el.classList.contains("session-row") &&
          el.querySelector(".title")?.textContent?.trim() === title
        ) {
          return section;
        }
      }
      return null;
    }, title);
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
}
