import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeLocally } from "./localTranscription";
import {
  finishListening,
  getSpeechErrorCode,
  listenOnce,
  releaseMicrophoneCapture,
  speak,
  SpeechCaptureFailure,
  stopAudio,
} from "./speech";

vi.mock("./localTranscription", () => ({
  prepareVoiceModel: vi.fn(),
  transcribeLocally: vi.fn(),
}));

class FakeTrack extends EventTarget {
  enabled = true;
  readyState: MediaStreamTrackState = "live";
  muted = false;
  stop() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

class FakeStream {
  active = true;
  track = new FakeTrack();
  getTracks() { return [this.track]; }
  getAudioTracks() { return [this.track]; }
}

type PortMessage = { type: string; open?: boolean; captureId?: number };

class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  captureId = 0;
  gateOpen = false;

  postMessage(message: PortMessage) {
    if (message.type !== "gate") return;
    this.captureId = message.captureId ?? 0;
    this.gateOpen = Boolean(message.open);
    if (!message.open) queueMicrotask(() => this.emit({ type: "flushed", captureId: this.captureId }));
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  emitAudio(audio: Float32Array, rms = 0.05) {
    this.emitHealth(rms, audio.length);
    if (this.gateOpen) this.emit({ type: "pcm", captureId: this.captureId, audio });
  }

  emitHealth(rms = 0.05, samplesReceived = 128) {
    this.emit({ type: "health", framesReceived: 2, samplesReceived, rms, peak: rms * 2 });
  }
}

class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  port = new FakePort();
  constructor() {
    FakeAudioWorkletNode.instances.push(this);
    window.setTimeout(() => {
      this.port.emit({ type: "ready", sampleRate: 48_000 });
      this.port.emit({ type: "health", framesReceived: 1, samplesReceived: 128, rms: 0, peak: 0 });
    }, 0);
  }
  connect<T>(target: T): T { return target; }
}

class FakeAudioContext extends EventTarget {
  state: AudioContextState = "running";
  sampleRate = 48_000;
  destination = {};
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  createMediaStreamSource() { return { connect: <T>(target: T) => target }; }
  createGain() { return { gain: { value: 1 }, connect: <T>(target: T) => target }; }
  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
}

class FakeUtterance {
  text: string;
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) { this.text = text; }
}

async function startCapture(locale: "en" | "pt-BR") {
  const onCaptureStart = vi.fn();
  const result = listenOnce(locale, 10_000, [], onCaptureStart);
  await vi.waitFor(() => expect(onCaptureStart).toHaveBeenCalled());
  return { result, node: FakeAudioWorkletNode.instances.at(-1)! };
}

describe("AudioWorklet speech capture", () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeAudioWorkletNode.instances = [];
    getUserMedia = vi.fn().mockResolvedValue(new FakeStream());
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);
    vi.mocked(transcribeLocally).mockResolvedValue("Mario five");
  });

  afterEach(() => {
    stopAudio();
    releaseMicrophoneCapture();
    vi.unstubAllGlobals();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("sends raw PCM and its source sample rate to the selected local language", async () => {
    const { result, node } = await startCapture("pt-BR");
    node.port.emitAudio(new Float32Array(4_800).fill(0.05));
    finishListening();
    await expect(result).resolves.toBe("Mario five");
    expect(transcribeLocally).toHaveBeenCalledWith(expect.any(Float32Array), 48_000, "pt-BR", "final");
  });

  it("passes known player names as transcription context", async () => {
    const onCaptureStart = vi.fn();
    const result = listenOnce("pt-BR", 10_000, ["Thiago", "Mário"], onCaptureStart);
    await vi.waitFor(() => expect(onCaptureStart).toHaveBeenCalled());
    const node = FakeAudioWorkletNode.instances.at(-1)!;
    node.port.emitAudio(new Float32Array(4_800).fill(0.05));
    finishListening();
    await result;
    expect(transcribeLocally).toHaveBeenCalledWith(expect.any(Float32Array), 48_000, "pt-BR", "final", ["Thiago", "Mário"]);
  });

  it("keeps one microphone and AudioWorklet pipeline across consecutive presses", async () => {
    const first = await startCapture("en");
    first.node.port.emitAudio(new Float32Array(4_800).fill(0.05));
    finishListening();
    await first.result;

    const second = await startCapture("en");
    second.node.port.emitAudio(new Float32Array(4_800).fill(0.05));
    finishListening();
    await second.result;

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeAudioWorkletNode.instances).toHaveLength(1);
  });

  it("reconnects the pipeline on the next user press after returning from the background", async () => {
    const first = await startCapture("en");
    first.node.port.emitAudio(new Float32Array(4_800).fill(0.05));
    finishListening();
    await first.result;

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));

    const second = await startCapture("en");
    second.node.port.emitAudio(new Float32Array(4_800).fill(0.05));
    finishListening();
    await second.result;
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(FakeAudioWorkletNode.instances).toHaveLength(2);
  });

  it("does not send silent PCM to Whisper", async () => {
    const { result, node } = await startCapture("en");
    node.port.emitAudio(new Float32Array(4_800), 0);
    finishListening();
    await expect(result).rejects.toMatchObject({ code: "no-speech" });
    expect(transcribeLocally).not.toHaveBeenCalled();
  });

  it("fails fast when the microphone stays live but PCM frames stop", async () => {
    const { result } = await startCapture("en");
    await expect(result).rejects.toMatchObject({ code: "pcm-stalled" });
    expect(transcribeLocally).not.toHaveBeenCalled();
  }, 3_000);

  it("waits until release before transcribing", async () => {
    vi.mocked(transcribeLocally).mockResolvedValue("Mario five");
    const onInterim = vi.fn();
    const onCaptureStart = vi.fn();
    const result = listenOnce("en", 10_000, [], onCaptureStart, undefined, onInterim);
    await vi.waitFor(() => expect(onCaptureStart).toHaveBeenCalled());
    const port = FakeAudioWorkletNode.instances.at(-1)!.port;
    port.emitAudio(new Float32Array(60_000).fill(0.05));
    const healthTimer = window.setInterval(() => port.emitHealth(), 200);
    await new Promise((resolve) => window.setTimeout(resolve, 2_500));
    window.clearInterval(healthTimer);
    expect(onInterim).not.toHaveBeenCalled();
    expect(transcribeLocally).not.toHaveBeenCalled();
    finishListening();
    await expect(result).resolves.toBe("Mario five");
    expect(transcribeLocally).toHaveBeenCalledTimes(1);
  });

  it("preserves a microphone acquisition failure", async () => {
    releaseMicrophoneCapture();
    getUserMedia.mockRejectedValueOnce(new Error("No audio input device"));
    const failure = await listenOnce("pt-BR").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SpeechCaptureFailure);
    expect(failure).toMatchObject({ code: "audio-capture", detail: "No audio input device" });
    expect(getSpeechErrorCode(failure)).toBe("audio-capture");
  });

  it("reports an intentional interruption as aborted", async () => {
    const { result } = await startCapture("en");
    stopAudio();
    await expect(result).rejects.toMatchObject({ code: "aborted" });
  });

  it("configures synthesis for the selected language without disposing the microphone", async () => {
    let utterance: FakeUtterance | undefined;
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: vi.fn(),
        getVoices: vi.fn(() => []),
        speak: vi.fn((next: FakeUtterance) => {
          utterance = next;
          queueMicrotask(() => next.onend?.());
        }),
      },
    });

    await speak("Hello", "en");
    expect(utterance?.lang).toBe("en-US");
    await speak("Olá", "pt-BR");
    expect(utterance?.lang).toBe("pt-BR");
  });
});
