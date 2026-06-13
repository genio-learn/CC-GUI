import { defineConfig } from "vitest/config";

// Layer 1 unit tests (see plans/testing.md). jsdom gives the few DOM-touching
// pure helpers (theme localStorage/matchMedia, palette's import-time overlay) a
// document to load against; the logic under test stays DOM-free.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
