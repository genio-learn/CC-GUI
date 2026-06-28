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

  // ----- view mode (GROUP BY segmented control) -----
  /** Label of the currently-active grouping segment (e.g. "Projects"). */
  activeGrouping(): Promise<string> {
    return this.sessions.locator(".group-by-bar .segment.active").innerText();
  }

  /** Drive the GROUP BY segmented control to a side ("Sections" | "Projects").
   *  Round-trips through set_view_mode, like the old cycle toggle did. */
  setGrouping(segment: "Sections" | "Projects"): Promise<void> {
    return this.step(`setGrouping: ${segment}`, () =>
      this.sessions
        .locator(".group-by-bar .segment", { hasText: segment })
        .click(),
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

  // ----- project sub-headers + create paths (section views) -----
  /** A project sub-header inside a section bucket. */
  projectSubheader(name: string): Locator {
    return this.sessions.locator(".project-subheader").filter({ hasText: name });
  }

  /** Project sub-header names, top to bottom (the name span, not the buttons). */
  subheaderNames(): Promise<string[]> {
    return this.page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "#sessions .project-subheader > span:not(.header-buttons)",
        ),
      ].map((s) => (s.textContent ?? "").trim()),
    );
  }

  /** The project sub-header a row currently renders under (nearest preceding
   *  .project-subheader), or null — proves the section sub-grouping. */
  renderedProjectOf(title: string): Promise<string | null> {
    return this.page.evaluate((title) => {
      let project: string | null = null;
      for (const el of document.querySelectorAll<HTMLElement>("#sessions > *")) {
        if (el.classList.contains("project-subheader")) {
          project = el.querySelector("span")?.textContent?.trim() ?? null;
        } else if (
          el.classList.contains("session-row") &&
          el.querySelector(".title")?.textContent?.trim() === title
        ) {
          return project;
        }
      }
      return null;
    }, title);
  }

  /** The full-width "+ New session" button (section views only). */
  newSessionButton(): Locator {
    return this.sessions.locator(".new-session-btn");
  }

  /** Create via a project sub-header's inline "+" (the per-project quick path). */
  createViaSubheader(projectName: string, title: string): Promise<void> {
    return this.step(`createViaSubheader: ${projectName}/${title}`, async () => {
      const header = this.projectSubheader(projectName);
      await header.hover();
      await header.getByTitle("New session in this project").click();
      const input = this.sessions.locator(".create-input input");
      await expect(input).toBeVisible();
      await input.fill(title);
      await input.press("Enter");
    });
  }

  /** Create via the full-width button → pick a project → title prompt (the
   *  universal path that also reaches sessionless projects). */
  createViaButton(projectName: string, title: string): Promise<void> {
    return this.step(`createViaButton: ${projectName}/${title}`, async () => {
      await this.newSessionButton().click();
      await this.menuItem(projectName).click();
      const input = this.page.locator(".confirm-overlay input");
      await expect(input).toBeVisible();
      await input.fill(title);
      await input.press("Enter");
    });
  }

  // ----- add project (sidebar menu → path input with autocomplete) -----
  private readonly pathInput = this.sessions.locator(".path-input input");

  /** Open the sidebar menu and choose "Add project…" — leaves the path input
   *  focused and pre-seeded with `~/`. */
  openAddProject(): Promise<void> {
    return this.step("openAddProject", async () => {
      await this.page.locator("#sidebar-menu").click();
      await this.menuItem("Add project…").click();
      await expect(this.pathInput).toBeVisible();
    });
  }

  /** Replace the path input's value and let the debounced completion settle. */
  typePath(value: string): Promise<void> {
    return this.step(`typePath: ${value}`, async () => {
      await this.pathInput.fill(value);
      // Debounce is 100ms; press a no-op key so `fill` still triggers `input`.
      await this.page.waitForTimeout(150);
    });
  }

  /** The visible autocomplete completion rows, top to bottom. */
  pathCompletions(): Locator {
    return this.sessions.locator(".path-completion");
  }

  /** Press a key in the focused path input (e.g. "Tab", "ArrowDown", "Enter"). */
  pressInPath(key: string): Promise<void> {
    return this.step(`pressInPath: ${key}`, () => this.pathInput.press(key));
  }

  /** The current text in the path input. */
  pathValue(): Promise<string> {
    return this.pathInput.inputValue();
  }

  /** Click the native folder-picker button. */
  clickBrowse(): Promise<void> {
    return this.step("clickBrowse", () => this.sessions.locator(".path-browse").click());
  }

  /** Projects the fake holds (name + repo_path) — assert an add landed. */
  storedProjects(): Promise<{ id: string; name: string; repo_path: string }[]> {
    return this.page.evaluate(
      () =>
        (
          window as unknown as {
            __CC_SIM__: { getProjects(): { id: string; name: string; repo_path: string }[] };
          }
        ).__CC_SIM__.getProjects(),
    );
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
  /** The maroon ⚠ blocked chip on a row in an auto-pull-blocked project. */
  blockedBadge(title: string): Locator {
    return this.row(title).locator(".blocked-badge");
  }

  /** The mauve ✎ pending-comments chip on a row. */
  commentBadge(title: string): Locator {
    return this.row(title).locator(".comment-badge");
  }

  /** A row's 8px liveness dot. Its state class (dot-running/finished/idle/
   *  stopped/transient) carries the colour; an unread (finished-while-away)
   *  session shows as dot-finished. */
  statusDot(title: string): Locator {
    return this.row(title).locator(".glyph.dot");
  }

  /** Class on a row's liveness dot (e.g. "glyph dot dot-finished"). */
  dotClass(title: string): Promise<string> {
    return this.statusDot(title).getAttribute("class") as Promise<string>;
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
