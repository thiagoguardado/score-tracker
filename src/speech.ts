import type { Locale } from "./i18n";
import { AudioWorkletCapture, useCaptureHealth } from "./voice/AudioWorkletCapture";
import { TransformersWhisperEngine } from "./voice/TransformersWhisperEngine";

const SYNTHESIS_RELEASE_GRACE_MS = 150;
const capture = new AudioWorkletCapture(new TransformersWhisperEngine());
let speakingResolve: (() => void) | null = null;

export class SpeechCaptureFailure extends Error {
  readonly code: string;
  readonly detail: string;

  constructor(code: string, detail = "") {
    super(code);
    this.name = "SpeechCaptureFailure";
    this.code = code;
    this.detail = detail;
  }
}

capture.setFailureFactory((code, detail) => new SpeechCaptureFailure(code, detail));

export function getSpeechErrorCode(error: unknown): string {
  if (error instanceof SpeechCaptureFailure) return error.code;
  if (error instanceof Error && error.message) return error.message;
  return "speech-error";
}

const speechLocale = (locale: Locale) => locale === "pt-BR" ? "pt-BR" : "en-US";

export function supportsRecognition(): boolean {
  return typeof window !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && "AudioContext" in window
    && "AudioWorkletNode" in window
    && "Worker" in window;
}

export function supportsSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function useMicrophoneHealth() {
  return useCaptureHealth(capture);
}

export function stopAudio(): void {
  capture.cancel(new SpeechCaptureFailure("aborted"));
  if (supportsSynthesis()) window.speechSynthesis.cancel();
  speakingResolve?.();
  speakingResolve = null;
}

export function finishListening(): void {
  capture.finish();
}

export function releaseMicrophoneCapture(): void {
  void capture.disposePipeline();
}

export async function listenOnce(
  locale: Locale,
  timeoutMs = 10_000,
  _preferredPhrases: string[] = [],
  onCaptureStart?: () => void,
  onVolume?: (level: number) => void,
  onInterimTranscript?: (text: string) => void,
): Promise<string> {
  return capture.listen(locale, timeoutMs, _preferredPhrases, onCaptureStart, onVolume, onInterimTranscript);
}

export function speak(text: string, locale: Locale): Promise<void> {
  return new Promise((resolve) => {
    if (!supportsSynthesis()) {
      resolve();
      return;
    }
    capture.pauseGateForOutput();
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
