// Draggable panel borders: a thin handle on one edge of a panel adjusts its
// width, persisted to localStorage so layouts survive restarts.

type ResizerOpts = {
  /** localStorage key for the persisted width. */
  key: string;
  /** Panel whose width is adjusted. */
  target: HTMLElement;
  /** Edge of the panel the handle sits on (the border being dragged). */
  edge: "left" | "right";
  min: number;
  max: number;
  /** Called (throttled to animation frames) while the width changes. */
  onResize?: () => void;
};

const resizers = new Map<string, ResizerOpts>();

function setWidth(opts: ResizerOpts, width: number): void {
  const clamped = Math.min(opts.max, Math.max(opts.min, width));
  opts.target.style.width = `${clamped}px`;
  localStorage.setItem(opts.key, String(clamped));
  if (opts.onResize) requestAnimationFrame(opts.onResize);
}

/** Adjust a registered panel's width by a delta (used by keybindings). */
export function adjustPanelWidth(key: string, delta: number): void {
  const opts = resizers.get(key);
  if (!opts) return;
  setWidth(opts, opts.target.offsetWidth + delta);
}

export function makeResizable(opts: ResizerOpts): void {
  resizers.set(opts.key, opts);

  const saved = Number(localStorage.getItem(opts.key));
  if (saved >= opts.min && saved <= opts.max) {
    opts.target.style.width = `${saved}px`;
  }

  const handle = document.createElement("div");
  handle.className = `panel-resizer ${opts.edge}`;
  opts.target.style.position = "relative";
  opts.target.appendChild(handle);

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = opts.target.offsetWidth;
    // Dragging the right edge rightwards grows the panel; the left edge,
    // shrinks it.
    const sign = opts.edge === "right" ? 1 : -1;
    document.body.classList.add("resizing");

    const onMove = (ev: MouseEvent) => {
      setWidth(opts, startWidth + sign * (ev.clientX - startX));
    };
    const onUp = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (opts.onResize) opts.onResize();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}
