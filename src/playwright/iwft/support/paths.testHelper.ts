// Where globalSetup writes the bundled simulator and where launchApp reads it.
// Repo-root relative (Playwright runs from the project root). Gitignored.
export const SIMULATOR_ENTRY = "src/playwright/iwft/network/TauriSimulator.testHelper.ts";
export const SIMULATOR_BUNDLE = ".iwft/simulator.bundle.js";
