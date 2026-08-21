import { useSyncExternalStore } from "react";
import type { Locale } from "./i18n";

/**
 * Native Web Speech API implementation — iOS-hardened.
 *
 * Key design decisions (why iPhone previously failed):
 * - No competing getUserMedia/AudioContext stream. iOS Safari allows only one
 *   mic session at a time; the former volume-meter getUserMedia stole the mic
 *   from SpeechRecognition (orange dot missing, subsequent starts failing).
 *   Volume feedback is now synthetic.
 * - One fresh SpeechRecognition instance per user gesture, never reused.
 * - Full teardown with grace timers (750ms + 250ms) so the next start()
 *   never collides with a still-releasing session.
 * - Push-to-talk: start on pointerDown (user gesture), stop on pointerUp.
 * - No continuous loop without a new gesture — respects iOS gesture rule.
 */

type ActiveRecognitionSession = {
  recognition: SpeechRecognition;
  cancel: (error: Error) => void;
  finish: () => void;
  released: Promise<void>;
};

let activeRecognition: ActiveRecognitionSession | null = null;
let speakingResolve: (() => void) | null = null;

const RECOGNITION_RELEASE_GRACE_MS = 750;
const RECOGNITION_ABORT_GRACE_MS = 250;
const MAX_UTTERANCE_MS = 60_000;
const SYNTHESIS_RELEASE_GRACE_MS = 150;

// ── Health store (compat with previous CaptureHealth shape) ──────────────
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

let health: CaptureHealth = { ...initialHealth, phase: "ready" };
const healthSubscribers = new Set<() => void>();

function publishHealth(next: Partial<CaptureHealth>) {
  health = { ...health, ...next };
  healthSubscribers.forEach((s) => s());
}

function getHealthSnapshot(): CaptureHealth {
  return health;
}
function subscribeHealth(cb: () => void) {
  healthSubscribers.add(cb);
  return () => healthSubscribers.delete(cb);
}

// ── Errors ───────────────────────────────────────────────────────────────
export class SpeechRecognitionFailure extends Error {
  readonly code: string;
  readonly detail: string;
  constructor(code: string, detail = "") {
    super(code);
    this.name = "SpeechRecognitionFailure";
    this.code = code;
    this.detail = detail;
  }
}

export class SpeechCaptureFailure extends SpeechRecognitionFailure {
  constructor(code: string, detail = "") {
    super(code, detail);
    this.name = "SpeechCaptureFailure";
  }
}

export function getSpeechErrorCode(error: unknown): string {
  if (error instanceof SpeechRecognitionFailure) return error.code;
  if (error instanceof Error && error.message) return error.message;
  return "speech-error";
}

// ── Helpers ──────────────────────────────────────────────────────────────
const speechLocale = (locale: Locale) => (locale === "pt-BR" ? "pt-BR" : "en-US");

