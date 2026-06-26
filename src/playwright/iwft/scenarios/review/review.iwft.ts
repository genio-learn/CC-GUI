import { test, expect } from "../../support/fixture.testHelper";
import { defaultSeed, makeReview, SESSION_ID } from "../../network/seed.testHelper";
import type { FileDiff } from "../../../review/model";

test("comment renders after saving, and the fake stores the derived draft", async ({ review }) => {
  await review.selectLine("beta new");
  await review.writeComment("this looks wrong");

  // Observable result: the comment renders (the fake returned it on refresh).
  await expect(review.commentBodies()).toHaveText(["this looks wrong"]);

  // State-based assertion on the fake: the New side won, range/snippet derived
  // from that line (the side/range derivation itself is unit-tested in model.ts).
  const stored = await review.storedComments(SESSION_ID);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    side: "new",
    line_range: [2, 2],
    snippet: "beta new",
    comment: "this looks wrong",
    status: "staged",
  });
});

test("apply sends staged comments and returns to the workspace", async ({ review }) => {
  await review.selectLine("beta new");
  await review.writeComment("nit");

  await expect(review.applyLocator()).toHaveText("Apply (1) →");
  await review.apply();

  // A successful apply clears the staged comment and closes the review,
  // returning to the workspace; the fake recorded the applied comment.
  await expect(review.paneLocator()).toBeHidden();
  const stored = await review.storedComments(SESSION_ID);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ comment: "nit", status: "applied" });
});

test("a comment can be deleted", async ({ review }) => {
  await review.selectLine("beta new");
  await review.writeComment("remove me");
  await expect(review.commentBodies()).toHaveText(["remove me"]);

  await review.deleteFirstComment();
  await expect(review.commentBodies()).toHaveCount(0);
});

test("toggling a file reviewed bands its row and persists to the fake", async ({ review }) => {
  await expect(review.reviewedRows()).toHaveCount(0);

  await review.toggleReviewed("notes.txt");
  await expect(review.reviewedRows()).toHaveCount(1);
  expect(await review.storedReviewed(SESSION_ID)).toEqual(["notes.txt"]);

  // Toggling again clears the mark.
  await review.toggleReviewed("notes.txt");
  await expect(review.reviewedRows()).toHaveCount(0);
  expect(await review.storedReviewed(SESSION_ID)).toEqual([]);
});

test.describe("with two files", () => {
  const emptyFile = (name: string): FileDiff => ({
    old_path: name,
    new_path: name,
    status: "modified",
    added: 1,
    removed: 0,
    hunks: [],
    binary: null,
  });
  test.use({
    seed: {
      ...defaultSeed(),
      reviews: {
        [SESSION_ID]: makeReview({
          diff: { files: [emptyFile("alpha.txt"), emptyFile("zeta.txt")] },
        }),
      },
    },
  });

  test("Ctrl-N/P and arrows move between files", async ({ review }) => {
    // refresh() selects the first file by default.
    await expect.poll(() => review.activeFileName()).toBe("alpha.txt");

    await review.pressFileNav("ArrowDown");
    await expect.poll(() => review.activeFileName()).toBe("zeta.txt");

    await review.pressFileNav("Control+p");
    await expect.poll(() => review.activeFileName()).toBe("alpha.txt");

    await review.pressFileNav("Control+n");
    await expect.poll(() => review.activeFileName()).toBe("zeta.txt");

    await review.pressFileNav("ArrowUp");
    await expect.poll(() => review.activeFileName()).toBe("alpha.txt");
  });
});
