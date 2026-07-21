import { describe, it, expect } from "vitest";
import { statusChip, commentsChip, pullBlockedChip, stackChip, shellChip } from "./status";

/** The chip's leading shape: a colour dot, a glyph, or nothing. */
function shape(chip: HTMLElement): "dot" | string | null {
  if (chip.querySelector(".chip-dot")) return "dot";
  return chip.querySelector(".chip-glyph")?.textContent ?? null;
}

const label = (chip: HTMLElement) => chip.querySelector(".chip-label")?.textContent ?? "";
const tone = (chip: HTMLElement) =>
  [...chip.classList].find((c) => c.startsWith("tone-"))?.slice(5) ?? "";

describe("status chip vocabulary", () => {
  it("gives each liveness state a distinct word", () => {
    expect(label(statusChip("running"))).toBe("Running");
    expect(label(statusChip("finished"))).toBe("Done");
    expect(label(statusChip("idle"))).toBe("Idle");
    expect(label(statusChip("stopped"))).toBe("Stopped");
    expect(label(statusChip("waiting"))).toBe("Waiting");
    expect(label(statusChip("hibernated"))).toBe("Hibernated");
  });

  it("keeps one warning hue: Done and Waiting share --warning but differ by shape", () => {
    const done = statusChip("finished");
    const waiting = statusChip("waiting");
    expect(tone(done)).toBe("warning");
    expect(tone(waiting)).toBe("warning");
    // Distinct shapes disambiguate them without a second colour.
    expect(shape(done)).toBe("dot");
    expect(shape(waiting)).toBe("?");
  });

  it("maps the remaining states to their reserved tokens", () => {
    expect(tone(statusChip("running"))).toBe("success");
    expect(tone(statusChip("idle"))).toBe("cyan");
    expect(tone(statusChip("stopped"))).toBe("dim");
    expect(tone(statusChip("hibernated"))).toBe("dim");
  });

  it("lets transient states carry a humanized word", () => {
    expect(label(statusChip("transient", { word: "Merging" }))).toBe("Merging");
  });

  it("pull-blocked uses the single reserved danger hue", () => {
    const chip = pullBlockedChip();
    expect(tone(chip)).toBe("danger");
    expect(shape(chip)).toBe("⚠");
    expect(label(chip)).toBe("Pull blocked");
  });

  it("comments chip spells out a count in mono, or reads 'Comments' without one", () => {
    expect(label(commentsChip())).toBe("Comments");
    expect(commentsChip()?.querySelector(".chip-count")).toBeNull();

    const three = commentsChip(3);
    expect(three.querySelector(".chip-count")?.textContent).toBe("3");
    expect(label(three)).toBe("comments");
    expect(label(commentsChip(1))).toBe("comment");
  });

  it("stack chip trails its depth count", () => {
    const chip = stackChip(3);
    expect(label(chip)).toBe("Stack of");
    expect(chip.querySelector(".chip-count")?.textContent).toBe("3");
    // Count comes after the label ("Stack of 3").
    const parts = [...chip.children].map((c) => c.className);
    expect(parts.indexOf("chip-count")).toBeGreaterThan(parts.indexOf("chip-label"));
  });

  it("shell chip reads '❯ Shell' on the info tone", () => {
    const chip = shellChip();
    expect(shape(chip)).toBe("❯");
    expect(label(chip)).toBe("Shell");
    // Info (mauve), grouped with ✎ comments / ⌗ stack — see shellChip's note.
    expect(tone(chip)).toBe("info");
  });
});
