// Base for page objects. Wraps a Page and the test.step grouping used in the
// genio POMs, so each action shows as a labelled step in the trace.

import { test, type Locator, type Page } from "@playwright/test";

export abstract class AppPageObject {
  constructor(protected readonly page: Page) {}

  protected step<T>(name: string, body: () => Promise<T>): Promise<T> {
    return test.step(`${this.constructor.name}.${name}`, body);
  }

  /** Pointer-based drag from one element's centre to another's. Native HTML5 DnD
   *  is disabled (Tauri's OS drag-drop handler swallows it — see main.ts
   *  `draggable`), so drags are driven by real pointer events: press, cross the
   *  4px threshold, move to the target, release. */
  protected async pointerDragElement(from: Locator, to: Locator): Promise<void> {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    if (!a || !b) throw new Error("pointerDragElement: source or target not visible");
    const ax = a.x + a.width / 2;
    const ay = a.y + a.height / 2;
    const { mouse } = this.page;
    await mouse.move(ax, ay);
    await mouse.down();
    await mouse.move(ax + 6, ay, { steps: 3 }); // cross the drag threshold
    await mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
    await mouse.up();
  }
}
