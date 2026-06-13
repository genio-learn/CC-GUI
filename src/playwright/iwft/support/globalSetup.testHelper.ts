// Bundle the page-side TauriSimulator (which imports @tauri-apps/api) into a
// single IIFE once per run. addInitScript needs self-contained JS — it can't
// resolve bare ESM imports in the page — so esbuild inlines the Tauri mocks.

import { build } from "esbuild";
import { SIMULATOR_BUNDLE, SIMULATOR_ENTRY } from "./paths.testHelper";

export default async function globalSetup(): Promise<void> {
  await build({
    entryPoints: [SIMULATOR_ENTRY],
    outfile: SIMULATOR_BUNDLE,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2021",
    logLevel: "warning",
  });
}
