import { prepareVoiceModel, transcribeLocally } from "../localTranscription";
import type { SpeechEngine, TranscriptionRequest } from "./SpeechEngine";

export class TransformersWhisperEngine implements SpeechEngine {
  prepare(): void {
    prepareVoiceModel();
  }

  transcribe({ audio, sampleRate, locale, kind }: TranscriptionRequest): Promise<string> {
    return transcribeLocally(audio, sampleRate, locale, kind);
  }
}
