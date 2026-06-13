// Base for page objects. Wraps a Page and the test.step grouping used in the
// genio POMs, so each action shows as a labelled step in the trace.

import { test, type Page } from "@playwright/test";

export abstract class AppPageObject {
  constructor(protected readonly page: Page) {}

  protected step<T>(name: string, body: () => Promise<T>): Promise<T> {
    return test.step(`${this.constructor.name}.${name}`, body);
  }
}
