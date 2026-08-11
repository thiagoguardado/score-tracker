import { prepareVoiceModel, transcribeLocally } from "../localTranscription";
import type { SpeechEngine, TranscriptionRequest } from "./SpeechEngine";

export class TransformersWhisperEngine implements SpeechEngine {
  prepare(): void {
    prepareVoiceModel();
  }

  transcribe({ audio, sampleRate, locale, kind, preferredPhrases }: TranscriptionRequest): Promise<string> {
    return preferredPhrases?.length
      ? transcribeLocally(audio, sampleRate, locale, kind, preferredPhrases)
      : transcribeLocally(audio, sampleRate, locale, kind);
  }
}
