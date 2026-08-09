import type { Locale } from "./i18n";

let activeRecognition: SpeechRecognition | null = null;
let speakingResolve: (() => void) | null = null;

const speechLocale = (locale: Locale) => locale === "pt-BR" ? "pt-BR" : "en-US";

export function supportsRecognition(): boolean {
  return typeof window !== "undefined" && Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
}

export function supportsSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stopAudio(): void {
  activeRecognition?.abort();
  activeRecognition = null;
  if (supportsSynthesis()) window.speechSynthesis.cancel();
  speakingResolve?.();
  speakingResolve = null;
}

export function listenOnce(locale: Locale, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      reject(new Error("speech-unavailable"));
      return;
    }

    const recognition = new Recognition();
    activeRecognition = recognition;
    recognition.lang = speechLocale(locale);
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      if (activeRecognition === recognition) activeRecognition = null;
    };
    const succeed = (transcript: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(transcript.trim());
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const timer = window.setTimeout(() => {
      recognition.abort();
      fail(new Error("speech-timeout"));
    }, timeoutMs);

    recognition.onresult = (event) => {
      const result = event.results[event.resultIndex]?.[0]?.transcript ?? "";
      if (result) succeed(result);
    };
    recognition.onerror = (event) => fail(new Error(event.error || "speech-error"));
    recognition.onend = () => {
      if (!settled) fail(new Error("speech-no-result"));
    };

    try {
      recognition.start();
    } catch (error) {
      fail(error instanceof Error ? error : new Error("speech-start-error"));
    }
  });
}

export function speak(text: string, locale: Locale): Promise<void> {
  return new Promise((resolve) => {
    if (!supportsSynthesis()) {
      resolve();
      return;
    }
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
      resolve();
    };
    speakingResolve = finish;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  });
}
