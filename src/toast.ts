// In-app toasts and confirm dialog. wry's WKWebView on macOS implements
// neither window.alert (silent no-op) nor window.confirm (always false), so
// native JS dialogs must never be used — route everything through here.

let stack: HTMLDivElement | null = null;

function toastStack(): HTMLDivElement {
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

/** Show a transient toast. Errors stay longer and are styled red. */
export function toast(message: string, kind: "info" | "error" = "info"): void {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  el.addEventListener("click", () => el.remove());
  toastStack().appendChild(el);
  setTimeout(() => {
    el.classList.add("fade");
    setTimeout(() => el.remove(), 300);
  }, kind === "error" ? 8000 : 4000);
}

/**
 * In-app replacement for window.confirm. Resolves true on Confirm/Enter,
 * false on Cancel/Esc/backdrop click.
 */
export function confirmDialog(message: string, confirmLabel = "Confirm"): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    const box = document.createElement("div");
    box.className = "confirm-box";
    const text = document.createElement("div");
    text.className = "confirm-text";
    text.textContent = message;
    const buttons = document.createElement("div");
    buttons.className = "confirm-buttons";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.className = "danger";
    ok.textContent = confirmLabel;
    buttons.append(cancel, ok);
    box.append(text, buttons);
    overlay.appendChild(box);

    const done = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };
    cancel.addEventListener("click", () => done(false));
    ok.addEventListener("click", () => done(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(false);
    });
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") done(false);
      // Don't override a focused Cancel button: Enter there means cancel.
      if (e.key === "Enter" && document.activeElement !== cancel) done(true);
    });

    document.body.appendChild(overlay);
    ok.focus();
  });
}
