import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeLocally } from "./localTranscription";
import {
  finishListening,
  getSpeechErrorCode,
  listenOnce,
  releaseMicrophoneCapture,
  speak,
  SpeechRecognitionFailure,
  stopAudio,
} from "./speech";

vi.mock("./localTranscription", () => ({ transcribeLocally: vi.fn() }));

class FakeTrack {
  enabled = true;
  readyState = "live";
  onended: (() => void) | null = null;
  stop() {
    this.readyState = "ended";
    this.onended?.();
  }
}

class FakeStream {
  active = true;
  track = new FakeTrack();
  getTracks() { return [this.track]; }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  createAnalyser() {
    return { fftSize: 256, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0) };
  }
  createMediaStreamSource() { return { connect: vi.fn() }; }
  async decodeAudioData() { return { duration: 0.1 } as AudioBuffer; }
  async resume() { this.state = "running"; }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; }
}

class FakeOfflineAudioContext {
  destination = {};
  createBufferSource() { return { buffer: null, connect: vi.fn(), start: vi.fn() }; }
  async startRendering() { return { getChannelData: () => new Float32Array(1_600) }; }
}

class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported() { return true; }
  state: RecordingState = "inactive";
  mimeType: string;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super();
    this.mimeType = options?.mimeType ?? "audio/mp4";
    FakeMediaRecorder.instances.push(this);
  }
  start() { this.state = "recording"; }
  emitData() {
    const data = Object.assign(new Event("dataavailable"), { data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
    this.dispatchEvent(data);
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.emitData();
      this.dispatchEvent(new Event("stop"));
    });
  }
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

async function recordAndFinish(locale: "en" | "pt-BR") {
  const result = listenOnce(locale);
  await vi.waitFor(() => expect(FakeMediaRecorder.instances.at(-1)?.state).toBe("recording"));
  finishListening();
  return result;
}

describe("local speech capture", () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeMediaRecorder.instances = [];
    getUserMedia = vi.fn().mockResolvedValue(new FakeStream());
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.mocked(transcribeLocally).mockResolvedValue("Mario five");
  });

  afterEach(() => {
    stopAudio();
    releaseMicrophoneCapture();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("records once and sends 16 kHz audio with the selected locale", async () => {
    await expect(recordAndFinish("pt-BR")).resolves.toBe("Mario five");
    expect(transcribeLocally).toHaveBeenCalledWith(expect.any(Float32Array), "pt-BR");
    expect(vi.mocked(transcribeLocally).mock.calls[0]?.[0]).toHaveLength(1_600);
  });

  it("reuses one microphone stream across consecutive commands", async () => {
    await recordAndFinish("en");
    await recordAndFinish("en");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(transcribeLocally).toHaveBeenCalledTimes(2);
  });

  it("reports a local interim transcript while recording and a final result on release", async () => {
    vi.mocked(transcribeLocally).mockResolvedValueOnce("Mario").mockResolvedValueOnce("Mario five");
    const onInterim = vi.fn();
    const result = listenOnce("en", 10_000, [], undefined, undefined, onInterim);
    await vi.waitFor(() => expect(FakeMediaRecorder.instances.at(-1)?.state).toBe("recording"));
    FakeMediaRecorder.instances.at(-1)?.emitData();
    await vi.waitFor(() => expect(onInterim).toHaveBeenCalledWith("Mario"));
    finishListening();
    await expect(result).resolves.toBe("Mario five");
  });

  it("preserves a microphone acquisition failure", async () => {
    releaseMicrophoneCapture();
    getUserMedia.mockRejectedValueOnce(new Error("No audio input device"));
    const failure = await listenOnce("pt-BR").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SpeechRecognitionFailure);
    expect(failure).toMatchObject({ code: "audio-capture", detail: "No audio input device" });
    expect(getSpeechErrorCode(failure)).toBe("audio-capture");
  });

  it("reports an intentional interruption as aborted", async () => {
    const result = listenOnce("en");
    await vi.waitFor(() => expect(FakeMediaRecorder.instances.at(-1)?.state).toBe("recording"));
    stopAudio();
    await expect(result).rejects.toMatchObject({ code: "aborted" });
  });

  it("configures synthesis for the selected language", async () => {
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
