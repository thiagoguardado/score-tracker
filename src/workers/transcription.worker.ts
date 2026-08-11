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
  | { type: "transcribe"; id: number; audio: Float32Array; sampleRate: number; language: "en" | "pt"; kind: "partial" | "final"; preferredPhrases?: string[] };

let transcriberPromise: ReturnType<typeof createPreferredTranscriber> | undefined;
type QueuedRequest = Extract<Request, { type: "transcribe" }>;
const inferenceQueue: QueuedRequest[] = [];
let inferenceRunning = false;
let activeDevice: Device = "wasm";
let readyAnnounced = false;
let preferWebGpu = false;

type WhisperTokenizer = (text: string, options?: { add_special_tokens?: boolean }) => {
  input_ids?: { tolist?: () => number[][] } | number[][];
};

type WhisperPipeline = ((audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>) & {
  tokenizer?: WhisperTokenizer;
};

function promptIdsFor(transcriber: WhisperPipeline, phrases: string[], language: "en" | "pt"): number[] | undefined {
  if (phrases.length === 0 || !transcriber.tokenizer) return undefined;
  const prompt = language === "pt"
    ? `Os nomes dos jogadores são: ${phrases.join(", ")}.`
    : `The player names are: ${phrases.join(", ")}.`;
  try {
    const encoded = transcriber.tokenizer(prompt, { add_special_tokens: false });
    const ids = encoded.input_ids;
    if (!ids) return undefined;
    const values = Array.isArray(ids) ? ids[0] : ids.tolist?.()?.[0];
    return Array.isArray(values) ? values.map(Number) : undefined;
  } catch {
    return undefined;
  }
}

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
        const transcriber = await getTranscriber() as WhisperPipeline;
        const audio = resamplePcm(request.audio, request.sampleRate);
        const output = await transcriber(audio, {
          language: request.language === "pt" ? "portuguese" : "english",
          task: "transcribe",
          condition_on_prev_tokens: false,
          // Keep the live preview cheap, but give the final command a small
          // beam-search budget so names and short Portuguese phrases are less
          // likely to collapse into phonetic guesses.
          num_beams: request.kind === "final" ? 3 : 1,
          do_sample: false,
          return_timestamps: false,
          max_new_tokens: 64,
          prompt_ids: promptIdsFor(transcriber, request.preferredPhrases ?? [], request.language),
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
