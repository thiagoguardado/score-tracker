import { afterEach, describe, expect, it, vi } from "vitest";
import { finishListening, getSpeechErrorCode, listenOnce, releaseMicrophoneCapture, speak, SpeechCaptureFailure, SpeechRecognitionFailure, stopAudio, supportsRecognition } from "./speech";

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
  startedAt = 0;
  start() {
    this.startedAt = Date.now();
    queueMicrotask(() => {
      this.onstart?.();
      this.onaudiostart?.();
      this.onsoundstart?.();
      this.onspeechstart?.();
      // default final result
      this.onresult?.({
        resultIndex: 0,
        results: {
          0: { 0: { transcript: "Alex ten Sam seven" }, length: 1, isFinal: true } as unknown as SpeechRecognitionResult,
          length: 1,
        },
      } as unknown as SpeechRecognitionEvent);
    });
  }
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {
    queueMicrotask(() => {
      this.onerror?.({ error: "aborted", message: "" } as unknown as SpeechRecognitionErrorEvent);
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
  constructor(text: string) { this.text = text; }
}

describe("native speech — iOS-hardened", () => {
  afterEach(() => {
    stopAudio();
    releaseMicrophoneCapture();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });

  it("supportsRecognition is false without Web Speech API", () => {
    expect(supportsRecognition()).toBe(false);
  });

  it("configures recognition for the selected language", async () => {
    let recognition: FakeRecognition | undefined;
    class Recognition extends FakeRecognition {
      constructor() { super(); recognition = this; }
    }
    window.SpeechRecognition = Recognition as unknown as SpeechRecognitionConstructor;
    await expect(listenOnce("en")).resolves.toBe("Alex ten Sam seven");
    expect(recognition?.lang).toBe("en-US");
    await expect(listenOnce("pt-BR")).resolves.toBe("Alex ten Sam seven");
    expect(recognition?.lang).toBe("pt-BR");
  });

  it("does not require getUserMedia — no orange-dot contention", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    class Recognition extends FakeRecognition {}
    window.SpeechRecognition = Recognition as unknown as SpeechRecognitionConstructor;
    await expect(listenOnce("en")).resolves.toBe("Alex ten Sam seven");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("uses push-to-talk: finishListening triggers stop and resolves", async () => {
    class HoldRecognition extends FakeRecognition {
      start() {
        queueMicrotask(() => { this.onstart?.(); this.onaudiostart?.(); });
      }
      stop() { queueMicrotask(() => this.onend?.()); }
    }
    window.SpeechRecognition = HoldRecognition as unknown as SpeechRecognitionConstructor;
    const onCaptureStart = vi.fn();
    const promise = listenOnce("en", 10_000, [], onCaptureStart);
    await vi.waitFor(() => expect(onCaptureStart).toHaveBeenCalled());
    stopAudio();
    await expect(promise).rejects.toMatchObject({ code: "aborted" });

    // Now test successful hold until release
    class SuccessHold extends FakeRecognition {
      resultSent = false;
      start() { queueMicrotask(() => { this.onstart?.(); this.onaudiostart?.(); }); }
      stop() {
        if (!this.resultSent) {
          this.resultSent = true;
          this.onresult?.({
            resultIndex: 0,
            results: { 0: { 0: { transcript: "Mario five" }, length: 1, isFinal: true } as unknown as SpeechRecognitionResult, length: 1 },
          } as unknown as SpeechRecognitionEvent);
        }
        queueMicrotask(() => this.onend?.());
      }
    }
    window.SpeechRecognition = SuccessHold as unknown as SpeechRecognitionConstructor;
    const success = listenOnce("en", 10_000, [], vi.fn());
    await new Promise((r) => setTimeout(r, 0));
    finishListening();
    await expect(success).resolves.toBe("Mario five");
  });

  it("emits interim transcripts while held", async () => {
    class InterimRecognition extends FakeRecognition {
      start() {
        queueMicrotask(() => {
          this.onstart?.();
          this.onaudiostart?.();
          this.onresult?.({
            resultIndex: 0,
            results: { 0: { 0: { transcript: "Alex" }, length: 1, isFinal: false } as unknown as SpeechRecognitionResult, length: 1 },
          } as unknown as SpeechRecognitionEvent);
          setTimeout(() => {
            this.onresult?.({
              resultIndex: 0,
              results: { 0: { 0: { transcript: "Alex ten" }, length: 1, isFinal: true } as unknown as SpeechRecognitionResult, length: 1 },
            } as unknown as SpeechRecognitionEvent);
          }, 10);
        });
      }
    }
    window.SpeechRecognition = InterimRecognition as unknown as SpeechRecognitionConstructor;
    const onInterim = vi.fn();
    const result = listenOnce("en", 10_000, [], vi.fn(), vi.fn(), onInterim);
    await expect(result).resolves.toBe("Alex ten");
    expect(onInterim).toHaveBeenCalledWith("Alex");
  });

  it("preserves the native recognition error code and detail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    class FailingRecognition extends FakeRecognition {
      start() { queueMicrotask(() => this.onerror?.({ error: "audio-capture", message: "No audio input device" } as unknown as SpeechRecognitionErrorEvent)); }
    }
    window.SpeechRecognition = FailingRecognition as unknown as SpeechRecognitionConstructor;
    const failure = await listenOnce("pt-BR").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SpeechRecognitionFailure);
    expect(failure).toMatchObject({ code: "audio-capture", detail: "No audio input device" });
    expect(getSpeechErrorCode(failure)).toBe("audio-capture");
    expect(warn).toHaveBeenCalledWith("Speech recognition failed", { code: "audio-capture", detail: "No audio input device" });
  });

  it("fully ends one recognition session before starting the next (no overlap)", async () => {
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
        queueMicrotask(() => { active -= 1; this.onend?.(); });
      }
    }
    window.SpeechRecognition = SequentialRecognition as unknown as SpeechRecognitionConstructor;
    await expect(listenOnce("pt-BR")).resolves.toBe("Alex ten Sam seven");
    await expect(listenOnce("pt-BR")).resolves.toBe("Alex ten Sam seven");
    expect(stops).toBe(2);
    expect(maximumActive).toBe(1);
  });

  it("prefers an alternative transcript containing a known player name", async () => {
    let recognition: FakeRecognition | undefined;
    class AlternativeRecognition extends FakeRecognition {
      constructor() { super(); recognition = this; }
      start() {
        queueMicrotask(() => this.onresult?.({
          resultIndex: 0,
          results: {
            0: { 0: { transcript: "Maria cinco" }, 1: { transcript: "Mário cinco" }, length: 2, isFinal: true } as unknown as SpeechRecognitionResult,
            length: 1,
          },
        } as unknown as SpeechRecognitionEvent));
      }
    }
    window.SpeechRecognition = AlternativeRecognition as unknown as SpeechRecognitionConstructor;
    await expect(listenOnce("pt-BR", 10_000, ["Mário"])).resolves.toBe("Mário cinco");
    expect(recognition?.maxAlternatives).toBe(5);
  });

  it("does not time out a long utterance after speech has started", async () => {
    vi.useFakeTimers();
    class LongRecognition extends FakeRecognition {
      start() {
        this.onstart?.();
        this.onaudiostart?.();
        setTimeout(() => this.onspeechstart?.(), 9_000);
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: { 0: { 0: { transcript: "five player names spoken slowly" }, length: 1, isFinal: true } as unknown as SpeechRecognitionResult, length: 1 },
          } as unknown as SpeechRecognitionEvent);
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

  it("accepts SpeechCaptureFailure alias for backward compat", () => {
    const e = new SpeechCaptureFailure("aborted", "test");
    expect(getSpeechErrorCode(e)).toBe("aborted");
  });

  it("configures synthesis for the selected language and cancels any active recognition", async () => {
    let utterance: FakeUtterance | undefined;
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: vi.fn(),
        getVoices: vi.fn(() => []),
        speak: vi.fn((next: FakeUtterance) => { utterance = next; queueMicrotask(() => next.onend?.()); }),
      },
    });
    class WaitingRecognition extends FakeRecognition { start() { this.onstart?.(); } }
    window.SpeechRecognition = WaitingRecognition as unknown as SpeechRecognitionConstructor;
    const listening = listenOnce("en");
    const listeningExpect = expect(listening).rejects.toMatchObject({ code: "aborted" });
    await Promise.resolve();
    await speak("Hello", "en");
    expect(utterance?.lang).toBe("en-US");
    await listeningExpect;
    await speak("Olá", "pt-BR");
    expect(utterance?.lang).toBe("pt-BR");
  });
});
