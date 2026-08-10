import type { Locale } from "./i18n";
import { transcribeLocally } from "./localTranscription";

type ActiveCaptureSession = {
  cancel: (error: Error) => void;
  finish: () => void;
  released: Promise<void>;
};

let activeCapture: ActiveCaptureSession | null = null;
let speakingResolve: (() => void) | null = null;

const TARGET_SAMPLE_RATE = 16_000;
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
  return typeof window !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && "MediaRecorder" in window
    && "AudioContext" in window
    && "OfflineAudioContext" in window
    && "Worker" in window;
}

export function supportsSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stopAudio(): void {
  activeCapture?.cancel(new SpeechRecognitionFailure("aborted"));
  if (supportsSynthesis()) window.speechSynthesis.cancel();
  speakingResolve?.();
  speakingResolve = null;
}

export function finishListening(): void {
  activeCapture?.finish();
}

const volumeSubscribers = new Set<(level: number) => void>();
let volumeStream: MediaStream | undefined;
let volumeContext: AudioContext | undefined;
let volumeStart: Promise<MediaStream> | undefined;
let volumeFrame: number | undefined;
let currentVolume = 0;

function resetVolumeCapture(): void {
  if (volumeFrame !== undefined) cancelAnimationFrame(volumeFrame);
  volumeFrame = undefined;
  volumeStream = undefined;
  volumeStart = undefined;
  currentVolume = 0;
  volumeSubscribers.forEach((subscriber) => subscriber(0));
  if (volumeContext && volumeContext.state !== "closed") void volumeContext.close();
  volumeContext = undefined;
}

async function ensureMicrophone(): Promise<MediaStream> {
  if (volumeStream?.active) {
    volumeStream.getTracks().forEach((track) => { track.enabled = true; });
    if (volumeContext?.state === "suspended") await volumeContext.resume();
    return volumeStream;
  }
  if (volumeStart) return volumeStart;
  if (!navigator.mediaDevices?.getUserMedia) throw new SpeechRecognitionFailure("audio-capture");

  volumeStart = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  }).then(async (stream) => {
    volumeStream = stream;
    stream.getTracks().forEach((track) => { track.onended = resetVolumeCapture; });
    volumeContext = new AudioContext();
    if (volumeContext.state === "suspended") await volumeContext.resume();
    const analyser = volumeContext.createAnalyser();
    analyser.fftSize = 256;
    volumeContext.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const measure = () => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      const normalized = Math.min(1, Math.max(0, (rms - 0.008) / 0.16));
      currentVolume = Math.max(normalized, currentVolume * 0.72);
      volumeSubscribers.forEach((subscriber) => subscriber(currentVolume));
      volumeFrame = requestAnimationFrame(measure);
    };
    measure();
    return stream;
  }).catch((error) => {
    volumeStart = undefined;
    throw new SpeechRecognitionFailure("audio-capture", error instanceof Error ? error.message : String(error));
  });
  return volumeStart;
}

function pauseVolumeCapture(): void {
  volumeStream?.getTracks().forEach((track) => { track.enabled = false; });
  if (volumeContext?.state === "running") void volumeContext.suspend();
  currentVolume = 0;
}

export function releaseMicrophoneCapture(): void {
  const stream = volumeStream;
  resetVolumeCapture();
  stream?.getTracks().forEach((track) => track.stop());
}

function startVolumeMeter(onVolume: (level: number) => void): () => void {
  volumeSubscribers.add(onVolume);
  onVolume(currentVolume);
  return () => {
    volumeSubscribers.delete(onVolume);
    onVolume(0);
    if (volumeSubscribers.size === 0) pauseVolumeCapture();
  };
}

function preferredRecordingMimeType(): string | undefined {
  return ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
    .find((type) => MediaRecorder.isTypeSupported(type));
}

async function decodeAndResample(blob: Blob): Promise<Float32Array> {
  const decodingContext = new AudioContext();
  try {
    const decoded = await decodingContext.decodeAudioData(await blob.arrayBuffer());
    const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return new Float32Array(rendered.getChannelData(0));
  } finally {
    if (decodingContext.state !== "closed") await decodingContext.close();
  }
}

export async function listenOnce(
  locale: Locale,
  timeoutMs = 10_000,
  _preferredPhrases: string[] = [],
  onCaptureStart?: () => void,
  onVolume?: (level: number) => void,
  onInterimTranscript?: (text: string) => void,
): Promise<string> {
  if (activeCapture) {
    const previous = activeCapture;
    previous.cancel(new SpeechRecognitionFailure("aborted"));
    await previous.released;
  }

  return new Promise((resolve, reject) => {
    let recorder: MediaRecorder | undefined;
    let timeout: number | undefined;
    let stopMeter: (() => void) | undefined;
    let terminalError: Error | undefined;
    let finishRequested = false;
    let partialInFlight = false;
    let settled = false;
    const chunks: Blob[] = [];
    let releaseSession: () => void = () => {};
    const released = new Promise<void>((release) => { releaseSession = release; });

    const cleanup = () => {
      window.clearTimeout(timeout);
      stopMeter?.();
      if (activeCapture?.released === released) activeCapture = null;
      releaseSession();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (text: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (text.trim()) resolve(text.trim());
      else reject(new SpeechRecognitionFailure("no-speech"));
    };
    const finish = () => {
      finishRequested = true;
      window.clearTimeout(timeout);
      if (recorder?.state === "recording") recorder.stop();
    };
    const cancel = (error: Error) => {
      if (settled) return;
      terminalError = error;
      if (recorder?.state === "recording") recorder.stop();
      else fail(error);
    };

    activeCapture = { cancel, finish, released };
    timeout = window.setTimeout(finish, timeoutMs);

    void (async () => {
      try {
        const stream = await ensureMicrophone();
        if (settled) return;
        if (onVolume) stopMeter = startVolumeMeter(onVolume);
        const mimeType = preferredRecordingMimeType();
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size === 0) return;
          chunks.push(event.data);
          if (!onInterimTranscript || partialInFlight || recorder?.state !== "recording") return;
          partialInFlight = true;
          const partialBlob = new Blob([...chunks], { type: recorder.mimeType || mimeType });
          void decodeAndResample(partialBlob)
            .then((audio) => transcribeLocally(audio, locale))
            .then((text) => { if (!settled && text) onInterimTranscript(text); })
            .catch(() => { /* A final complete recording is still processed on release. */ })
            .finally(() => { partialInFlight = false; });
        });
        recorder.addEventListener("error", () => fail(new SpeechRecognitionFailure("audio-capture")));
        recorder.addEventListener("stop", () => {
          stopMeter?.();
          stopMeter = undefined;
          if (terminalError) {
            fail(terminalError);
            return;
          }
          void (async () => {
            try {
              const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType });
              if (blob.size === 0) throw new SpeechRecognitionFailure("no-speech");
              const audio = await decodeAndResample(blob);
              succeed(await transcribeLocally(audio, locale));
            } catch (error) {
              fail(error instanceof Error ? error : new Error(String(error)));
            }
          })();
        });
        recorder.start(1_500);
        onCaptureStart?.();
        if (finishRequested) finish();
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      activeCapture?.cancel(new SpeechRecognitionFailure("aborted"));
      releaseMicrophoneCapture();
    }
  });
}

export function speak(text: string, locale: Locale): Promise<void> {
  return new Promise((resolve) => {
    if (!supportsSynthesis()) {
      resolve();
      return;
    }
    pauseVolumeCapture();
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
