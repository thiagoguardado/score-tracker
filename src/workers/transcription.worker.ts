/// <reference lib="webworker" />

import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/whisper-tiny";
env.useBrowserCache = true;

type Request =
  | { type: "load" }
  | { type: "transcribe"; id: number; audio: Float32Array; language: "en" | "pt" };

let transcriberPromise: ReturnType<typeof createTranscriber> | undefined;
let inferenceQueue: Promise<void> = Promise.resolve();
let readyAnnounced = false;

async function createTranscriber() {
  return pipeline("automatic-speech-recognition", MODEL_ID, {
    device: "wasm",
    dtype: "q8",
    progress_callback: (progress: unknown) => self.postMessage({ type: "progress", progress }),
  });
}

async function getTranscriber() {
  transcriberPromise ??= createTranscriber();
  try {
    const transcriber = await transcriberPromise;
    if (!readyAnnounced) {
      readyAnnounced = true;
      self.postMessage({ type: "ready" });
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
    if (event.data.type === "load") {
      await getTranscriber();
      return;
    }

    const request = event.data;
    inferenceQueue = inferenceQueue.then(async () => {
      const transcriber = await getTranscriber();
      const output = await transcriber(request.audio, {
        language: request.language === "pt" ? "portuguese" : "english",
        task: "transcribe",
      });
      const text = Array.isArray(output) ? output.map((item) => item.text).join(" ") : output.text;
      self.postMessage({ type: "result", id: request.id, text: text.trim() });
    }).catch((error) => {
      self.postMessage({
        type: "error",
        id: request.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      id: event.data.type === "transcribe" ? event.data.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export {};
