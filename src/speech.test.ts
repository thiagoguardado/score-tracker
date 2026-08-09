import { afterEach, describe, expect, it, vi } from "vitest";
import { listenOnce, speak } from "./speech";

class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  start() {
    queueMicrotask(() => this.onresult?.({ resultIndex: 0, results: { 0: { 0: { transcript: "test" } } } } as unknown as SpeechRecognitionEvent));
  }
  stop() {}
  abort() {}
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
  afterEach(() => vi.unstubAllGlobals());

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
