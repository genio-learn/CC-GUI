import { test, expect } from "../../support/fixture.testHelper";
import { makeSnapshot } from "../../network/seed.testHelper";

// One config covering every field kind the modal renders.
test.use({
  seed: {
    snapshot: makeSnapshot(),
    reviews: {},
    config: {
      autoStart: true,
      maxAgents: 4,
      model: "claude",
      extraArgs: ["--verbose"],
      note: null,
    },
  },
});

test("renders a typed control per config kind", async ({ settings }) => {
  await settings.open();

  expect(await settings.fieldKind("autoStart")).toBe("bool");
  expect(await settings.fieldInputType("autoStart")).toBe("checkbox");

  expect(await settings.fieldKind("maxAgents")).toBe("number");
  expect(await settings.fieldInputType("maxAgents")).toBe("number");

  expect(await settings.fieldKind("model")).toBe("string");
  expect(await settings.fieldKind("note")).toBe("nullable");

  expect(await settings.fieldKind("extraArgs")).toBe("json");
  expect(await settings.fieldTag("extraArgs")).toBe("textarea");
});

test("invalid JSON aborts the save (toast, modal stays open, nothing persisted)", async ({
  settings,
}) => {
  await settings.open();
  await settings.setText("extraArgs", "not json [");
  await settings.saveExpectingError();

  expect(await settings.savedConfig()).toBeNull();
});

test("valid edits round-trip through save_config", async ({ settings }) => {
  await settings.open();
  await settings.setText("model", "claude-opus");
  await settings.setChecked("autoStart", false);
  await settings.setText("note", "hello");
  await settings.save();

  expect(await settings.savedConfig()).toEqual({
    autoStart: false,
    maxAgents: 4, // untouched
    model: "claude-opus",
    extraArgs: ["--verbose"], // untouched JSON field re-parses to its value
    note: "hello", // nullable text, now set
  });
});

// NB: the data-kind="number" branch's NaN→toast path is unreachable from the UI —
// <input type=number> sanitizes non-numeric input, so collect() never sees NaN.
// Invalid-number abort is therefore not exercised here (it can't happen in-browser).

test.describe("telemetry opt-out", () => {
  test.use({
    seed: {
      snapshot: makeSnapshot(),
      reviews: {},
      config: { telemetry: { enabled: true, endpoint: null, token: null } },
    },
  });

  test("renders a checkbox; opting out persists enabled:false and keeps endpoint/token", async ({
    settings,
  }) => {
    await settings.open();

    // The telemetry object surfaces as a friendly checkbox, not a JSON blob.
    expect(await settings.fieldKind("telemetry")).toBe("telemetry-enabled");
    expect(await settings.fieldInputType("telemetry")).toBe("checkbox");

    await settings.setChecked("telemetry", false);
    await settings.save();

    expect(await settings.savedConfig()).toEqual({
      telemetry: { enabled: false, endpoint: null, token: null },
    });
  });
});
