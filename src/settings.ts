// Settings modal: a generic form over claude-commander's Config JSON.
// Scalars get typed inputs; arrays/objects get JSON textareas. Saving
// round-trips the whole object through save_config (serde-validated).

import { invoke } from "@tauri-apps/api/core";
import { toast } from "./toast";
import { noTextAssist } from "./dom";

const overlay = document.createElement("div");
overlay.id = "settings-overlay";
overlay.classList.add("hidden");
const box = document.createElement("div");
box.className = "settings-box";
overlay.appendChild(box);
document.body.appendChild(overlay);

type ConfigValue = string | number | boolean | null | unknown[] | Record<string, unknown>;

let current: Record<string, ConfigValue> = {};

function fieldInput(key: string, value: ConfigValue): HTMLElement {
  if (typeof value === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value;
    input.dataset.key = key;
    input.dataset.kind = "bool";
    return input;
  }
  if (typeof value === "number") {
    const input = document.createElement("input");
    input.type = "number";
    input.value = String(value);
    input.dataset.key = key;
    input.dataset.kind = "number";
    return input;
  }
  if (value === null || typeof value === "string") {
    const input = noTextAssist(document.createElement("input"));
    input.type = "text";
    input.value = value ?? "";
    input.placeholder = value === null ? "(unset)" : "";
    input.dataset.key = key;
    input.dataset.kind = value === null ? "nullable" : "string";
    return input;
  }
  const area = noTextAssist(document.createElement("textarea"));
  area.value = JSON.stringify(value, null, 2);
  area.rows = Math.min(8, Math.max(2, JSON.stringify(value, null, 2).split("\n").length));
  area.dataset.key = key;
  area.dataset.kind = "json";
  return area;
}

/** A friendly on/off control for the `telemetry` object, surfacing its
 *  `enabled` flag as a checkbox instead of a raw JSON blob. Endpoint/token
 *  (self-hoster fields) are left to the config file and preserved on save. */
function telemetryToggle(): HTMLElement {
  const tel = (current.telemetry ?? {}) as Record<string, unknown>;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = tel.enabled !== false; // on by default
  input.dataset.key = "telemetry";
  input.dataset.kind = "telemetry-enabled";
  return input;
}

function collect(): Record<string, ConfigValue> | null {
  const out: Record<string, ConfigValue> = { ...current };
  for (const el of box.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-key]")) {
    const key = el.dataset.key!;
    switch (el.dataset.kind) {
      case "bool":
        out[key] = (el as HTMLInputElement).checked;
        break;
      case "number": {
        const n = Number(el.value);
        if (Number.isNaN(n)) {
          toast(`${key}: not a number`, "error");
          return null;
        }
        out[key] = n;
        break;
      }
      case "nullable":
        out[key] = el.value.trim() === "" ? null : el.value;
        break;
      case "string":
        out[key] = el.value;
        break;
      case "telemetry-enabled": {
        // Update only `enabled`, preserving any endpoint/token already set.
        const prev = (current.telemetry ?? {}) as Record<string, unknown>;
        out["telemetry"] = { ...prev, enabled: (el as HTMLInputElement).checked };
        break;
      }
      case "json":
        try {
          out[key] = JSON.parse(el.value);
        } catch (e) {
          toast(`${key}: invalid JSON — ${e}`, "error");
          return null;
        }
        break;
    }
  }
  return out;
}

function render(): void {
  box.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Settings (claude-commander config)";
  box.appendChild(title);
  const note = document.createElement("p");
  note.className = "settings-note";
  note.textContent =
    "Shared with the TUI and CLI. Some changes need an app restart to take effect.";
  box.appendChild(note);

  const grid = document.createElement("div");
  grid.className = "settings-grid";
  for (const key of Object.keys(current).sort()) {
    const label = document.createElement("label");
    if (key === "telemetry") {
      label.textContent = "telemetry (send anonymous usage)";
      grid.appendChild(label);
      grid.appendChild(telemetryToggle());
      continue;
    }
    label.textContent = key;
    grid.appendChild(label);
    grid.appendChild(fieldInput(key, current[key]));
  }
  box.appendChild(grid);

  const buttons = document.createElement("div");
  buttons.className = "editor-buttons";
  const cancel = document.createElement("button");
  cancel.className = "row-action";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closeSettings);
  const save = document.createElement("button");
  save.className = "row-action";
  save.textContent = "Save";
  save.addEventListener("click", () => void saveSettings());
  buttons.append(cancel, save);
  box.appendChild(buttons);
}

async function saveSettings(): Promise<void> {
  const config = collect();
  if (!config) return;
  try {
    const restartRequired = await invoke<boolean>("save_config", { config });
    closeSettings();
    if (restartRequired) {
      toast("Saved. Some changes take effect after restarting the app.");
    }
  } catch (e) {
    toast(`save failed: ${e}`, "error");
  }
}

export async function openSettings(): Promise<void> {
  try {
    current = await invoke<Record<string, ConfigValue>>("get_config");
  } catch (e) {
    toast(`failed to load config: ${e}`, "error");
    return;
  }
  render();
  overlay.classList.remove("hidden");
}

function closeSettings(): void {
  overlay.classList.add("hidden");
}

overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeSettings();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeSettings();
});
