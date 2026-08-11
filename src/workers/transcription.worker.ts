/// <reference lib="webworker" />

import { env, ModelRegistry, pipeline } from "@huggingface/transformers";
import { resamplePcm } from "../voice/resample";

// Base is a modestly larger multilingual model but is substantially more
// reliable for names and numbers than tiny. With q8 weights it remains a
// practical offline download for phones.
const MODEL_ID = "onnx-community/whisper-base";
const MODEL_DTYPE = "q8" as const;
env.useBrowserCache = true;
env.useWasmCache = true;

type Device = "webgpu" | "wasm";
type Request =
  | { type: "check-cache" }
  | { type: "load"; preferWebGpu: boolean }
  | { type: "transcribe"; id: number; audio: Float32Array; sampleRate: number; language: "en" | "pt"; kind: "partial" | "final" };

let transcriberPromise: ReturnType<typeof createPreferredTranscriber> | undefined;
type QueuedRequest = Extract<Request, { type: "transcribe" }>;
const inferenceQueue: QueuedRequest[] = [];
let inferenceRunning = false;
let activeDevice: Device = "wasm";
let readyAnnounced = false;
let preferWebGpu = false;

async function createTranscriber(device: Device) {
  activeDevice = device;
  self.postMessage({ type: "attempt", device });
  const instance = await pipeline("automatic-speech-recognition", MODEL_ID, {
    device,
    dtype: MODEL_DTYPE,
    progress_callback: (progress: unknown) => self.postMessage({ type: "progress", progress }),
  });
  self.postMessage({ type: "initializing", device });
  return instance;
}

async function createPreferredTranscriber() {
  if (preferWebGpu) {
    try {
      return await createTranscriber("webgpu");
    } catch (error) {
      self.postMessage({
        type: "fallback",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return createTranscriber("wasm");
}

async function verifyOfflineReady(): Promise<boolean> {
  try {
    return await ModelRegistry.is_pipeline_cached("automatic-speech-recognition", MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: activeDevice,
    });
  } catch {
    return false;
  }
}

async function getTranscriber() {
  transcriberPromise ??= createPreferredTranscriber();
  try {
    const transcriber = await transcriberPromise;
    if (!readyAnnounced) {
      readyAnnounced = true;
      self.postMessage({ type: "ready", device: activeDevice, offlineReady: await verifyOfflineReady() });
    }
    return transcriber;
  } catch (error) {
    transcriberPromise = undefined;
    readyAnnounced = false;
    throw error;
  }
}

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  try {
    if (event.data.type === "check-cache") {
      const cached = await ModelRegistry.is_pipeline_cached("automatic-speech-recognition", MODEL_ID, {
        dtype: MODEL_DTYPE,
        device: "wasm",
      }).catch(() => false);
      if (cached) self.postMessage({ type: "cache-found" });
      return;
    }
    if (event.data.type === "load") {
      preferWebGpu = event.data.preferWebGpu;
      await getTranscriber();
      return;
    }

    const request = event.data;
    // A final transcription is the only result that can change the game. Put
    // it ahead of queued, optional previews without dropping those previews
    // (their promises still need a result so they can settle cleanly).
    if (request.kind === "final") inferenceQueue.unshift(request);
    else inferenceQueue.push(request);
    void drainInferenceQueue();
  } catch (error) {
    self.postMessage({
      type: "error",
      id: event.data.type === "transcribe" ? event.data.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

async function drainInferenceQueue(): Promise<void> {
  if (inferenceRunning) return;
  inferenceRunning = true;
  try {
    while (inferenceQueue.length > 0) {
      const request = inferenceQueue.shift()!;
      try {
        const transcriber = await getTranscriber();
        const audio = resamplePcm(request.audio, request.sampleRate);
        const output = await transcriber(audio, {
          language: request.language === "pt" ? "portuguese" : "english",
          task: "transcribe",
          condition_on_prev_tokens: false,
          // The score parser needs short command phrases, not long-form
          // decoding. Greedy decoding is materially quicker on mobile WASM.
          num_beams: 1,
          do_sample: false,
          return_timestamps: false,
          max_new_tokens: 64,
        });
        const text = Array.isArray(output) ? output.map((item) => item.text).join(" ") : output.text;
        self.postMessage({ type: "result", id: request.id, kind: request.kind, text: text.trim() });
      } catch (error) {
        self.postMessage({
          type: "error",
          id: request.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    inferenceRunning = false;
    if (inferenceQueue.length > 0) void drainInferenceQueue();
  }
}

export {};
