// Minimal custom context menu: one floating menu at a time, dismissed by any
// click, Esc, or scroll.

export type MenuItem =
  | {
      label: string;
      action: () => void;
      danger?: boolean;
      warning?: boolean;
      /** Formatted shortcut glyphs (e.g. "⌃D"), shown right-aligned. */
      shortcut?: string;
      /** Consequence text shown dim and inline after the label (e.g. "keeps the worktree"). */
      sublabel?: string;
    }
  | "separator";

let menuEl: HTMLDivElement | null = null;

export function dismissMenu(): void {
  menuEl?.remove();
  menuEl = null;
}

export function showContextMenu(e: MouseEvent, items: MenuItem[]): void {
  e.preventDefault();
  e.stopPropagation();
  dismissMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  for (const item of items) {
    if (item === "separator") {
      const sep = document.createElement("div");
      sep.className = "menu-separator";
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement("div");
    row.className = "menu-item";
    if (item.danger) row.classList.add("danger");
    if (item.warning) row.classList.add("warning");
    const label = document.createElement("span");
    label.className = "menu-label";
    label.textContent = item.label;
    if (item.sublabel) {
      const sub = document.createElement("span");
      sub.className = "menu-sublabel";
      sub.textContent = ` · ${item.sublabel}`;
      label.appendChild(sub);
    }
    row.appendChild(label);
    if (item.shortcut) {
      const kbd = document.createElement("span");
      kbd.className = "menu-shortcut";
      kbd.textContent = item.shortcut;
      row.appendChild(kbd);
    }
    row.addEventListener("click", () => {
      dismissMenu();
      item.action();
    });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  menuEl = menu;

  // Position, clamped to the viewport.
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(e.clientX, innerWidth - rect.width - 4)}px`;
  menu.style.top = `${Math.min(e.clientY, innerHeight - rect.height - 4)}px`;
}

document.addEventListener("click", dismissMenu);
document.addEventListener("contextmenu", (e) => {
  // Right-clicking outside a menu trigger dismisses any open menu.
  if (menuEl && !menuEl.contains(e.target as Node)) dismissMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") dismissMenu();
});
window.addEventListener("blur", dismissMenu);
