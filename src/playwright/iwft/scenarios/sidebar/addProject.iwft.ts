import { test, expect } from "../../support/fixture.testHelper";
import { makeSnapshot } from "../../network/seed.testHelper";

// The add-project path input lives behind the sidebar ⋯ menu. These exercise the
// autocomplete dropdown (type → filter, Tab → common prefix, ↑/↓ → drill in),
// the free-text commit, and the native Browse… picker. The fake answers
// complete_path from a seeded directory list (no real filesystem).
test.use({
  seed: {
    snapshot: makeSnapshot(),
    reviews: {},
    dirs: ["/repos/acme", "/repos/beta", "/repos/beta-two", "/work/proj"],
    browsePath: "/picked/repo",
  },
});

test("autocomplete lists directories matching what you type", async ({ sidebar }) => {
  await sidebar.openAddProject();
  await sidebar.typePath("/repos/");
  await expect(sidebar.pathCompletions()).toHaveText(["/repos/acme", "/repos/beta", "/repos/beta-two"]);

  await sidebar.typePath("/repos/be");
  await expect(sidebar.pathCompletions()).toHaveText(["/repos/beta", "/repos/beta-two"]);
});

test("Tab completes to the longest common prefix", async ({ sidebar }) => {
  await sidebar.openAddProject();
  await sidebar.typePath("/repos/be");
  await sidebar.pressInPath("Tab");
  expect(await sidebar.pathValue()).toBe("/repos/beta");
});

test("arrow-select then Enter drills into the directory", async ({ sidebar }) => {
  await sidebar.openAddProject();
  await sidebar.typePath("/repos/");
  await sidebar.pressInPath("ArrowDown"); // highlight /repos/acme
  await sidebar.pressInPath("Enter"); // drill in, not commit
  expect(await sidebar.pathValue()).toBe("/repos/acme/");
  // Still in the input — no project added yet.
  expect((await sidebar.storedProjects()).map((p) => p.repo_path)).not.toContain("/repos/acme/");
});

test("Enter on free text commits the project", async ({ sidebar }) => {
  await sidebar.openAddProject();
  await sidebar.typePath("/repos/beta-two");
  await sidebar.pressInPath("Enter"); // nothing highlighted → commit

  await expect(async () => {
    const repos = (await sidebar.storedProjects()).map((p) => p.repo_path);
    expect(repos).toContain("/repos/beta-two");
  }).toPass();
  // The new project header renders in the sidebar.
  await expect(sidebar.sectionHeader("beta-two")).toBeVisible();
});

test("Browse… fills the input from the native picker", async ({ sidebar }) => {
  await sidebar.openAddProject();
  await sidebar.clickBrowse();
  await expect(async () => {
    expect(await sidebar.pathValue()).toBe("/picked/repo");
  }).toPass();
});
