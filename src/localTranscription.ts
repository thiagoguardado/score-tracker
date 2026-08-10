import { useEffect, useSyncExternalStore } from "react";
import type { Locale } from "./i18n";
import type { TranscriptionKind } from "./voice/SpeechEngine";
import TranscriptionWorker from "./workers/transcription.worker?worker";

export type VoiceModelStatus = {
  phase: "idle" | "downloading" | "initializing" | "ready" | "transcribing" | "error";
  progress: number;
  loaded: number;
  total: number;
  offlineReady: boolean;
  device?: "webgpu" | "wasm";
  error?: string;
};

type PendingRequest = {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  kind: TranscriptionKind;
};

let status: VoiceModelStatus = { phase: "idle", progress: 0, loaded: 0, total: 0, offlineReady: false };
const subscribers = new Set<() => void>();
const pending = new Map<number, PendingRequest>();
let nextRequestId = 1;
let worker: Worker | undefined;
let cacheChecked = false;
let initializationTimer: number | undefined;

function clearInitializationTimer(): void {
  window.clearTimeout(initializationTimer);
  initializationTimer = undefined;
}

function armInitializationTimer(): void {
  if (initializationTimer !== undefined) return;
  initializationTimer = window.setTimeout(() => {
    initializationTimer = undefined;
    if (status.phase !== "initializing") return;
    if (status.device === "webgpu") {
      destroyWorker();
      publish({ phase: "initializing", progress: 100, loaded: status.loaded, total: status.total, offlineReady: false, device: "wasm" });
      getWorker().postMessage({ type: "load", preferWebGpu: false });
      return;
    }
    destroyWorker();
    publish({ ...status, phase: "error", error: "voice-engine-initialization-timed-out" });
  }, 60_000);
}

function publish(next: VoiceModelStatus) {
  status = next;
  subscribers.forEach((subscriber) => subscriber());
}

function rejectPending(error: Error): void {
  pending.forEach(({ reject }) => reject(error));
  pending.clear();
}

function destroyWorker(): void {
  worker?.terminate();
  worker = undefined;
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new TranscriptionWorker();
  worker.addEventListener("message", (event: MessageEvent) => {
    const message = event.data;
    if (message.type === "progress") {
      const progress = message.progress;
      if (progress?.status === "progress_total") {
        const percent = Math.min(100, Number(progress.progress) || 0);
        publish({
          ...status,
          phase: percent >= 99.9 ? "initializing" : "downloading",
          progress: percent,
          loaded: Number(progress.loaded) || status.loaded,
          total: Number(progress.total) || status.total,
          error: undefined,
        });
        if (percent >= 99.9) armInitializationTimer();
      } else if (status.phase === "idle" || status.phase === "error") {
        publish({ ...status, phase: "downloading", progress: 0, loaded: 0, total: 0, error: undefined });
      }
      return;
    }
    if (message.type === "initializing") {
      publish({ ...status, phase: "initializing", progress: 100, device: message.device });
      return;
    }
    if (message.type === "attempt") {
      publish({ ...status, device: message.device });
      return;
    }
    if (message.type === "fallback") {
      clearInitializationTimer();
      publish({ ...status, phase: "initializing", device: "wasm", error: undefined });
      return;
    }
    if (message.type === "cache-found") {
      if (status.phase === "idle") prepareVoiceModel();
      return;
    }
    if (message.type === "ready") {
      clearInitializationTimer();
      publish({
        ...status,
        phase: "ready",
        progress: 100,
        offlineReady: Boolean(message.offlineReady),
        device: message.device,
        error: undefined,
      });
      if (message.offlineReady) void navigator.storage?.persist?.();
      return;
    }
    if (message.type === "result") {
      pending.get(message.id)?.resolve(message.text);
      pending.delete(message.id);
      publish({ ...status, phase: pending.size > 0 ? "transcribing" : "ready" });
      return;
    }
    if (message.type === "error") {
      clearInitializationTimer();
      const error = new Error(message.message || "local-transcription-error");
      if (message.id !== undefined) {
        pending.get(message.id)?.reject(error);
        pending.delete(message.id);
      } else {
        rejectPending(error);
      }
      publish({ ...status, phase: "error", error: error.message });
    }
  });
  worker.addEventListener("error", (event) => {
    clearInitializationTimer();
    const error = new Error(event.message || "worker-error");
    rejectPending(error);
    publish({ ...status, phase: "error", error: error.message });
  });
  return worker;
}

export function prepareVoiceModel(): void {
  if (status.phase === "ready" || status.phase === "downloading" || status.phase === "initializing" || status.phase === "transcribing") return;
  if (status.phase === "error") destroyWorker();
  publish({ phase: "downloading", progress: 0, loaded: 0, total: 0, offlineReady: false });
  const preferWebGpu = "gpu" in navigator && Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
  getWorker().postMessage({ type: "load", preferWebGpu });
}

export function transcribeLocally(
  audio: Float32Array,
  sampleRate: number,
  locale: Locale,
  kind: TranscriptionKind = "final",
): Promise<string> {
  const id = nextRequestId++;
  publish({ ...status, phase: "transcribing" });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, kind });
    getWorker().postMessage({
      type: "transcribe",
      id,
      audio,
      sampleRate,
      language: locale === "pt-BR" ? "pt" : "en",
      kind,
    }, [audio.buffer]);
  });
}

export function useVoiceModel(): VoiceModelStatus {
  useEffect(() => {
    if (cacheChecked || status.phase !== "idle") return;
    cacheChecked = true;
    getWorker().postMessage({ type: "check-cache" });
  }, []);
  return useSyncExternalStore(
    (subscriber) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
    () => status,
    () => status,
  );
}
