import { describe, it, expect } from "vitest";
import { parseBinding, matches, formatBinding, type ParsedBinding } from "./keys";

const ev = (key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  new KeyboardEvent("keydown", {
    key,
    ctrlKey: mods.ctrlKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    metaKey: mods.metaKey ?? false,
  });

describe("parseBinding", () => {
  it("parses a single-char binding with shift left null", () => {
    // e.key already encodes shift for single chars, so the bit is intentionally null.
    expect(parseBinding("Ctrl-c")).toEqual({ ctrl: true, alt: false, shift: null, key: "c" });
  });

  it("maps named keys via the crossterm table", () => {
    expect(parseBinding("Alt-Enter")).toEqual({ ctrl: false, alt: true, shift: false, key: "Enter" });
    expect(parseBinding("esc")).toEqual({ ctrl: false, alt: false, shift: false, key: "Escape" });
  });

  it("treats backtab as Shift+Tab", () => {
    expect(parseBinding("backtab")).toEqual({ ctrl: false, alt: false, shift: true, key: "Tab" });
    expect(parseBinding("Shift-Tab")).toEqual({ ctrl: false, alt: false, shift: true, key: "Tab" });
  });

  it("parses function keys", () => {
    expect(parseBinding("F5")).toEqual({ ctrl: false, alt: false, shift: false, key: "F5" });
    expect(parseBinding("Ctrl-F12")).toEqual({ ctrl: true, alt: false, shift: false, key: "F12" });
  });

  it("stacks modifiers case-insensitively", () => {
    expect(parseBinding("ctrl-alt-delete")).toEqual({
      ctrl: true,
      alt: true,
      shift: false,
      key: "Delete",
    });
  });

  it("keeps shift null for a shifted single char", () => {
    expect(parseBinding("Ctrl-Shift-N")).toEqual({ ctrl: true, alt: false, shift: null, key: "N" });
    expect(parseBinding("?")).toEqual({ ctrl: false, alt: false, shift: null, key: "?" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseBinding("  Ctrl-c  ")).toEqual({ ctrl: true, alt: false, shift: null, key: "c" });
  });

  it("returns null for an unparseable multi-char key", () => {
    expect(parseBinding("foo")).toBeNull();
  });
});

describe("formatBinding", () => {
  it("renders modifiers as glyphs in ⌃⌥⇧ order", () => {
    expect(formatBinding("Ctrl-c")).toBe("⌃C");
    expect(formatBinding("Alt-r")).toBe("⌥R");
    expect(formatBinding("ctrl-alt-delete")).toBe("⌃⌥⌦");
  });

  it("shows ⇧ only for named keys, not shifted single chars", () => {
    expect(formatBinding("Shift-Tab")).toBe("⇧⇥");
    expect(formatBinding("?")).toBe("?");
    expect(formatBinding("Ctrl-Shift-N")).toBe("⌃N");
  });

  it("maps named keys to glyphs", () => {
    expect(formatBinding("Ctrl-Enter")).toBe("⌃↵");
    expect(formatBinding("esc")).toBe("⎋");
    expect(formatBinding("Alt-up")).toBe("⌥↑");
  });

  it("passes function keys through", () => {
    expect(formatBinding("Ctrl-F12")).toBe("⌃F12");
  });

  it("returns null for an unparseable binding", () => {
    expect(formatBinding("foo")).toBeNull();
  });
});

describe("matches", () => {
  const ctrlC = parseBinding("Ctrl-c") as ParsedBinding;
  const shiftTab = parseBinding("Shift-Tab") as ParsedBinding;

  it("matches modifiers and key", () => {
    expect(matches(ctrlC, ev("c", { ctrlKey: true }))).toBe(true);
  });

  it("ignores the shift bit for single-char bindings", () => {
    expect(matches(ctrlC, ev("c", { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("enforces the shift bit for named bindings", () => {
    expect(matches(shiftTab, ev("Tab", { shiftKey: true }))).toBe(true);
    expect(matches(shiftTab, ev("Tab", { shiftKey: false }))).toBe(false);
  });

  it("never matches when meta is held", () => {
    expect(matches(ctrlC, ev("c", { ctrlKey: true, metaKey: true }))).toBe(false);
  });

  it("requires ctrl/alt to match exactly", () => {
    expect(matches(ctrlC, ev("c", { ctrlKey: false }))).toBe(false);
    expect(matches(ctrlC, ev("c", { ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("requires the key to match", () => {
    expect(matches(ctrlC, ev("x", { ctrlKey: true }))).toBe(false);
  });
});
