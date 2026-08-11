import { useSyncExternalStore } from "react";
import type { Locale } from "../i18n";
import type { SpeechEngine } from "./SpeechEngine";

const FRAME_STALL_MS = 1_200;
const NO_VOICE_MS = 3_000;
const SILENCE_RMS = 0.0025;
const LOG_KEY = "score-tracker:voice-log:v1";

export type CapturePhase = "disconnected" | "connecting" | "ready" | "listening" | "interrupted";

export type CaptureHealth = {
  phase: CapturePhase;
  rms: number;
  peak: number;
  framesReceived: number;
  samplesReceived: number;
  lastFrameAt: number;
  trackState: MediaStreamTrackState | "none";
  trackMuted: boolean;
  contextState: AudioContextState | "none";
  problem?: "microphone-interrupted" | "pcm-stalled" | "no-voice";
};

type WorkletMessage =
  | { type: "ready"; sampleRate: number }
  | { type: "health"; framesReceived: number; samplesReceived: number; rms: number; peak: number }
  | { type: "pcm"; captureId: number; audio: Float32Array }
  | { type: "flushed"; captureId: number };

type ActiveUtterance = {
  id: number;
  locale: Locale;
  preferredPhrases: string[];
  chunks: Float32Array[];
  sampleCount: number;
  startedAt: number;
  maxRms: number;
  timeout?: number;
  watchdog?: number;
  onCaptureStart?: () => void;
  onVolume?: (level: number) => void;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  finishRequested: boolean;
  gateOpened: boolean;
  settled: boolean;
};

type CaptureFailureFactory = (code: string, detail?: string) => Error;

const initialHealth: CaptureHealth = {
  phase: "disconnected",
  rms: 0,
  peak: 0,
  framesReceived: 0,
  samplesReceived: 0,
  lastFrameAt: 0,
  trackState: "none",
  trackMuted: false,
  contextState: "none",
};

function normalizedVolume(rms: number): number {
  return Math.min(1, Math.max(0, (rms - 0.004) / 0.12));
}

function mergeChunks(chunks: Float32Array[], sampleCount: number): Float32Array {
  const merged = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function trimSilence(audio: Float32Array, sampleRate: number): Float32Array {
  if (audio.length < sampleRate * 0.25) return audio;
  let peak = 0;
  for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
  const threshold = Math.max(0.004, peak * 0.08);
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.02));
  let first = 0;
  let last = audio.length;
  for (let offset = 0; offset < audio.length; offset += frameSize) {
    let framePeak = 0;
    for (let index = offset; index < Math.min(audio.length, offset + frameSize); index += 1) framePeak = Math.max(framePeak, Math.abs(audio[index]));
    if (framePeak >= threshold) { first = Math.max(0, offset - sampleRate * 0.18); break; }
  }
  for (let offset = audio.length - frameSize; offset >= 0; offset -= frameSize) {
    let framePeak = 0;
    for (let index = Math.max(0, offset); index < Math.min(audio.length, offset + frameSize); index += 1) framePeak = Math.max(framePeak, Math.abs(audio[index]));
    if (framePeak >= threshold) { last = Math.min(audio.length, offset + frameSize + sampleRate * 0.18); break; }
  }
  return first === 0 && last === audio.length ? audio : audio.slice(first, last);
}

export class AudioWorkletCapture {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private connectPromise?: Promise<void>;
  private sampleRate = 48_000;
  private nextCaptureId = 1;
  private active?: ActiveUtterance;
  private health: CaptureHealth = initialHealth;
  private subscribers = new Set<() => void>();
  private backgrounded = false;
  private disposing = false;
  private failureFactory: CaptureFailureFactory = (code, detail = "") => Object.assign(new Error(code), { code, detail });

  private readonly engine: SpeechEngine;

