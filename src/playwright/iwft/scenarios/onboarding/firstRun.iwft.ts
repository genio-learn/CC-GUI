import { test, expect } from "../../support/fixture.testHelper";
import { makeSnapshot } from "../../network/seed.testHelper";
import { TerminalPageObject } from "../../../pageObjects/TerminalPageObject.testHelper";

// First-run onboarding (design_handoff §07): zero projects renders a welcome
// hero over the terminal pane teaching the three entry actions. It is purely
// state-driven off the live snapshot AND the terminal attach state — no
// persisted "seen onboarding" flag — so it must yield the instant the first
// project lands, or a terminal attaches (e.g. via card 3's commander CTA).

test.describe("zero projects, commander disabled (default)", () => {
  test.use({
    seed: {
      snapshot: makeSnapshot({ groups: [] }),
      reviews: {},
    },
  });

  test("shows the hero with its three entry actions", async ({ onboarding }) => {
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

  test("card 3 (Meet commander) is inert when the commander isn't configured", async ({
    onboarding,
  }) => {
    // Same treatment as card 2's "After a project" placeholder — no live CTA,
    // so it can never fire prepare_commander into a raw error toast.
    await expect(onboarding.commanderButton()).toBeDisabled();
  });

  test("Choose folder… cancelled falls back to the sidebar's path input", async ({
    onboarding,
    page,
  }) => {
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
});

test.describe("zero projects, commander enabled", () => {
  test.use({
    seed: {
      snapshot: makeSnapshot({ groups: [], commander: { enabled: true, running: false } }),
      reviews: {},
    },
  });

  test("Attach ⏎ attaches the commander terminal and the hero yields to it", async ({
    onboarding,
    page,
  }) => {
    await expect(onboarding.commanderButton()).toBeEnabled();
    await expect.poll(() => onboarding.isVisible()).toBe(true);

    await onboarding.clickCommander();

    const terminal = new TerminalPageObject(page);
    await expect(terminal.tabLabels()).toHaveText(["commander"]);
    // Groups are still empty — only the freshly attached terminal explains
    // the hero yielding, proving the gate is on attach state too.
    await expect.poll(() => onboarding.isVisible()).toBe(false);
  });
});

test.describe("zero projects, folder picker returns a path", () => {
  test.use({
    seed: {
      snapshot: makeSnapshot({ groups: [] }),
      reviews: {},
      browsePath: "/repos/picked",
    },
  });

  test("Choose folder… adds the picked project directly (no path input needed)", async ({
    onboarding,
  }) => {
    await onboarding.clickAddProject();

    await expect(async () => {
      const repos = (await onboarding.storedProjects()).map((p) => p.repo_path);
      expect(repos).toContain("/repos/picked");
    }).toPass();
  });
});
