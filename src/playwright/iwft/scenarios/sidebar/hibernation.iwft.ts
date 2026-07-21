import { test, expect } from "../../support/fixture.testHelper";
import { makeSession, makeSnapshot } from "../../network/seed.testHelper";

/** A hibernated session: stopped by the auto-hibernation policy, so status is
 *  "stopped" with the hibernated marker set. */
function hibernatedSnapshot() {
  return makeSnapshot({
    groups: [
      {
        id: "proj-1",
        name: "acme",
        repo_path: "/repos/acme",
        pull_blocked: null,
        sessions: [makeSession({ status: "stopped", hibernated: true })],
      },
    ],
  });
}

test("a hibernated session reads 'Hibernated', not the plain 'Stopped' word", async ({
  sidebar,
}) => {
  await sidebar.pushSnapshot(hibernatedSnapshot());

  expect(await sidebar.statusLabel("fix login bug")).toBe("Hibernated");
});

test("waking a hibernated session resumes it (running, marker cleared)", async ({
  sidebar,
}) => {
  await sidebar.pushSnapshot(hibernatedSnapshot());

  await sidebar.wakeViaRowAction("fix login bug");

  // The fake restart flips the session Running and clears the marker; the row
  // re-renders off the refreshed snapshot.
  await expect(async () => {
    expect(await sidebar.statusLabel("fix login bug")).not.toBe("Hibernated");
  }).toPass();
  const stored = await sidebar.storedSessions();
  expect(stored[0].status).toBe("running");
  expect(stored[0].hibernated).toBe(false);
});
