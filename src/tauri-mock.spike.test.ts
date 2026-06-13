// PHASE-2 GATING SPIKE (see plans/testing.md): can @tauri-apps/api/mocks drive
// the full backend seam the CC-GUI frontend uses — invoke, pushed listen/emit
// events, and the PTY Channel byte stream — without a real Tauri runtime?
//
// This file is runnable evidence. It exercises the exact three mechanisms main.ts
// depends on. If these pass, the TauriSimulator can sit on top of mockIPC and we
// do NOT need to hand-roll a __TAURI_INTERNALS__ replacement.

import { describe, it, expect, afterEach } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";

afterEach(() => clearMocks());

describe("spike: mockIPC backend seam", () => {
  it("Q1 — routes invoke(cmd, args) to a handler (the get_groups snapshot read)", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "get_groups") return { groups: [{ repo_path: "/r", session_ids: [] }] };
      if (cmd === "save_config") return (args as { config: unknown }).config !== undefined;
      throw new Error(`unhandled ${cmd}`);
    });

    await expect(invoke("get_groups")).resolves.toEqual({
      groups: [{ repo_path: "/r", session_ids: [] }],
    });
    await expect(invoke("save_config", { config: {} })).resolves.toBe(true);
  });

  it("Q2 — delivers a pushed event to listen() via emit() (the sessions-updated path)", async () => {
    // shouldMockEvents wires plugin:event|listen / emit / unlisten.
    mockIPC(() => {}, { shouldMockEvents: true });

    const received: unknown[] = [];
    // mirrors main.ts: listen<Snapshot>("sessions-updated", (e) => applySnapshot(e.payload))
    const unlisten = await listen("sessions-updated", (e) => received.push(e.payload));

    // The simulator (here, the test) pushes the snapshot — the backend's role.
    await emit("sessions-updated", { groups: [], commander: null });
    await emit("sessions-updated", { groups: [{ repo_path: "/r", session_ids: ["s1"] }] });

    expect(received).toEqual([
      { groups: [], commander: null },
      { groups: [{ repo_path: "/r", session_ids: ["s1"] }] },
    ]);

    // unlisten stops further delivery
    await unlisten();
    await emit("sessions-updated", { groups: [] });
    expect(received).toHaveLength(2);
  });

  it("Q3 — streams bytes through a PTY Channel captured from invoke args (the attach path)", async () => {
    // Capture the Channel the app passes to attach, then push ordered byte chunks
    // exactly as the backend would (runCallback with {index, message}).
    let push: ((bytes: number[]) => void) | null = null;
    let nextIndex = 0;

    mockIPC((cmd, args) => {
      if (cmd === "attach") {
        const channel = (args as { onData: Channel<number[]> }).onData;
        // mockIPC does not serialize args, so onData is the real Channel instance;
        // its .id is registered in the mock's callback table.
        const internals = (window as unknown as {
          __TAURI_INTERNALS__: { runCallback: (id: number, msg: unknown) => void };
        }).__TAURI_INTERNALS__;
        push = (bytes) => internals.runCallback(channel.id, { index: nextIndex++, message: bytes });
        return;
      }
    });

    const chunks: number[][] = [];
    const channel = new Channel<number[]>();
    channel.onmessage = (m) => chunks.push(m);

    await invoke("attach", { tmuxSession: "demo", onData: channel });
    expect(push).not.toBeNull();

    push!([104, 105]); // "hi"
    push!([10]); // "\n"
    expect(chunks).toEqual([[104, 105], [10]]);
  });
});
