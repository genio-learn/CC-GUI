// Help overlay listing the GUI's interactions. Toggled with "?" (outside
// inputs) or the Help palette command.

const HELP_SECTIONS: [string, [string, string][]][] = [
  [
    "Sessions",
    [
      ["Click row", "Attach terminal (recreates stopped sessions)"],
      ["Right-click row", "Full menu: shell, review, rename, editor, PR, lifecycle"],
      ["ⓘ / ±", "Details pane / review diff"],
      ["+ on project", "New session (Enter creates, Esc cancels)"],
      ["$ on project", "Project shell terminal"],
      ["Right-click project", "New session, project shell, remove project"],
    ],
  ],
  [
    "Sidebar",
    [
      ["⋯ menu", "Add project, scan directory, delete merged-PR sessions"],
      ["⇄", "Cycle view: project / sections / section stacks"],
      ["Drag row → section", "Move a session to a section (drop on In Progress to unpin)"],
      ["● (yellow)", "Unread: agent finished while you were away"],
      ["🗨", "Session has pending review comments"],
      ["⇣!", "Auto-pull of project main is blocked (hover for reason)"],
      ["commander chip", "Attach the persistent commander session"],
    ],
  ],
  [
    "Review",
    [
      ["Click line", "Select for comment (shift-click extends, Esc clears)"],
      ["Cmd/Ctrl+Enter", "Save comment"],
      ["Apply (n)", "Send staged comments to the agent"],
      ["↻ / Esc", "Refresh diff / close"],
    ],
  ],
  [
    "Global",
    [
      ["Cmd/Ctrl+K", "Fuzzy palette: jump to session or run a command"],
      ["Cmd+W", "Close the active terminal tab (closes the window if none left)"],
      ["Cmd+1–9", "Jump to terminal tab by number"],
      ["Cmd+Opt+←/→", "Previous / next terminal tab"],
      ["Cmd+Opt+↑/↓", "Previous / next session (attaches it)"],
      ["?", "This help"],
    ],
  ],
  [
    "Terminal (macOS line editing)",
    [
      ["Cmd+←/→", "Cursor to line start / end"],
      ["Cmd+Backspace", "Delete to line start"],
      ["Shift+Enter", "Insert a newline without submitting"],
      ["Select text", "Copies to clipboard and clears the highlight"],
      ["Cmd+Click link", "Open the URL in your browser"],
      ["Drag tab", "Reorder the open terminal tabs"],
    ],
  ],
];

const overlay = document.createElement("div");
overlay.id = "help-overlay";
overlay.classList.add("hidden");
const box = document.createElement("div");
box.className = "help-box";
const title = document.createElement("h2");
title.textContent = "CC-GUI help";
box.appendChild(title);
// Sections flow into two masonry-style columns (CSS column-count); each section
// is break-avoid so its heading + table stay together.
const columns = document.createElement("div");
columns.className = "help-columns";
box.appendChild(columns);
for (const [section, rows] of HELP_SECTIONS) {
  const block = document.createElement("div");
  block.className = "help-section";
  const h = document.createElement("h3");
  h.textContent = section;
  block.appendChild(h);
  const table = document.createElement("dl");
  table.className = "help-table";
  for (const [key, desc] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = desc;
    table.append(dt, dd);
  }
  block.appendChild(table);
  columns.appendChild(block);
}
// Keybindings section, filled in once the config's key table is fetched
// (main.ts wires the supported actions through setHelpKeybindings).
const keybindBlock = document.createElement("div");
keybindBlock.className = "help-section";
const keybindHeader = document.createElement("h3");
keybindHeader.textContent = "Keyboard (claude-commander config)";
const keybindTable = document.createElement("dl");
keybindTable.className = "help-table";
keybindBlock.style.display = "none";
keybindBlock.append(keybindHeader, keybindTable);
columns.appendChild(keybindBlock);

export function setHelpKeybindings(rows: [string, string][]): void {
  keybindTable.innerHTML = "";
  keybindBlock.style.display = rows.length ? "" : "none";
  for (const [keys, desc] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = keys;
    const dd = document.createElement("dd");
    dd.textContent = desc;
    keybindTable.append(dt, dd);
  }
}

overlay.appendChild(box);
document.body.appendChild(overlay);

export function toggleHelp(): void {
  overlay.classList.toggle("hidden");
}

overlay.addEventListener("click", (e) => {
  if (e.target === overlay) toggleHelp();
});

// Opening is bound through the config's show_help action (main.ts); these
// only close an open overlay, so they can't double-fire with that binding.
document.addEventListener("keydown", (e) => {
  if (overlay.classList.contains("hidden")) return;
  const target = e.target as HTMLElement;
  const inInput =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.closest(".xterm") !== null;
  if ((e.key === "?" && !inInput) || e.key === "Escape") toggleHelp();
});