  constructor(engine: SpeechEngine) {
    this.engine = engine;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  setFailureFactory(factory: CaptureFailureFactory): void {
    this.failureFactory = factory;
  }

  getSnapshot = (): CaptureHealth => this.health;

  subscribe = (subscriber: () => void): (() => void) => {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  };

  private publish(next: Partial<CaptureHealth>): void {
    this.health = { ...this.health, ...next };
    this.subscribers.forEach((subscriber) => subscriber());
  }

  private log(event: string, detail: Record<string, unknown> = {}): void {
    if (typeof localStorage === "undefined") return;
    try {
      const previous = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]") as unknown[];
      localStorage.setItem(LOG_KEY, JSON.stringify([...previous.slice(-79), { at: new Date().toISOString(), event, ...detail }]));
    } catch {
      // Diagnostics must never prevent voice capture.
    }
  }

  private updateDeviceHealth(next: Partial<CaptureHealth> = {}): void {
    const track = this.stream?.getAudioTracks()[0];
    this.publish({
      trackState: track?.readyState ?? "none",
      trackMuted: track?.muted ?? false,
      contextState: this.context?.state ?? "none",
      ...next,
    });
  }

  private interruptPipeline(detail: string): void {
    if (this.disposing) return;
    this.updateDeviceHealth({ phase: "interrupted", problem: "microphone-interrupted", rms: 0 });
    if (this.active) this.settleFailure(this.active, this.failureFactory("microphone-interrupted", detail));
  }

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.backgrounded = true;
      this.log("visibility-hidden");
      if (this.active) this.cancel(this.failureFactory("aborted", "page-hidden"));
      return;
    }
    this.log("visibility-visible", { context: this.context?.state, track: this.stream?.getAudioTracks()[0]?.readyState });
    this.updateDeviceHealth({
      phase: this.stream ? "interrupted" : "disconnected",
      problem: this.stream ? "microphone-interrupted" : undefined,
    });
  };

  private workletUrl(): string {
    return `${import.meta.env.BASE_URL}audio-capture.worklet.js`;
  }

  private async waitForFrames(previousCount: number, timeoutMs = 1_500): Promise<boolean> {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      if (this.health.framesReceived > previousCount && performance.now() - this.health.lastFrameAt < 500) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    }
    return false;
  }

  private isPipelineHealthy(): boolean {
    const track = this.stream?.getAudioTracks()[0];
    return Boolean(
      track?.readyState === "live"
      && !track.muted
      && this.context?.state === "running"
      && this.health.lastFrameAt > 0
      && performance.now() - this.health.lastFrameAt < FRAME_STALL_MS,
    );
  }

  private async createPipeline(): Promise<void> {
    this.publish({ phase: "connecting", problem: undefined, rms: 0, peak: 0 });
    this.log("pipeline-connect-start");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (error) {
      throw this.failureFactory("audio-capture", error instanceof Error ? error.message : String(error));
    }
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw this.failureFactory("audio-capture", "no-audio-track");
    }

    this.stream = stream;
    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    await context.audioWorklet.addModule(this.workletUrl());
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "score-tracker-audio-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    source.connect(node).connect(silentOutput).connect(context.destination);

    this.node = node;
    this.sampleRate = context.sampleRate;
    node.port.onmessage = (event: MessageEvent<WorkletMessage>) => this.handleWorkletMessage(event.data);
    track.addEventListener("mute", () => {
      this.log("track-muted");
      this.interruptPipeline("track-muted");
    });
    track.addEventListener("unmute", () => {
      this.log("track-unmuted");
      this.updateDeviceHealth({ problem: undefined });
    });
    track.addEventListener("ended", () => {
      this.log("track-ended");
      this.interruptPipeline("track-ended");
    });
    context.addEventListener("statechange", () => {
      this.log("context-state", { state: context.state });
      if (context.state === "running") this.updateDeviceHealth();
      else if (this.context === context) this.interruptPipeline(`context-${context.state}`);
    });

    if (context.state === "suspended") await context.resume();
    const previousFrames = this.health.framesReceived;
    if (!await this.waitForFrames(previousFrames)) {
      throw this.failureFactory("pcm-stalled", "worklet-produced-no-frames");
    }
    this.backgrounded = false;
    this.updateDeviceHealth({ phase: "ready", problem: undefined });
    this.log("pipeline-ready", { sampleRate: context.sampleRate });
  }

  private async ensurePipeline(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
      throw this.failureFactory("unavailable");
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      if (this.context?.state === "suspended") {
        try { await this.context.resume(); } catch { /* Reconnect below. */ }
      }
      if (!this.backgrounded && this.isPipelineHealthy()) {
        this.updateDeviceHealth({ phase: "ready", problem: undefined });
        return;
      }

      if (this.stream || this.context) await this.disposePipeline();
      try {
        await this.createPipeline();
      } catch (firstError) {
        this.log("pipeline-connect-failed", { error: firstError instanceof Error ? firstError.message : String(firstError) });
        await this.disposePipeline();
        throw firstError;
      }
    })().finally(() => { this.connectPromise = undefined; });
    return this.connectPromise;
  }

  private handleWorkletMessage(message: WorkletMessage): void {
    if (message.type === "ready") {
      this.sampleRate = message.sampleRate;
      return;
    }
    if (message.type === "health") {
      const now = performance.now();
      const level = normalizedVolume(message.rms);
      if (this.active) {
        this.active.maxRms = Math.max(this.active.maxRms, message.rms);
        this.active.onVolume?.(level);
      }
      this.updateDeviceHealth({
        framesReceived: message.framesReceived,
        samplesReceived: message.samplesReceived,
        lastFrameAt: now,
        rms: level,
        peak: message.peak,
        phase: this.active?.gateOpened ? "listening" : "ready",
        problem: this.active && this.active.maxRms < SILENCE_RMS ? this.health.problem : undefined,
      });
      return;
    }
    if (message.type === "pcm") {
      if (this.active?.id !== message.captureId || this.active.settled) return;
      this.active.chunks.push(message.audio);
      this.active.sampleCount += message.audio.length;
      return;
    }
    if (message.type === "flushed" && this.active?.id === message.captureId) {
      void this.finalize(this.active);
    }
  }

  private startWatchdog(utterance: ActiveUtterance): void {
    utterance.watchdog = window.setInterval(() => {
      if (utterance.settled) return;
      const elapsed = performance.now() - utterance.startedAt;
      if (performance.now() - this.health.lastFrameAt > FRAME_STALL_MS) {
        this.publish({ phase: "interrupted", problem: "pcm-stalled" });
        this.log("pcm-stalled", { elapsed });
        this.settleFailure(utterance, this.failureFactory("pcm-stalled", "no-recent-pcm-frames"));
      } else if (elapsed > NO_VOICE_MS && utterance.maxRms < SILENCE_RMS) {
        this.publish({ phase: "listening", problem: "no-voice" });
      }
    }, 300);
  }

  private clearUtteranceTimers(utterance: ActiveUtterance): void {
    window.clearTimeout(utterance.timeout);
    window.clearInterval(utterance.watchdog);
  }

  private settleFailure(utterance: ActiveUtterance, error: Error): void {
    if (utterance.settled) return;
    utterance.settled = true;
    this.clearUtteranceTimers(utterance);
    utterance.onVolume?.(0);
    if (this.active?.id === utterance.id) this.active = undefined;
    this.updateDeviceHealth({ phase: this.isPipelineHealthy() ? "ready" : "interrupted", rms: 0 });
    utterance.reject(error);
  }

  private async finalize(utterance: ActiveUtterance): Promise<void> {
    if (utterance.settled) return;
    this.clearUtteranceTimers(utterance);
    utterance.onVolume?.(0);
    if (utterance.sampleCount === 0 || utterance.maxRms < SILENCE_RMS) {
      this.settleFailure(utterance, this.failureFactory("no-speech"));
      return;
    }

    try {
      const audio = trimSilence(mergeChunks(utterance.chunks, utterance.sampleCount), this.sampleRate);
      const startedAt = performance.now();
      const text = await this.engine.transcribe({ audio, sampleRate: this.sampleRate, locale: utterance.locale, kind: "final", preferredPhrases: utterance.preferredPhrases });
      if (utterance.settled) return;
      utterance.settled = true;
      if (this.active?.id === utterance.id) this.active = undefined;
      this.updateDeviceHealth({ phase: "ready", problem: undefined, rms: 0 });
      this.log("transcription-complete", { durationMs: Math.round(performance.now() - startedAt), samples: utterance.sampleCount });
      if (text.trim()) utterance.resolve(text.trim());
      else utterance.reject(this.failureFactory("no-speech"));
    } catch (error) {
      this.settleFailure(utterance, error instanceof Error ? error : new Error(String(error)));
    }
  }

  async listen(
    locale: Locale,
    timeoutMs: number,
    preferredPhrases: string[] = [],
    onCaptureStart?: () => void,
    onVolume?: (level: number) => void,
    _onInterim?: (text: string) => void,
  ): Promise<string> {
    if (this.active) {
      const previous = this.active;
      this.cancel(this.failureFactory("aborted"));
      while (!previous.settled) await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    return new Promise((resolve, reject) => {
      const utterance: ActiveUtterance = {
        id: this.nextCaptureId++, locale, preferredPhrases, chunks: [], sampleCount: 0, startedAt: performance.now(), maxRms: 0,
        onCaptureStart, onVolume, resolve, reject, finishRequested: false, gateOpened: false, settled: false,
      };
      this.active = utterance;

      void this.ensurePipeline().then(() => {
        if (utterance.settled) return;
        utterance.startedAt = performance.now();
        utterance.gateOpened = true;
        this.node?.port.postMessage({ type: "gate", open: true, captureId: utterance.id });
        this.updateDeviceHealth({ phase: "listening", problem: undefined, rms: 0 });
        utterance.onCaptureStart?.();
        this.startWatchdog(utterance);
        utterance.timeout = window.setTimeout(() => this.finish(), timeoutMs);
        this.log("ptt-open", { captureId: utterance.id });
        if (utterance.finishRequested) this.finish();
      }).catch((error) => this.settleFailure(utterance, error instanceof Error ? error : new Error(String(error))));
    });
  }

  finish(): void {
    const utterance = this.active;
    if (!utterance || utterance.settled) return;
    if (!this.node || !utterance.gateOpened) {
      utterance.finishRequested = true;
      return;
    }
    utterance.gateOpened = false;
    this.node.port.postMessage({ type: "gate", open: false, captureId: utterance.id });
    this.log("ptt-close", { captureId: utterance.id });
  }

  cancel(error: Error): void {
    const utterance = this.active;
    if (!utterance) return;
    if (utterance.gateOpened) this.node?.port.postMessage({ type: "gate", open: false, captureId: utterance.id });
    utterance.gateOpened = false;
    this.settleFailure(utterance, error);
  }

  pauseGateForOutput(): void {
    if (this.active) this.cancel(this.failureFactory("aborted", "speech-output"));
  }

  async disposePipeline(): Promise<void> {
    this.disposing = true;
    const stream = this.stream;
    const context = this.context;
    this.stream = undefined;
    this.context = undefined;
    this.node = undefined;
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed") {
      try { await context.close(); } catch { /* The browser may already have discarded it. */ }
    }
    this.disposing = false;
    this.health = initialHealth;
    this.subscribers.forEach((subscriber) => subscriber());
    this.log("pipeline-disposed");
  }
}

export function useCaptureHealth(capture: AudioWorkletCapture): CaptureHealth {
  return useSyncExternalStore(capture.subscribe, capture.getSnapshot, capture.getSnapshot);
}
