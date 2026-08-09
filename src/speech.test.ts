import { afterEach, describe, expect, it, vi } from "vitest";
import { getSpeechErrorCode, listenOnce, speak, SpeechRecognitionFailure, stopAudio } from "./speech";

class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  start() {
    queueMicrotask(() => {
      this.onstart?.();
      this.onaudiostart?.();
      this.onsoundstart?.();
      this.onspeechstart?.();
      this.onresult?.({ resultIndex: 0, results: { 0: { 0: { transcript: "test" } } } } as unknown as SpeechRecognitionEvent);
    });
  }
  stop() { queueMicrotask(() => this.onend?.()); }
  abort() {
    queueMicrotask(() => {
      this.onerror?.({ error: "aborted", message: "" } as SpeechRecognitionErrorEvent);
      this.onend?.();
    });
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}

class FakeUtterance {
  text: string;
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

describe("localized speech", () => {
  afterEach(() => {
    stopAudio();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("configures recognition for the selected language", async () => {
    let recognition: FakeRecognition | undefined;
    class Recognition extends FakeRecognition {
      constructor() {
        super();
        recognition = this;
      }
    }
    window.SpeechRecognition = Recognition as unknown as SpeechRecognitionConstructor;

    await expect(listenOnce("en")).resolves.toBe("test");
    expect(recognition?.lang).toBe("en-US");
    await expect(listenOnce("pt-BR")).resolves.toBe("test");
    expect(recognition?.lang).toBe("pt-BR");
  });

  it("preserves the native recognition error code and detail", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    class FailingRecognition extends FakeRecognition {
      start() {
        queueMicrotask(() => this.onerror?.({
          error: "audio-capture",
          message: "No audio input device",
        } as SpeechRecognitionErrorEvent));
      }
    }
    window.SpeechRecognition = FailingRecognition as unknown as SpeechRecognitionConstructor;

    const failure = await listenOnce("pt-BR").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SpeechRecognitionFailure);
    expect(failure).toMatchObject({ code: "audio-capture", detail: "No audio input device" });
    expect(getSpeechErrorCode(failure)).toBe("audio-capture");
    expect(warning).toHaveBeenCalledWith("Speech recognition failed", {
      code: "audio-capture",
      detail: "No audio input device",
    });
  });

  it("fully ends one recognition session before starting the next", async () => {
    let active = 0;
    let maximumActive = 0;
    let stops = 0;
    class SequentialRecognition extends FakeRecognition {
      start() {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        super.start();
      }
      stop() {
        stops += 1;
        queueMicrotask(() => {
          active -= 1;
          this.onend?.();
        });
      }
    }
    window.SpeechRecognition = SequentialRecognition as unknown as SpeechRecognitionConstructor;

    await expect(listenOnce("pt-BR")).resolves.toBe("test");
    await expect(listenOnce("pt-BR")).resolves.toBe("test");

    expect(stops).toBe(2);
    expect(maximumActive).toBe(1);
  });

  it("does not time out a long utterance after speech has started", async () => {
    vi.useFakeTimers();
    class LongRecognition extends FakeRecognition {
      start() {
        this.onstart?.();
        this.onaudiostart?.();
        window.setTimeout(() => this.onspeechstart?.(), 9_000);
        window.setTimeout(() => {
          this.onresult?.({ resultIndex: 0, results: { 0: { 0: { transcript: "five player names spoken slowly" } } } } as unknown as SpeechRecognitionEvent);
        }, 15_000);
      }
    }
    window.SpeechRecognition = LongRecognition as unknown as SpeechRecognitionConstructor;

    const result = listenOnce("en", 10_000);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(result).resolves.toBe("five player names spoken slowly");
  });

  it("reports an intentional interruption as aborted", async () => {
    class WaitingRecognition extends FakeRecognition {
      start() { this.onstart?.(); }
    }
    window.SpeechRecognition = WaitingRecognition as unknown as SpeechRecognitionConstructor;

    const result = listenOnce("en");
    await Promise.resolve();
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
