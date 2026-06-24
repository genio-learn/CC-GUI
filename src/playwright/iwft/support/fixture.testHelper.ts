// Test fixtures (genio style): a per-test seed and page objects launched against
// it. Scenarios read `test('…', async ({ review }) => …)` with the app already
// booted and the review pane ready to drive.

import { test as base } from "@playwright/test";
import { launchApp } from "./launchApp.testHelper";
import { defaultSeed } from "../network/seed.testHelper";
import type { Seed } from "../network/types.testHelper";
import { ReviewPanePageObject } from "../../pageObjects/ReviewPanePageObject.testHelper";
import { SidebarPageObject } from "../../pageObjects/SidebarPageObject.testHelper";
import { PalettePageObject } from "../../pageObjects/PalettePageObject.testHelper";
import { ThemePickerPageObject } from "../../pageObjects/ThemePickerPageObject.testHelper";
import { SettingsModalPageObject } from "../../pageObjects/SettingsModalPageObject.testHelper";
import { DialogsPageObject } from "../../pageObjects/DialogsPageObject.testHelper";
import { TerminalPageObject } from "../../pageObjects/TerminalPageObject.testHelper";
import { BoardPageObject } from "../../pageObjects/BoardPageObject.testHelper";

interface Fixtures {
  /** Override in a test via `test.use({ seed: customSeed })` for bespoke state. */
  seed: Seed;
  /** App booted against `seed`, review pane opened on the first session. */
  review: ReviewPanePageObject;
  /** App booted against `seed`, sidebar ready (no surface opened). */
  sidebar: SidebarPageObject;
  /** App booted against `seed`, palette object ready (palette starts closed). */
  palette: PalettePageObject;
  /** App booted against `seed`, theme picker object ready (modal starts closed). */
  themePicker: ThemePickerPageObject;
  /** App booted against `seed`, settings modal object ready (modal starts closed). */
  settings: SettingsModalPageObject;
  /** App booted against `seed`, dialogs object ready to drive confirm/prompt. */
  dialogs: DialogsPageObject;
  /** App booted against `seed`, terminal object ready (no tab open yet). */
  terminal: TerminalPageObject;
  /** App booted against `seed`, board object ready (Console layout; call enter()). */
  board: BoardPageObject;
}

export const test = base.extend<Fixtures>({
  seed: async ({}, use) => {
    await use(defaultSeed());
  },
  review: async ({ page, seed }, use) => {
    await launchApp(page, seed);
    const review = new ReviewPanePageObject(page);
    await review.openFirstSession();
    await use(review);
  },
  sidebar: async ({ page, seed }, use) => {
    await launchApp(page, seed);
    await use(new SidebarPageObject(page));
  },
  palette: async ({ page, seed }, use) => {
    await launchApp(page, seed);
    await use(new PalettePageObject(page));
  },
  themePicker: async ({ page, seed }, use) => {
    await launchApp(page, seed);
    await use(new ThemePickerPageObject(page));
  },
  settings: async ({ page, seed }, use) => {
    await launchApp(page, seed);
    await use(new SettingsModalPageObject(page));
  },
  dialogs: async ({ page, seed }, use) => {
    await launchApp(page, seed);
    await use(new DialogsPageObject(page));
  },
  terminal: async ({ page, seed }, use) => {
    await launchApp(page, seed);
    await use(new TerminalPageObject(page));
  },
  board: async ({ page, seed }, use) => {
    await launchApp(page, seed);
    await use(new BoardPageObject(page));
  },
});

export { expect } from "@playwright/test";
