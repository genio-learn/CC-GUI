import { test, expect } from "../../support/fixture.testHelper";
import { makeSession, makeSnapshot } from "../../network/seed.testHelper";

// The "N waiting on you" attention summary (audit: "promote an attention
// summary to the title bar and the top of the Board"). Counts sessions whose
// agent asked for input plus ones that finished while away (unread).

test("stays hidden while nothing waits on the user", async ({ sidebar }) => {
  // Default seed: one running/idle session — not waiting on anyone.
  await expect(sidebar.titles()).toHaveText(["fix login bug"]);
  await expect(sidebar.attentionPill()).toBeHidden();
});

test.describe("with a waiting and an unread session", () => {
  const seededSnapshot = () =>
    makeSnapshot({
      groups: [
        {
          id: "proj-1",
          name: "acme",
          repo_path: "/repos/acme",
          pull_blocked: null,
          sessions: [
            makeSession(), // running/idle — not in the queue
            makeSession({
              id: "sess-2",
              title: "needs input",
              tmux_session_name: "cc-sess-2",
              agent_state: "waitingforinput",
            }),
            makeSession({
              id: "sess-3",
              title: "done while away",
              tmux_session_name: "cc-sess-3",
              unread: true,
            }),
          ],
        },
      ],
    });

  test.use({ seed: { snapshot: seededSnapshot(), reviews: {} } });

  test("counts them in the title-bar pill", async ({ sidebar }) => {
    await expect(sidebar.attentionPill()).toHaveText("2 waiting on you");
    await expect(sidebar.attentionPill()).toBeVisible();
  });

  test("mirrors the count at the top of the Board", async ({ board }) => {
    await board.enter();
    await expect(board.boardAttention()).toHaveText("2 waiting on you");
  });

  test("clears when the queue drains (event push)", async ({ sidebar }) => {
    await expect(sidebar.attentionPill()).toBeVisible();
    await sidebar.pushSnapshot(makeSnapshot()); // back to one idle session
    await expect(sidebar.attentionPill()).toBeHidden();
  });
});
