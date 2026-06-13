import { describe, it, expect } from "vitest";
import { score } from "./palette";

describe("score", () => {
  it("matches a contiguous substring", () => {
    expect(score("abc", "abc")).not.toBeNull();
  });

  it("matches a non-contiguous subsequence", () => {
    expect(score("ac", "abc")).not.toBeNull();
  });

  it("returns null when the query is not a subsequence", () => {
    expect(score("abc", "xyz")).toBeNull();
    expect(score("ca", "abc")).toBeNull(); // order matters
  });

  it("is case-insensitive", () => {
    expect(score("ABC", "abc")).toBe(score("abc", "abc"));
  });

  it("ranks contiguous matches above scattered ones", () => {
    expect(score("ab", "ab x")!).toBeGreaterThan(score("ab", "a x b")!);
  });

  it("ranks earlier matches above later ones", () => {
    expect(score("a", "a")!).toBeGreaterThan(score("a", "xa")!);
  });

  it("treats an empty query as a (zero-score) match", () => {
    expect(score("", "anything")).toBe(0);
  });
});
