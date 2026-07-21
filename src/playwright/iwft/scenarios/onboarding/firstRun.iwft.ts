import { test, expect } from "../../support/fixture.testHelper";
import { makeSnapshot } from "../../network/seed.testHelper";

// First-run onboarding (design_handoff §07): zero projects renders a welcome
// hero over the terminal pane teaching the three entry actions. It is purely
// state-driven off the live snapshot — no persisted "seen onboarding" flag —
// so it must yield the instant the first project lands.
test.use({
  seed: {
    snapshot: makeSnapshot({ groups: [] }),
    reviews: {},
  },
});

test("zero projects shows the hero with its three entry actions", async ({ onboarding }) => {
  await expect.poll(() => onboarding.isVisible()).toBe(true);
  await expect(onboarding.title()).toHaveText("Run your agents, side by side.");
  await expect(onboarding.cardTitles()).toHaveText([
    "1 · Add a project",
    "2 · Start a session",
    "3 · Meet commander",
  ]);
  await expect(onboarding.addProjectButton()).toHaveText("Choose folder…");
  await expect(onboarding.commanderButton()).toHaveText("Attach ⏎");
});

test("Choose folder… opens the sidebar's add-project path input", async ({ onboarding, page }) => {
  await onboarding.clickAddProject();
  await expect(page.locator(".path-input input")).toBeVisible();
});

test("the hero yields to the workspace the moment the first project lands", async ({
  onboarding,
}) => {
  await expect.poll(() => onboarding.isVisible()).toBe(true);

  await onboarding.pushSnapshot(makeSnapshot()); // the default one-project seed

  await expect.poll(() => onboarding.isVisible()).toBe(false);
});
