// Draggable panel borders: a thin handle on one edge of a panel adjusts its
// width (left/right edges) or height (top edge), persisted to localStorage so
// layouts survive restarts.

type ResizerOpts = {
  /** localStorage key for the persisted width/height. */
  key: string;
  /** Panel whose width or height is adjusted. */
  target: HTMLElement;
  /** Edge of the panel the handle sits on (the border being dragged). A
   *  left/right edge adjusts width (horizontal); a top edge adjusts height. */
  edge: "left" | "right" | "top";
  min: number;
  max: number;
  /** Called (throttled to animation frames) while the size changes. */
  onResize?: () => void;
};

const resizers = new Map<string, ResizerOpts>();

function setSize(opts: ResizerOpts, size: number): void {
  const clamped = Math.min(opts.max, Math.max(opts.min, size));
  if (opts.edge === "top") {
    opts.target.style.height = `${clamped}px`;
  } else {
    opts.target.style.width = `${clamped}px`;
  }
  localStorage.setItem(opts.key, String(clamped));
  if (opts.onResize) requestAnimationFrame(opts.onResize);
}

/** Adjust a registered panel's width by a delta (used by keybindings). */
export function adjustPanelWidth(key: string, delta: number): void {
  const opts = resizers.get(key);
  if (!opts || opts.edge === "top") return;
  setSize(opts, opts.target.offsetWidth + delta);
}

export function makeResizable(opts: ResizerOpts): void {
  resizers.set(opts.key, opts);
  const vertical = opts.edge === "top";

  const saved = Number(localStorage.getItem(opts.key));
  if (saved >= opts.min && saved <= opts.max) {
    opts.target.style[vertical ? "height" : "width"] = `${saved}px`;
  }

  const handle = document.createElement("div");
  handle.className = `panel-resizer ${opts.edge}`;
  opts.target.style.position = "relative";
  opts.target.appendChild(handle);

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    document.body.classList.add("resizing");
    if (vertical) document.body.classList.add("vertical");

    if (vertical) {
      const startY = e.clientY;
      const startHeight = opts.target.offsetHeight;
      // Dragging the top edge upwards grows the panel (the dock lives at the
      // bottom of the board, so its top border moves up as it grows).
      const onMove = (ev: MouseEvent) => {
        setSize(opts, startHeight - (ev.clientY - startY));
      };
      const onUp = () => {
        document.body.classList.remove("resizing", "vertical");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (opts.onResize) opts.onResize();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return;
    }

    const startX = e.clientX;
    const startWidth = opts.target.offsetWidth;
    // Dragging the right edge rightwards grows the panel; the left edge,
    // shrinks it.
    const sign = opts.edge === "right" ? 1 : -1;

    const onMove = (ev: MouseEvent) => {
      setSize(opts, startWidth + sign * (ev.clientX - startX));
    };
    const onUp = () => {
      document.body.classList.remove("resizing", "vertical");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (opts.onResize) opts.onResize();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}
