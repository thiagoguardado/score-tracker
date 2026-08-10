import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const workerState = vi.hoisted(() => ({ instances: [] as Array<EventTarget & { messages: unknown[] }> }));

vi.mock("./workers/transcription.worker?worker", () => ({
  default: class FakeWorker extends EventTarget {
    messages: unknown[] = [];
    constructor() {
      super();
      workerState.instances.push(this);
    }
    postMessage(message: unknown) { this.messages.push(message); }
  },
}));

import { prepareVoiceModel, transcribeLocally, useVoiceModel } from "./localTranscription";

function emit(data: unknown) {
  workerState.instances[0]?.dispatchEvent(new MessageEvent("message", { data }));
}

it("reports model progress and sends the current app language with each local transcription", async () => {
  const { result } = renderHook(() => useVoiceModel());
  act(() => prepareVoiceModel());
  const worker = workerState.instances[0];
  expect(worker?.messages).toContainEqual({ type: "load", preferWebGpu: false });

  act(() => emit({ type: "progress", progress: { status: "progress_total", progress: 42, loaded: 21, total: 50 } }));
  expect(result.current).toMatchObject({ phase: "downloading", progress: 42, loaded: 21, total: 50 });
  act(() => emit({ type: "attempt", device: "wasm" }));
  act(() => emit({ type: "progress", progress: { status: "progress_total", progress: 100, loaded: 50, total: 50 } }));
  expect(result.current).toMatchObject({ phase: "initializing", progress: 100, device: "wasm" });
  act(() => emit({ type: "ready", device: "wasm", offlineReady: true }));
  expect(result.current).toMatchObject({ phase: "ready", device: "wasm", offlineReady: true });

  const portuguese = transcribeLocally(new Float32Array([0.1]), 16_000, "pt-BR");
  const portugueseMessage = worker?.messages.at(-1) as { id: number; language: string };
  expect(portugueseMessage.language).toBe("pt");
  expect(portugueseMessage).toMatchObject({ sampleRate: 16_000, kind: "final" });
  act(() => emit({ type: "result", id: portugueseMessage.id, text: "Mário cinco" }));
  await expect(portuguese).resolves.toBe("Mário cinco");

  const english = transcribeLocally(new Float32Array([0.1]), 16_000, "en");
  const englishMessage = worker?.messages.at(-1) as { id: number; language: string };
  expect(englishMessage.language).toBe("en");
  act(() => emit({ type: "result", id: englishMessage.id, text: "Mario five" }));
  await expect(english).resolves.toBe("Mario five");
  await waitFor(() => expect(result.current.phase).toBe("ready"));
});
