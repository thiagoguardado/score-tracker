import { useEffect, useSyncExternalStore } from "react";
import type { Locale } from "./i18n";
import TranscriptionWorker from "./workers/transcription.worker?worker";

export type VoiceModelStatus = {
  phase: "idle" | "downloading" | "ready" | "transcribing" | "error";
  progress: number;
  loaded: number;
  total: number;
  error?: string;
};

let status: VoiceModelStatus = { phase: "idle", progress: 0, loaded: 0, total: 0 };
const subscribers = new Set<() => void>();
const pending = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
let nextRequestId = 1;
let worker: Worker | undefined;
const REQUIRED_MODEL_FILES = [
  "https://huggingface.co/onnx-community/whisper-tiny/resolve/main/onnx/encoder_model_quantized.onnx",
  "https://huggingface.co/onnx-community/whisper-tiny/resolve/main/onnx/decoder_model_merged_quantized.onnx",
];

function publish(next: VoiceModelStatus) {
  status = next;
  subscribers.forEach((subscriber) => subscriber());
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new TranscriptionWorker();
  worker.addEventListener("message", (event: MessageEvent) => {
    const message = event.data;
    if (message.type === "progress") {
      const progress = message.progress;
      if (progress?.status === "progress_total") {
        publish({
          phase: "downloading",
          progress: Number(progress.progress) || 0,
          loaded: Number(progress.loaded) || status.loaded,
          total: Number(progress.total) || status.total,
        });
      } else if (status.phase === "idle" || status.phase === "error") {
        publish({ phase: "downloading", progress: 0, loaded: 0, total: 0 });
      }
      return;
    }
    if (message.type === "ready") {
      publish({ ...status, phase: "ready", progress: 100 });
      void navigator.storage?.persist?.();
      return;
    }
    if (message.type === "result") {
      pending.get(message.id)?.resolve(message.text);
      pending.delete(message.id);
      publish({ ...status, phase: pending.size > 0 ? "transcribing" : "ready" });
      return;
    }
    if (message.type === "error") {
      const error = new Error(message.message || "local-transcription-error");
      if (message.id !== undefined) {
        pending.get(message.id)?.reject(error);
        pending.delete(message.id);
      }
      publish({ ...status, phase: "error", error: error.message });
    }
  });
  worker.addEventListener("error", (event) => {
    publish({ ...status, phase: "error", error: event.message || "worker-error" });
  });
  return worker;
}

export function prepareVoiceModel(): void {
  if (status.phase === "ready" || status.phase === "downloading" || status.phase === "transcribing") return;
  publish({ phase: "downloading", progress: 0, loaded: 0, total: 0 });
  getWorker().postMessage({ type: "load" });
}

export function transcribeLocally(audio: Float32Array, locale: Locale): Promise<string> {
  const id = nextRequestId++;
  publish({ ...status, phase: "transcribing" });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: "transcribe", id, audio, language: locale === "pt-BR" ? "pt" : "en" }, [audio.buffer]);
  });
}

export function useVoiceModel(): VoiceModelStatus {
  useEffect(() => {
    if (!("caches" in window) || status.phase !== "idle") return;
    void Promise.all(REQUIRED_MODEL_FILES.map((url) => caches.match(url))).then((matches) => {
      if (matches.every(Boolean)) prepareVoiceModel();
    });
  }, []);
  return useSyncExternalStore(
    (subscriber) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
    () => status,
    () => status,
  );
}
