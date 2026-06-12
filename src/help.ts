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
      ["?", "This help"],
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
for (const [section, rows] of HELP_SECTIONS) {
  const h = document.createElement("h3");
  h.textContent = section;
  box.appendChild(h);
  const table = document.createElement("dl");
  table.className = "help-table";
  for (const [key, desc] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = desc;
    table.append(dt, dd);
  }
  box.appendChild(table);
}
overlay.appendChild(box);
document.body.appendChild(overlay);

export function toggleHelp(): void {
  overlay.classList.toggle("hidden");
}

overlay.addEventListener("click", (e) => {
  if (e.target === overlay) toggleHelp();
});

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  const inInput =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.closest(".xterm") !== null;
  if (e.key === "?" && !inInput) toggleHelp();
  if (e.key === "Escape" && !overlay.classList.contains("hidden")) toggleHelp();
});
