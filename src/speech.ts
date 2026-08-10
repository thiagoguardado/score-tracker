import type { Locale } from "./i18n";

type ActiveRecognitionSession = {
  recognition: SpeechRecognition;
  cancel: (error: Error) => void;
  released: Promise<void>;
};

let activeRecognition: ActiveRecognitionSession | null = null;
let speakingResolve: (() => void) | null = null;

const RECOGNITION_RELEASE_GRACE_MS = 750;
const RECOGNITION_ABORT_GRACE_MS = 250;
const MAX_UTTERANCE_MS = 60_000;
const SYNTHESIS_RELEASE_GRACE_MS = 150;

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

export function getSpeechErrorCode(error: unknown): string {
  if (error instanceof SpeechRecognitionFailure) return error.code;
  if (error instanceof Error && error.message) return error.message;
  return "speech-error";
}

const speechLocale = (locale: Locale) => locale === "pt-BR" ? "pt-BR" : "en-US";

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
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function supportsRecognition(): boolean {
  return typeof window !== "undefined" && Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
}

export function supportsSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stopAudio(): void {
  activeRecognition?.cancel(new SpeechRecognitionFailure("aborted"));
  if (supportsSynthesis()) window.speechSynthesis.cancel();
  speakingResolve?.();
  speakingResolve = null;
}

export async function listenOnce(
  locale: Locale,
  timeoutMs = 10_000,
  preferredPhrases: string[] = [],
  onCaptureStart?: () => void,
  onVolume?: (level: number) => void,
): Promise<string> {
  if (activeRecognition) {
    const previous = activeRecognition;
    previous.cancel(new SpeechRecognitionFailure("aborted"));
    await previous.released;
  }

  return new Promise((resolve, reject) => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      reject(new Error("speech-unavailable"));
      return;
    }

    const recognition = new Recognition();
    recognition.lang = speechLocale(locale);
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = preferredPhrases.length > 0 ? 5 : 1;
    let settled = false;
    let transcript = "";
    let terminalError: Error | null = null;
    let timeout: number | undefined;
    let releaseFallback: number | undefined;
    let abortFallback: number | undefined;
    let stopVolumeMeter: (() => void) | undefined;
    let releaseSession: () => void = () => {};
    const released = new Promise<void>((release) => {
      releaseSession = release;
    });

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.clearTimeout(releaseFallback);
      window.clearTimeout(abortFallback);
      stopVolumeMeter?.();
      onVolume?.(0);
      recognition.onstart = null;
      recognition.onaudiostart = null;
      recognition.onsoundstart = null;
      recognition.onspeechstart = null;
      recognition.onspeechend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (activeRecognition?.recognition === recognition) activeRecognition = null;
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
          // The service may already be disconnected.
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
        // The service may not have started yet, but the promise still has to settle.
      }
      forceRelease();
    };
    const armTimeout = (duration: number) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => cancel(new SpeechRecognitionFailure("timed-out")), duration);
    };

    activeRecognition = { recognition, cancel, released };
    armTimeout(timeoutMs);

    recognition.onstart = () => armTimeout(timeoutMs);
    recognition.onaudiostart = () => {
      armTimeout(timeoutMs);
      onCaptureStart?.();
      if (onVolume) stopVolumeMeter = startVolumeMeter(onVolume);
    };
    recognition.onsoundstart = () => armTimeout(MAX_UTTERANCE_MS);
    recognition.onspeechstart = () => armTimeout(MAX_UTTERANCE_MS);
    recognition.onspeechend = () => {
      window.clearTimeout(timeout);
      try {
        recognition.stop();
      } catch {
        // A final result may already have stopped the service.
      }
      forceRelease();
    };

    recognition.onresult = (event) => {
      const recognitionResult = event.results[event.resultIndex];
      const result = recognitionResult ? preferredTranscript(recognitionResult, preferredPhrases) : "";
      if (!result) return;
      transcript = result;
      terminalError = null;
      window.clearTimeout(timeout);
      try {
        recognition.stop();
      } catch {
        // Wait for end when the service has already begun shutting down.
      }
      forceRelease();
    };
    recognition.onerror = (event) => {
      if (terminalError || (transcript && event.error === "aborted")) {
        forceRelease();
        return;
      }
      const failure = new SpeechRecognitionFailure(event.error || "speech-error", event.message || "");
      console.warn("Speech recognition failed", { code: failure.code, detail: failure.detail });
      terminalError = failure;
      forceRelease();
    };
    recognition.onend = settleAfterEnd;

    try {
      recognition.start();
    } catch (error) {
      terminalError = error instanceof Error ? error : new Error("speech-start-error");
      settleAfterEnd();
    }
  });
}

function startVolumeMeter(onVolume: (level: number) => void): () => void {
  let cancelled = false;
  let frame: number | undefined;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let smoothed = 0;

  void navigator.mediaDevices?.getUserMedia({ audio: true }).then(async (mediaStream) => {
    if (cancelled) {
      mediaStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = mediaStream;
    context = new AudioContext();
    if (context.state === "suspended") await context.resume();
    if (cancelled) {
      mediaStream.getTracks().forEach((track) => track.stop());
      if (context.state !== "closed") await context.close();
      return;
    }
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(mediaStream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const measure = () => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      const normalized = Math.min(1, Math.max(0, (rms - 0.008) / 0.16));
      smoothed = Math.max(normalized, smoothed * 0.72);
      onVolume(smoothed);
      frame = requestAnimationFrame(measure);
    };
    measure();
  }).catch(() => {
    // The speech session remains usable when raw microphone analysis is unavailable.
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed") void context.close();
    onVolume(0);
  });

  return () => {
    cancelled = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed") void context.close();
  };
}

export function speak(text: string, locale: Locale): Promise<void> {
  return new Promise((resolve) => {
    if (!supportsSynthesis()) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const language = speechLocale(locale);
    utterance.lang = language;
    utterance.rate = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((voice) => voice.lang.toLocaleLowerCase() === language.toLocaleLowerCase())
      ?? voices.find((voice) => voice.lang.toLocaleLowerCase().startsWith(language.slice(0, 2).toLocaleLowerCase()));
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
