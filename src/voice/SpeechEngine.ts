import type { Locale } from "../i18n";

export type TranscriptionKind = "partial" | "final";

export type TranscriptionRequest = {
  audio: Float32Array;
  sampleRate: number;
  locale: Locale;
  kind: TranscriptionKind;
};

export interface SpeechEngine {
  prepare(): void;
  transcribe(request: TranscriptionRequest): Promise<string>;
}
