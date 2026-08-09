import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LanguageSelect } from "../components/LanguageSelect";
import { useI18n } from "../i18n";

type DiagnosticEntry = {
  id: number;
  elapsed: number;
  event: string;
  detail?: string;
};

export default function VoiceDiagnosticsPage() {
  const navigate = useNavigate();
  const { locale } = useI18n();
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);
  const [running, setRunning] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const attemptRef = useRef(0);
  const copy = locale === "pt-BR" ? {
    back: "Voltar",
    eyebrow: "Diagnóstico isolado",
    title: "Teste do microfone",
    description: "Este teste usa somente o reconhecimento nativo do navegador. Nenhum áudio ou resultado é armazenado.",
    start: "Iniciar teste",
    stop: "Parar teste",
    clear: "Limpar eventos",
    unavailable: "O navegador não expõe o reconhecimento de voz.",
    empty: "Toque em Iniciar teste, fale uma frase curta e aguarde o evento end.",
  } : {
    back: "Back",
    eyebrow: "Isolated diagnostics",
    title: "Microphone test",
    description: "This test uses only the browser's native speech recognition. No audio or result is stored.",
    start: "Start test",
    stop: "Stop test",
    clear: "Clear events",
    unavailable: "This browser does not expose speech recognition.",
    empty: "Tap Start test, say a short sentence, and wait for the end event.",
  };

  useEffect(() => () => recognitionRef.current?.abort(), []);

  const start = () => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) return;

    const attempt = ++attemptRef.current;
    const startedAt = performance.now();
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = locale === "pt-BR" ? "pt-BR" : "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 5;

    const record = (event: string, detail?: string) => {
      setEntries((current) => [...current, {
        id: current.length + 1,
        elapsed: Math.round(performance.now() - startedAt),
        event: `#${attempt} ${event}`,
        detail,
      }]);
    };

    ["start", "audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend"].forEach((eventName) => {
      recognition.addEventListener(eventName, () => record(eventName));
    });
    recognition.addEventListener("result", (event) => {
      const result = (event as SpeechRecognitionEvent).results[(event as SpeechRecognitionEvent).resultIndex];
      record("result", result?.[0]?.transcript ?? "");
    });
    recognition.addEventListener("error", (event) => {
      const error = event as SpeechRecognitionErrorEvent;
      record("error", `${error.error}${error.message ? `: ${error.message}` : ""}`);
    });
    recognition.addEventListener("end", () => {
      record("end");
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setRunning(false);
    });

    setRunning(true);
    record("constructed");
    try {
      recognition.start();
      record("start() returned");
    } catch (error) {
      record("start() threw", error instanceof Error ? error.message : String(error));
      recognitionRef.current = null;
      setRunning(false);
    }
  };

  const supported = Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  return (
    <main className="page diagnostics-page">
      <header className="topbar">
        <button className="text-action" onClick={() => navigate(-1)}>{copy.back}</button>
        <span>{copy.title}</span>
        <LanguageSelect />
      </header>
      <section className="diagnostics-hero">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <button className={`primary-button ${running ? "active" : ""}`} disabled={!supported} onClick={start}>{running ? copy.stop : copy.start}</button>
        {!supported && <div className="form-error">{copy.unavailable}</div>}
      </section>
      <section className="diagnostics-events">
        <div className="section-heading compact">
          <h2>Events</h2>
          <button className="text-action" onClick={() => setEntries([])}>{copy.clear}</button>
        </div>
        {entries.length === 0 ? <p>{copy.empty}</p> : <ol>
          {entries.map((entry) => <li key={entry.id}>
            <time>{entry.elapsed} ms</time>
            <strong>{entry.event}</strong>
            {entry.detail && <span>{entry.detail}</span>}
          </li>)}
        </ol>}
        <small>{navigator.userAgent}</small>
      </section>
    </main>
  );
}
