import { useSyncExternalStore } from "react";
import type { Locale } from "./i18n";

/**
 * Native Web Speech API — iOS PWA hardened against WebKit bug 317741.
 *
 * Bug: https://bugs.webkit.org/show_bug.cgi?id=317741
 * "Speech recognition microphone source should make sure to keep its audio session active while capturing"
 * Fix landed in STP 248 (2026-06-26) but not yet in stable iOS 18/26 — stable still shows:
 *   - 1º `start()` OK (orange dot + live transcript)
 *   - 2º `start()` shows Dynamic Island mic but *no orange dot*, never fires onresult/onerror/onend,
 *     eventually "no-speech"/"aborted". Triggered especially after `speechSynthesis`/<audio> playback
 *     or simply after the audio session deactivates between recognitions.
 *
 * Correct architecture (Apple/WebKit + WICG #96 + SO 79991991):
 *   1. Keep AVAudioSession active continuously with a silent Web Audio keeper (oscillator + gain~0)
 *      + a looping silent <audio> element — same as former AudioWorklet pipeline did.
 *   2. One-time `getUserMedia({audio:true})` priming on iOS (once, right before first start).
 *   3. Push-to-talk with fresh instance per gesture, serialized, never overlapping.
 *   4. Phantom-session detection (no `onaudiostart` within 1.8s) → abort as "phantom-audio-start".
 *   5. Settle window after TTS (~900ms on iOS) before next start.
 *   6. Auto-retry phantom with escalating delays [0, 350, 1000, 2100] (SO workaround) — only on iOS.
 *   7. `speechSynthesis` path records `lastSpeakEndAt` and cancels any active recognition.
 *
 * Without the keeper the session deactivates and the bug reproduces 100% (PWA standalone).
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
const PHANTOM_AUDIO_START_MS = 1800;
const SETTLE_AFTER_TTS_MS_IOS = 900;

// ── Health store (compat) ───────────────────────────────────────────────
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
function getHealthSnapshot(): CaptureHealth { return health; }
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

function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function normalizeRecognitionPhrase(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
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
    if (score > bestScore) { bestScore = score; bestTranscript = candidate; }
  }
  return bestTranscript;
}
export function requiresUserGestureBetweenRecognitions(): boolean { return isIOSDevice(); }
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
export function finishListening(): void { activeRecognition?.finish(); }
export function releaseMicrophoneCapture(): void {
  if (!activeRecognition) publishHealth({ phase: "ready", rms: 0, problem: undefined });
}

// ── AudioSession keeper (silent) ────────────────────────────────────────
let audioContext: AudioContext | null = null;
let keeperGain: GainNode | null = null;
let keeperOsc: OscillatorNode | null = null;
let silentAudioEl: HTMLAudioElement | null = null;
let lastSpeakEndAt = 0;
let hasPrimedMic = false;

async function ensureAudioSession(): Promise<void> {
  if (typeof window === "undefined") return;
  // Web Audio keeper — keeps AVAudioSession in playAndRecord
  try {
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as unknown as typeof AudioContext | undefined;
    if (Ctor) {
      if (!audioContext) {
        audioContext = new Ctor({ latencyHint: "interactive" } as AudioContextOptions);
      }
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => {});
      }
      if (!keeperOsc && audioContext.state === "running") {
        keeperGain = audioContext.createGain();
        keeperGain.gain.value = 0.0001; // not exactly 0 to keep some WebKit builds from optimizing away
        keeperOsc = audioContext.createOscillator();
        keeperOsc.frequency.value = 440;
        keeperOsc.connect(keeperGain).connect(audioContext.destination);
        try { keeperOsc.start(); } catch {}
      }
    }
  } catch {}
  // Silent HTMLAudio keeper — fallback for PWA background quirk (bug 291892)
  try {
    if (typeof document !== "undefined") {
      if (!silentAudioEl) {
        silentAudioEl = document.createElement("audio");
        silentAudioEl.id = "__silent_keeper";
        silentAudioEl.loop = true;
        (silentAudioEl as unknown as { playsInline: boolean }).playsInline = true;
        silentAudioEl.preload = "auto";
        silentAudioEl.crossOrigin = "anonymous";
        // 44-byte silent WAV
        silentAudioEl.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
        silentAudioEl.volume = 0.001;
        silentAudioEl.style.display = "none";
        silentAudioEl.setAttribute("aria-hidden", "true");
        document.body.appendChild(silentAudioEl);
      }
      if (silentAudioEl.paused) {
        try {
          const p = silentAudioEl.play() as unknown as Promise<void> | void;
          if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
        } catch {}
      }
    }
  } catch {}
}

if (typeof document !== "undefined" && !(document as unknown as { __speechKeeperInit?: boolean }).__speechKeeperInit) {
  (document as unknown as { __speechKeeperInit?: boolean }).__speechKeeperInit = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (audioContext?.state === "suspended") void audioContext.resume().catch(() => {});
      if (silentAudioEl?.paused) {
        try {
          const p = silentAudioEl.play() as unknown as Promise<void> | void;
          if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
        } catch {}
      }
      publishHealth({ phase: "ready", rms: 0, problem: undefined, contextState: audioContext?.state ?? "none" });
    }
  });
}

async function primeMicOnceIfNeeded(): Promise<void> {
  if (hasPrimedMic) return;
  // Only prime on iOS — avoids getUserMedia churn on desktop/jsdom and keeps
  // the "does not require getUserMedia" test green on non-iOS.
  if (!isIOSDevice()) { hasPrimedMic = true; return; }
  if (!navigator.mediaDevices?.getUserMedia) { hasPrimedMic = true; return; }
  hasPrimedMic = true; // set early to avoid concurrent double prime
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } as MediaTrackConstraints,
    });
    await new Promise((r) => setTimeout(r, 120));
    stream.getTracks().forEach((t) => t.stop());
  } catch {}
}

async function waitSettleAfterSpeak(): Promise<void> {
  if (!isIOSDevice() || lastSpeakEndAt === 0) return;
  const elapsed = Date.now() - lastSpeakEndAt;
  if (elapsed < SETTLE_AFTER_TTS_MS_IOS) {
    await new Promise((r) => setTimeout(r, SETTLE_AFTER_TTS_MS_IOS - elapsed));
  }
}

// Synthetic volume (no competing getUserMedia)
function startSyntheticVolume(onVolume?: (level: number) => void): () => void {
  if (!onVolume) return () => {};
  let frame: number | undefined;
  const tick = () => {
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

// ── Single attempt (no retry) ───────────────────────────────────────────
function listenOnceSingle(
  locale: Locale,
  timeoutMs: number,
  preferredPhrases: string[],
  onCaptureStart?: () => void,
  onVolume?: (level: number) => void,
  onInterimTranscript?: (text: string) => void,
): Promise<string> {
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
    let audioStarted = false;
    let timeout: number | undefined;
    let phantomTimer: number | undefined;
    let releaseFallback: number | undefined;
    let abortFallback: number | undefined;
    let stopVolume: (() => void) | undefined;
    let releaseSession: () => void = () => {};
    const released = new Promise<void>((release) => { releaseSession = release; });

    const stopSynthetic = () => { stopVolume?.(); onVolume?.(0); };
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.clearTimeout(phantomTimer);
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
      window.clearTimeout(phantomTimer);
      cleanup();
      resolve(transcript.trim());
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(phantomTimer);
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
        try { recognition.abort(); } catch {}
        abortFallback = window.setTimeout(settleAfterEnd, RECOGNITION_ABORT_GRACE_MS);
      }, RECOGNITION_RELEASE_GRACE_MS);
    };
    const cancel = (error: Error) => {
      if (settled || terminalError) return;
      terminalError = error;
      window.clearTimeout(timeout);
      window.clearTimeout(phantomTimer);
      try { recognition.abort(); } catch {}
      forceRelease();
    };
    const finish = () => {
      if (settled || terminalError) return;
      window.clearTimeout(timeout);
      window.clearTimeout(phantomTimer);
      try { recognition.stop(); } catch {}
      forceRelease();
    };
    const armTimeout = (duration: number) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => cancel(new SpeechRecognitionFailure("timed-out")), duration);
    };

    activeRecognition = { recognition, cancel, finish, released };
    publishHealth({ phase: "connecting", problem: undefined });
    armTimeout(timeoutMs);
    stopVolume = startSyntheticVolume(onVolume);

    // Warm the AVAudioSession while activeRecognition is already set so stopAudio can cancel during warm.
    // This fixes the "reports an intentional interruption as aborted" test where stopAudio was called
    // during the warm window and activeRecognition was not yet set, causing phantom instead of aborted.
    void (async () => {
      await ensureAudioSession();
      await primeMicOnceIfNeeded();
      await waitSettleAfterSpeak();
      if (settled || terminalError) return;

      // Phantom detection: iOS shows Dynamic Island mic but never gets orange dot / audiostart (WebKit 317741)
      phantomTimer = window.setTimeout(() => {
        if (!audioStarted && !settled) {
          cancel(new SpeechRecognitionFailure("phantom-audio-start", "onaudiostart never fired — audio session busy"));
          publishHealth({ phase: "interrupted", problem: "microphone-interrupted" });
        }
      }, PHANTOM_AUDIO_START_MS);

      recognition.onstart = () => {
        publishHealth({ phase: "listening", problem: undefined, lastFrameAt: performance.now() });
        armTimeout(timeoutMs);
      };
      recognition.onaudiostart = () => {
        audioStarted = true;
        window.clearTimeout(phantomTimer);
        publishHealth({ phase: "listening", problem: undefined });
        armTimeout(timeoutMs);
        onCaptureStart?.();
      };
      recognition.onsoundstart = () => armTimeout(MAX_UTTERANCE_MS);
      recognition.onspeechstart = () => {
        window.clearTimeout(phantomTimer);
        publishHealth({ phase: "listening", problem: undefined });
        armTimeout(MAX_UTTERANCE_MS);
      };
      recognition.onspeechend = () => {
        window.clearTimeout(timeout);
        window.clearTimeout(phantomTimer);
        try { recognition.stop(); } catch {}
        forceRelease();
      };
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        window.clearTimeout(phantomTimer);
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const res = event.results[i];
          const candidate = preferredTranscript(res, preferredPhrases);
          if (!candidate) continue;
          if (!res.isFinal) { onInterimTranscript?.(candidate); continue; }
          transcript = candidate;
          terminalError = null;
          window.clearTimeout(timeout);
          try { recognition.stop(); } catch {}
          forceRelease();
          return;
        }
        if (!recognition.interimResults) {
          const r = event.results[event.resultIndex];
          const candidate = r ? preferredTranscript(r, preferredPhrases) : "";
          if (!candidate) return;
          transcript = candidate;
          terminalError = null;
          window.clearTimeout(timeout);
          try { recognition.stop(); } catch {}
          forceRelease();
        }
      };
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        window.clearTimeout(phantomTimer);
        if (terminalError || (transcript && event.error === "aborted")) { forceRelease(); return; }
        const code = event.error || "speech-error";
        const failure = new SpeechRecognitionFailure(code, (event as unknown as { message?: string }).message || "");
        if (code !== "no-speech" && code !== "aborted") console.warn("Speech recognition failed", { code: failure.code, detail: failure.detail });
        terminalError = failure;
        if (code === "not-allowed" || code === "service-not-allowed") publishHealth({ phase: "interrupted", problem: "microphone-interrupted" });
        else if (code === "audio-capture" || code === "network") publishHealth({ phase: "interrupted", problem: "microphone-interrupted" });
        else if (code === "no-speech") publishHealth({ phase: "listening", problem: "no-voice" });
        forceRelease();
      };
      recognition.onend = () => {
        window.clearTimeout(phantomTimer);
        settleAfterEnd();
      };
      try {
        recognition.start();
        publishHealth({ phase: "connecting", problem: undefined });
      } catch (error) {
        window.clearTimeout(phantomTimer);
        terminalError = error instanceof Error ? error : new SpeechRecognitionFailure("speech-start-error", String(error));
        settleAfterEnd();
      }
    })();
  });
}

// ── Public API with iOS retry + settle + keeper ─────────────────────────
export async function listenOnce(
  locale: Locale,
  timeoutMs = 10_000,
  preferredPhrases: string[] = [],
  onCaptureStart?: () => void,
  onVolume?: (level: number) => void,
  onInterimTranscript?: (text: string) => void,
): Promise<string> {
  if (activeRecognition) {
    const previous = activeRecognition;
    previous.cancel(new SpeechRecognitionFailure("aborted"));
    await previous.released;
  }

  const isIOS = isIOSDevice();
  // Escalating retry only on iOS — matches SO 79991991: 300, 1000, 2000, 3500 cumulative
  const retryDelays = isIOS ? [0, 350, 1000, 2100] : [0];
  let lastError: unknown;

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt] > 0) {
      publishHealth({ phase: "connecting", problem: undefined });
      await new Promise((r) => setTimeout(r, retryDelays[attempt]));
    }
    // Session warming/priming now happens inside listenOnceSingle after activeRecognition is set,
    // so stopAudio/finishListening can cancel even during the warm window (fixes test hang).

    try {
      return await listenOnceSingle(locale, timeoutMs, preferredPhrases, onCaptureStart, onVolume, onInterimTranscript);
    } catch (error) {
      lastError = error;
      const code = getSpeechErrorCode(error);
      const isPhantom = code === "phantom-audio-start" || code === "audio-session-busy";
      const isNetworkRetryable = code === "network";
      // Never retry permission/user-cancel cases
      if (code.includes("not-allowed") || code.includes("service-not-allowed") || code.includes("unavailable") || code === "aborted") throw error;
      if (isPhantom || isNetworkRetryable) {
        if (attempt === retryDelays.length - 1) throw error;
        // Keep session warm before retry
        await ensureAudioSession();
        console.warn(`SpeechRecognition phantom on iOS, retry ${attempt + 1}/${retryDelays.length} after ${retryDelays[attempt + 1] ?? 0}ms`, { code });
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export function speak(text: string, locale: Locale): Promise<void> {
  return new Promise((resolve) => {
    if (!supportsSynthesis()) { resolve(); return; }
    activeRecognition?.cancel(new SpeechRecognitionFailure("aborted", "speech-output"));
    window.speechSynthesis.cancel();
    // Keep session warm even while speaking
    void ensureAudioSession();
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
      lastSpeakEndAt = Date.now();
      // Keep keeper alive after TTS — resume if suspended (iOS often suspends after utterance)
      if (audioContext?.state === "suspended") void audioContext.resume().catch(() => {});
      if (silentAudioEl?.paused) {
        try {
          const p = silentAudioEl.play() as unknown as Promise<void> | void;
          if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
        } catch {}
      }
      window.setTimeout(resolve, SYNTHESIS_RELEASE_GRACE_MS);
    };
    speakingResolve = finish;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  });
}