function normalizeRecognitionPhrase(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function preferredTranscript(result: SpeechRecognitionResult, preferredPhrases: string[]): string {
  const normalizedPhrases = preferredPhrases.map(normalizeRecognitionPhrase).filter(Boolean);
  let bestTranscript = result[0]?.transcript ?? "";
  let bestScore = -1;
  const alternativeCount = result.length || 1;
  for (let index = 0; index < alternativeCount; index += 1) {
    const candidate = result[index]?.transcript ?? "";
    const padded = ` ${normalizeRecognitionPhrase(candidate)} `;
    const score = normalizedPhrases.filter((phrase) => padded.includes(` ${phrase} `)).length;
    if (score > bestScore) {
      bestScore = score;
      bestTranscript = candidate;
    }
  }
  return bestTranscript;
}

export function requiresUserGestureBetweenRecognitions(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function supportsRecognition(): boolean {
  return typeof window !== "undefined" && Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
}

export function supportsSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function useMicrophoneHealth(): CaptureHealth {
  return useSyncExternalStore(subscribeHealth, getHealthSnapshot, getHealthSnapshot);
}

export function stopAudio(): void {
  activeRecognition?.cancel(new SpeechRecognitionFailure("aborted"));
  if (supportsSynthesis()) window.speechSynthesis.cancel();
  speakingResolve?.();
  speakingResolve = null;
  publishHealth({ phase: "ready", rms: 0, problem: undefined });
}

export function finishListening(): void {
  activeRecognition?.finish();
}

export function releaseMicrophoneCapture(): void {
  // Native SpeechRecognition owns the mic session; nothing persistent to dispose.
  // Kept for API compatibility with previous AudioWorklet pipeline.
  if (!activeRecognition) publishHealth({ phase: "ready", rms: 0, problem: undefined });
}

// Synthetic volume: give UI a gentle pulse while listening without opening a second mic.
function startSyntheticVolume(onVolume?: (level: number) => void): () => void {
  if (!onVolume) return () => {};
  let frame: number | undefined;
  const tick = () => {
    // Gentle oscillation so the mic bar feels alive without real PCM.
    const level = 0.25 + Math.abs(Math.sin(Date.now() / 280)) * 0.45 + Math.random() * 0.1;
    onVolume(Math.min(1, level));
    frame = window.requestAnimationFrame(tick);
  };
  frame = window.requestAnimationFrame(tick);
  return () => {
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    onVolume(0);
  };
}

export async function listenOnce(
  locale: Locale,
  timeoutMs = 10_000,
  preferredPhrases: string[] = [],
  onCaptureStart?: () => void,
  onVolume?: (level: number) => void,
  onInterimTranscript?: (text: string) => void,
): Promise<string> {
  // Serialize: never have two recognitions overlapping (iOS will abort the second).
  if (activeRecognition) {
    const previous = activeRecognition;
    previous.cancel(new SpeechRecognitionFailure("aborted"));
    await previous.released;
  }

  return new Promise((resolve, reject) => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      reject(new SpeechRecognitionFailure("unavailable", "SpeechRecognition not supported"));
      return;
    }

    const recognition = new Recognition();
    recognition.lang = speechLocale(locale);
    recognition.continuous = false;
    recognition.interimResults = Boolean(onInterimTranscript);
    recognition.maxAlternatives = preferredPhrases.length > 0 ? 5 : 1;

    let settled = false;
    let transcript = "";
    let terminalError: Error | null = null;
    let timeout: number | undefined;
    let releaseFallback: number | undefined;
    let abortFallback: number | undefined;
    let stopVolume: (() => void) | undefined;
    let volumeInterval: number | undefined;
    let releaseSession: () => void = () => {};
    const released = new Promise<void>((release) => {
      releaseSession = release;
    });

    const startSynthetic = () => {
      if (onVolume) {
        // Combine rAF pulse with a fallback interval for jsdom / tests.
        stopVolume = startSyntheticVolume(onVolume);
      }
    };
    const stopSynthetic = () => {
      stopVolume?.();
      if (volumeInterval !== undefined) window.clearInterval(volumeInterval);
      onVolume?.(0);
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.clearTimeout(releaseFallback);
      window.clearTimeout(abortFallback);
      stopSynthetic();
      recognition.onstart = null;
      recognition.onaudiostart = null;
      recognition.onsoundstart = null;
      recognition.onspeechstart = null;
      recognition.onspeechend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (activeRecognition?.recognition === recognition) activeRecognition = null;
      publishHealth({ phase: "ready", rms: 0, problem: undefined });
      releaseSession();
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(transcript.trim());
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const settleAfterEnd = () => {
      if (transcript) succeed();
      else fail(terminalError ?? new SpeechRecognitionFailure("no-speech"));
    };
    const forceRelease = () => {
      window.clearTimeout(releaseFallback);
      window.clearTimeout(abortFallback);
      releaseFallback = window.setTimeout(() => {
        try {
          recognition.abort();
        } catch {
          // Service may already be disconnected.
        }
        abortFallback = window.setTimeout(settleAfterEnd, RECOGNITION_ABORT_GRACE_MS);
      }, RECOGNITION_RELEASE_GRACE_MS);
    };
    const cancel = (error: Error) => {
      if (settled || terminalError) return;
      terminalError = error;
      window.clearTimeout(timeout);
      try {
        recognition.abort();
      } catch {
        // Not started yet.
      }
      forceRelease();
    };
    const finish = () => {
      if (settled || terminalError) return;
      window.clearTimeout(timeout);
      try {
        recognition.stop();
      } catch {
        // Already shutting down.
      }
      forceRelease();
    };
    const armTimeout = (duration: number) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => cancel(new SpeechRecognitionFailure("timed-out")), duration);
    };

    activeRecognition = { recognition, cancel, finish, released };
    publishHealth({ phase: "connecting", problem: undefined });
    armTimeout(timeoutMs);
    startSynthetic();

    recognition.onstart = () => {
      publishHealth({ phase: "listening", problem: undefined, lastFrameAt: performance.now() });
      armTimeout(timeoutMs);
    };
    recognition.onaudiostart = () => {
      publishHealth({ phase: "listening", problem: undefined });
      armTimeout(timeoutMs);
      onCaptureStart?.();
    };
    recognition.onsoundstart = () => armTimeout(MAX_UTTERANCE_MS);
    recognition.onspeechstart = () => {
      publishHealth({ phase: "listening", problem: undefined });
      armTimeout(MAX_UTTERANCE_MS);
    };
    recognition.onspeechend = () => {
      window.clearTimeout(timeout);
      try {
        recognition.stop();
      } catch {
        // Final result may already have stopped service.
      }
      forceRelease();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // With interimResults=true, the event may contain interim fragments.
      // We emit interim via callback but only settle with final.
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        const candidate = preferredTranscript(res, preferredPhrases);
        if (!candidate) continue;
        if (!res.isFinal) {
          onInterimTranscript?.(candidate);
          continue;
        }
        // Final result — lock it in.
        transcript = candidate;
        terminalError = null;
        window.clearTimeout(timeout);
        try {
          recognition.stop();
        } catch {
          // Wait for onend.
        }
        forceRelease();
        return;
      }
      // Fallback when interimResults=false: single final in one event.
      if (!recognition.interimResults) {
        const r = event.results[event.resultIndex];
        const candidate = r ? preferredTranscript(r, preferredPhrases) : "";
        if (!candidate) return;
        transcript = candidate;
        terminalError = null;
        window.clearTimeout(timeout);
        try {
          recognition.stop();
        } catch {
          // wait
        }
        forceRelease();
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (terminalError || (transcript && event.error === "aborted")) {
        forceRelease();
        return;
      }
      const code = event.error || "speech-error";
      // iOS often emits "no-speech" or "audio-capture" when mic was stolen;
      // surface as readable diagnostic.
      const failure = new SpeechRecognitionFailure(code, (event as unknown as { message?: string }).message || "");
      // Don't spam console for expected no-speech during push-to-talk.
      if (code !== "no-speech" && code !== "aborted") console.warn("Speech recognition failed", { code: failure.code, detail: failure.detail });
      terminalError = failure;
      // Map to health problems for UI hints.
      if (code === "not-allowed" || code === "service-not-allowed") publishHealth({ phase: "interrupted", problem: "microphone-interrupted" });
      else if (code === "audio-capture" || code === "network") publishHealth({ phase: "interrupted", problem: "microphone-interrupted" });
      else if (code === "no-speech") publishHealth({ phase: "listening", problem: "no-voice" });
      forceRelease();
    };

    recognition.onend = settleAfterEnd;

    try {
      recognition.start();
      publishHealth({ phase: "connecting", problem: undefined });
    } catch (error) {
      terminalError = error instanceof Error ? error : new SpeechRecognitionFailure("speech-start-error", String(error));
      settleAfterEnd();
    }
  });
}

export function speak(text: string, locale: Locale): Promise<void> {
  return new Promise((resolve) => {
    if (!supportsSynthesis()) {
      resolve();
      return;
    }
    // Speech output must not race with recognition — cancel any active turn.
    activeRecognition?.cancel(new SpeechRecognitionFailure("aborted", "speech-output"));
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const language = speechLocale(locale);
    utterance.lang = language;
    utterance.rate = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) => v.lang.toLocaleLowerCase() === language.toLocaleLowerCase())
      ?? voices.find((v) => v.lang.toLocaleLowerCase().startsWith(language.slice(0, 2).toLocaleLowerCase()));
    if (preferred) utterance.voice = preferred;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      speakingResolve = null;
      window.setTimeout(resolve, SYNTHESIS_RELEASE_GRACE_MS);
    };
    speakingResolve = finish;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  });
}
