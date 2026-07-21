import { type Locator } from "@playwright/test";
import { AppPageObject } from "./AppPageObject.testHelper";
import type { Snapshot } from "../iwft/network/types.testHelper";

// Drives the first-run onboarding hero (#onboarding), shown over the terminal
// pane whenever there are zero projects and hidden the instant the first one
// lands — state-driven off the live snapshot, no persisted flag.
export class OnboardingPageObject extends AppPageObject {
  private readonly hero = this.page.locator("#onboarding");

  isVisible(): Promise<boolean> {
    return this.hero.isVisible();
  }

  title(): Locator {
    return this.hero.locator(".onboarding-title");
  }

  cardTitles(): Locator {
    return this.hero.locator(".onboarding-card-title");
  }

  addProjectButton(): Locator {
    return this.hero.locator("#onboarding-add-project");
  }

  commanderButton(): Locator {
    return this.hero.locator("#onboarding-commander");
  }

  clickAddProject(): Promise<void> {
    return this.step("clickAddProject", () => this.addProjectButton().click());
  }

  clickCommander(): Promise<void> {
    return this.step("clickCommander", () => this.commanderButton().click());
  }

  /** Push a snapshot through the real listen() path, exactly as the backend
   *  would — used here to simulate the first project landing. */
  pushSnapshot(snapshot: Snapshot): Promise<void> {
    return this.step("pushSnapshot", () =>
      this.page.evaluate(
        (snap) =>
          (window as unknown as { __CC_SIM__: { pushSnapshot(s: unknown): Promise<void> } })
            .__CC_SIM__.pushSnapshot(snap),
        snapshot,
      ),
    );
  }

  /** Projects the fake holds (name + repo_path) — assert the folder-picker
   *  CTA added one directly, without going through the sidebar's path input. */
  storedProjects(): Promise<{ id: string; name: string; repo_path: string }[]> {
    return this.page.evaluate(
      () =>
        (
          window as unknown as {
            __CC_SIM__: { getProjects(): { id: string; name: string; repo_path: string }[] };
          }
        ).__CC_SIM__.getProjects(),
    );
  }
}
