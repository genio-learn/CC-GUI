// Harness/program picker for the new-session flow. A split-button dropdown that
// lets each new session launch a chosen program (Claude / Codex / OpenCode).
//
// The list of programs comes from claude-commander config (`get_create_options`);
// when that list is empty the GUI substitutes a built-in fallback set. The
// last-used program is remembered per project in localStorage (GUI-owned, like
// the theming prefs — never written back to CC config).

import { invoke } from "@tauri-apps/api/core";
import { noTextAssist } from "./dom";

export type ProgramInfo = { label: string; command: string };

type CreateOptions = {
  default_program: string;
  programs: ProgramInfo[];
  sections: string[];
};

/** Built-in fallback set, shown when config has no `programs`. Order is
 *  Claude → Codex → OpenCode (Claude first — the common case). Bare binaries,
 *  no baked-in flags. A fixed constant, independent of CC's `default_program`. */
export const BUILTIN_PROGRAMS: ProgramInfo[] = [
  { label: "Claude", command: "claude" },
  { label: "Codex", command: "codex" },
  { label: "OpenCode", command: "opencode" },
];

// Per-project last-used memory: one localStorage key holding
// { [repoPath]: command }. GUI-owned, matching the `cc-theme-*` pattern.
const MEMORY_KEY = "cc-harness-last";

function readMemory(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Remember the program last chosen for a project (keyed by repo path). */
export function rememberHarness(projectKey: string, command: string): void {
  const mem = readMemory();
  mem[projectKey] = command;
  localStorage.setItem(MEMORY_KEY, JSON.stringify(mem));
}

function lastUsed(projectKey: string): string | undefined {
  return readMemory()[projectKey];
}

/** Configured list if non-empty, else the built-in fallback set. */
export function resolveShownList(programs: ProgramInfo[]): ProgramInfo[] {
  return programs.length > 0 ? programs : BUILTIN_PROGRAMS;
}

/** Per-project last-used if present *and still in the shown list*, else the
 *  first entry of the shown list. Never consults `default_program`. */
export function initialSelection(shown: ProgramInfo[], projectKey: string): string {
  const remembered = lastUsed(projectKey);
  if (remembered && shown.some((p) => p.command === remembered)) return remembered;
  return shown[0]?.command ?? "";
}

// The configured create-options are fetched once and cached (a fast local
// call). On failure we fall back to the built-in set rather than blocking the
// create flow.
let shownListPromise: Promise<ProgramInfo[]> | null = null;

function loadShownList(): Promise<ProgramInfo[]> {
  if (!shownListPromise) {
    shownListPromise = invoke<CreateOptions>("get_create_options")
      .then((o) => resolveShownList(o.programs))
      .catch(() => BUILTIN_PROGRAMS);
  }
  return shownListPromise;
}

export type HarnessPicker = {
  /** The split-button control, to append next to a title field. */
  element: HTMLDivElement;
  /** The currently-selected program command (e.g. "claude"). */
  selected(): string;
  /** Open the dropdown menu (e.g. from the title field's `↓` key). */
  openMenu(): void;
  /** Whether the menu is currently open. */
  isOpen(): boolean;
  /** Close the menu if open. */
  closeMenu(): void;
};

/**
 * Build a split-button harness picker for a project. Renders immediately with a
 * best-effort selection and populates the menu once the program list resolves.
 */
export function createHarnessPicker(projectKey: string): HarnessPicker {
  const wrap = document.createElement("div");
  wrap.className = "harness-picker";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "harness-button";
  button.setAttribute("aria-haspopup", "menu");

  const caret = document.createElement("span");
  caret.className = "harness-caret";
  caret.textContent = "▾";

  const label = document.createElement("span");
  label.className = "harness-command";
  button.append(label, caret);
  wrap.appendChild(button);

  let shown: ProgramInfo[] = [];
  let selectedCommand = lastUsed(projectKey) ?? "";
  let menu: HTMLDivElement | null = null;

  const render = () => {
    label.textContent = selectedCommand || "…";
  };
  render();

  const select = (command: string) => {
    selectedCommand = command;
    render();
    closeMenu();
    button.focus();
  };

  const closeMenu = () => {
    if (!menu) return;
    menu.remove();
    menu = null;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onOutsideClick, true);
  };

  const onOutsideClick = (e: MouseEvent) => {
    if (!wrap.contains(e.target as Node)) closeMenu();
  };

  const openMenu = () => {
    if (menu || shown.length === 0) return;
    menu = document.createElement("div");
    menu.className = "harness-menu";
    menu.setAttribute("role", "menu");
    for (const p of shown) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "harness-menu-item";
      item.setAttribute("role", "menuitem");
      item.dataset.command = p.command;
      if (p.command === selectedCommand) item.classList.add("selected");

      const tick = document.createElement("span");
      tick.className = "harness-tick";
      tick.textContent = p.command === selectedCommand ? "✓" : "";

      const text = document.createElement("span");
      text.className = "harness-menu-label";
      text.textContent = `${p.label} · ${p.command}`;

      item.append(tick, text);
      item.addEventListener("click", () => select(p.command));
      item.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          (item.nextElementSibling as HTMLElement | null)?.focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          (item.previousElementSibling as HTMLElement | null)?.focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeMenu();
          button.focus();
        }
      });
      menu.appendChild(item);
    }
    wrap.appendChild(menu);
    button.setAttribute("aria-expanded", "true");
    // Focus the current entry so the menu is keyboard-navigable.
    const current = menu.querySelector<HTMLElement>(".harness-menu-item.selected");
    (current ?? menu.querySelector<HTMLElement>(".harness-menu-item"))?.focus();
    // Capture-phase so the open click that triggered us doesn't immediately close it.
    setTimeout(() => document.addEventListener("click", onOutsideClick, true), 0);
  };

  button.addEventListener("click", () => (menu ? closeMenu() : openMenu()));

  // Populate from the resolved program list, then reconcile the selection.
  void loadShownList().then((list) => {
    shown = list;
    selectedCommand = initialSelection(shown, projectKey);
    render();
  });

  return {
    element: wrap,
    selected: () => selectedCommand,
    openMenu,
    isOpen: () => menu !== null,
    closeMenu,
  };
}

