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

export async function listenOnce(locale: Locale, timeoutMs = 10_000): Promise<string> {
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
    recognition.maxAlternatives = 1;
    let settled = false;
    let transcript = "";
    let terminalError: Error | null = null;
    let timeout: number | undefined;
    let releaseFallback: number | undefined;
    let abortFallback: number | undefined;
    let releaseSession: () => void = () => {};
    const released = new Promise<void>((release) => {
      releaseSession = release;
    });

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.clearTimeout(releaseFallback);
      window.clearTimeout(abortFallback);
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
    recognition.onaudiostart = () => armTimeout(timeoutMs);
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
      const result = event.results[event.resultIndex]?.[0]?.transcript ?? "";
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