export type CreateSessionInput = { title: string; program: string };

/**
 * Modal "New session" prompt with a title field and the harness picker. Resolves
 * to `{ title, program }` on confirm, or `null` on cancel. Mirrors `promptDialog`'s
 * chrome (`.confirm-*`) but carries the extra harness selection.
 */
export function createSessionDialog(
  message: string,
  projectKey: string,
): Promise<CreateSessionInput | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    const box = document.createElement("div");
    box.className = "confirm-box";
    const text = document.createElement("div");
    text.className = "confirm-text";
    text.textContent = message;

    const row = document.createElement("div");
    row.className = "create-session-row";
    const input = noTextAssist(document.createElement("input"));
    input.className = "rename-input";
    input.placeholder = "session title…";
    const picker = createHarnessPicker(projectKey);
    row.append(input, picker.element);

    const buttons = document.createElement("div");
    buttons.className = "confirm-buttons";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.textContent = "Create";
    buttons.append(cancel, ok);
    box.append(text, row, buttons);
    overlay.appendChild(box);

    const done = (result: CreateSessionInput | null) => {
      picker.closeMenu(); // drop the picker's document-level outside-click listener
      overlay.remove();
      resolve(result);
    };
    const submit = () => {
      const title = input.value.trim();
      if (!title) return done(null);
      done({ title, program: picker.selected() });
    };
    cancel.addEventListener("click", () => done(null));
    ok.addEventListener("click", submit);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        if (picker.isOpen()) {
          picker.closeMenu();
          return;
        }
        done(null);
      }
      if (e.key === "ArrowDown" && e.target === input && !picker.isOpen()) {
        e.preventDefault();
        picker.openMenu();
      }
      if (e.key === "Enter" && e.target === input) submit();
    });

    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 0);
  });
}
