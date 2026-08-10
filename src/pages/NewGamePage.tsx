import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LanguageSelect } from "../components/LanguageSelect";
import { ThemeSelect } from "../components/ThemeSelect";
import { VoiceModelStatus } from "../components/VoiceModelStatus";
import { normalizeSpeech } from "../domain/numbers";
import { parseSetupVoiceCommand } from "../domain/voiceParser";
import { useI18n, type Messages } from "../i18n";
import { useVoiceModel } from "../localTranscription";
import { finishListening, getSpeechErrorCode, listenOnce, speak, stopAudio, supportsRecognition } from "../speech";
import { useAppStore } from "../store";

type NameField = { id: string; name: string };

const newField = (name = ""): NameField => ({ id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, name });

function validNames(fields: NameField[]): string[] | null {
  const names = fields.map((field) => field.name.trim()).filter(Boolean);
  if (names.length < 2) return null;
  const normalized = names.map(normalizeSpeech);
  return new Set(normalized).size === normalized.length ? names : null;
}

function setupSpeechError(code: string, messages: Messages): string {
  if (code.includes("not-allowed") || code.includes("service-not-allowed")) return messages.setup.permissionSpeechError(code);
  if (code === "no-speech") return messages.setup.noSpeechError;
  if (code === "audio-capture") return messages.setup.audioCaptureError;
  if (code === "network") return messages.setup.networkSpeechError;
  if (code === "aborted") return messages.setup.interruptedSpeechError;
  if (code === "language-not-supported") return messages.setup.languageSpeechError;
  return messages.setup.unknownSpeechError(code);
}

export default function NewGamePage() {
  const navigate = useNavigate();
  const { locale, messages } = useI18n();
  const { createGame } = useAppStore();
  const [fields, setFields] = useState<NameField[]>([newField(), newField()]);
  const [voiceMessage, setVoiceMessage] = useState(messages.setup.namesHint);
  const [voiceActive, setVoiceActive] = useState(false);
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState("");
  const voiceModel = useVoiceModel();
  const running = useRef(false);

  useEffect(() => {
    if (running.current) {
      running.current = false;
      stopAudio();
      setVoiceActive(false);
    }
    setVoiceMessage(messages.setup.namesHint);
  }, [locale, messages]);

  const commitGame = (names: string[]) => {
    const id = createGame(names);
    navigate(`/games/${encodeURIComponent(id)}`);
  };

  const startManually = () => {
    const names = validNames(fields);
    if (!names) {
      setError(messages.setup.needTwoUnique);
      return;
    }
    commitGame(names);
  };

  const runVoiceSetup = async () => {
    if (running.current) {
      running.current = false;
      stopAudio();
      setVoiceActive(false);
      setVoiceMessage(messages.setup.conversationEnded);
      return;
    }
    if (!supportsRecognition()) {
      setError(messages.setup.voiceUnavailableLong);
      return;
    }

    running.current = true;
    setVoiceActive(true);
    setError("");
    let currentNames = fields.map((field) => field.name.trim()).filter(Boolean);
    let capturesThisActivation = 0;
    let pausedForGesture = false;

    try {
      while (running.current) {
        if (capturesThisActivation > 0) {
          pausedForGesture = true;
          setVoiceMessage(messages.setup.tapToContinue);
          break;
        }
        setVoiceMessage(messages.setup.startingMicrophone);
        let transcript: string;
        try {
          transcript = await listenOnce(
            locale,
            10_000,
            [],
            () => setVoiceMessage(messages.setup.listening),
            setVolume,
            (partial) => setVoiceMessage(`“${partial}”`),
          );
          capturesThisActivation += 1;
        } catch (voiceError) {
          throw voiceError;
        }
        if (!running.current) break;
        setVoiceMessage(`“${transcript}”`);
        const command = parseSetupVoiceCommand(transcript, currentNames.length > 0, locale);

        if (command.type === "cancel") {
          await speak(messages.setup.setupCancelled, locale);
          break;
        }
        if (command.type === "confirm") {
          if (currentNames.length < 2) {
            await speak(messages.setup.needTwoPlayersSpeech, locale);
            currentNames = [];
            continue;
          }
          if (new Set(currentNames.map(normalizeSpeech)).size !== currentNames.length) {
            await speak(messages.setup.duplicateNamesSpeech, locale);
            continue;
          }
          await speak(messages.setup.playersConfirmed, locale);
          commitGame(currentNames);
          return;
        }
        if (command.type === "repeat") {
          await speak(currentNames.length ? messages.setup.playersSpeech(currentNames) : messages.setup.noPlayersYet, locale);
          continue;
        }
        if (command.type === "names") currentNames = command.names;
        if (command.type === "add") currentNames = [...currentNames, command.name];
        if (command.type === "remove") {
          const target = normalizeSpeech(command.name);
          currentNames = currentNames.filter((name) => normalizeSpeech(name) !== target);
        }
        if (command.type === "rename") {
          const target = normalizeSpeech(command.from);
          currentNames = currentNames.map((name) => normalizeSpeech(name) === target ? command.to : name);
        }
        if (command.type === "unknown") {
          await speak(currentNames.length ? messages.setup.unknownWithNames : messages.setup.sayAllNames, locale);
          continue;
        }

        setFields(currentNames.map(newField));
        pausedForGesture = true;
        break;
      }
    } catch (voiceError) {
      const code = getSpeechErrorCode(voiceError);
      if (running.current || code !== "aborted") setError(setupSpeechError(code, messages));
    } finally {
      running.current = false;
      stopAudio();
      setVolume(0);
      setVoiceActive(false);
      setVoiceMessage(pausedForGesture ? messages.setup.tapToContinue : messages.setup.namesHint);
    }
  };

  return (
    <main className="page setup-page">
      <header className="topbar">
        <button className="text-action" onClick={() => navigate("/")}>{messages.common.back}</button>
        <span>{messages.setup.newGame}</span>
        <div className="preference-selects">
          <LanguageSelect />
          <ThemeSelect />
        </div>
      </header>

      <section className="setup-hero">
        <p className="eyebrow">{messages.setup.whoIsPlaying}</p>
        <h1>{messages.setup.registerByVoice}</h1>
        <p>{messages.setup.voiceDescription}</p>
        <button
          className={`setup-mic ${voiceActive ? "active" : ""}`}
          disabled={voiceModel.phase !== "ready"}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            void runVoiceSetup();
          }}
          onPointerUp={(event) => { event.preventDefault(); finishListening(); }}
          onPointerCancel={() => { stopAudio(); }}
          onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !event.repeat) void runVoiceSetup(); }}
          onKeyUp={(event) => { if (event.key === "Enter" || event.key === " ") finishListening(); }}
        >
          <span><strong>{voiceActive ? messages.setup.endConversation : messages.setup.tellPlayers}</strong><small>{voiceMessage}</small></span>
          <span className="mic-volume" aria-hidden="true"><span style={{ transform: `scaleX(${volume})` }} /></span>
        </button>
        <VoiceModelStatus status={voiceModel} />
        {!supportsRecognition() && <div className="voice-unavailable">{messages.setup.voiceUnavailable}</div>}
      </section>

      <section className="manual-setup" aria-labelledby="players-title">
        <div className="section-heading compact">
          <div><p className="eyebrow">{messages.setup.manualReview}</p><h2 id="players-title">{messages.setup.players}</h2></div>
          <span className="count-badge">{fields.filter((field) => field.name.trim()).length}</span>
        </div>
        <div className="player-fields">
          {fields.map((field, index) => (
            <div className="player-field" key={field.id}>
              <span className="player-number">{index + 1}</span>
              <input
                aria-label={messages.setup.playerNameLabel(index + 1)}
                placeholder={messages.setup.namePlaceholder}
                value={field.name}
                onChange={(event) => {
                  setFields((current) => current.map((item) => item.id === field.id ? { ...item, name: event.target.value } : item));
                  setError("");
                }}
              />
              <button className="text-action danger-subtle" aria-label={messages.setup.removePlayerLabel(index + 1)} disabled={fields.length <= 2} onClick={() => setFields((current) => current.filter((item) => item.id !== field.id))}>{messages.common.delete}</button>
            </div>
          ))}
        </div>
        <button className="text-button" onClick={() => setFields((current) => [...current, newField()])}>{messages.setup.addPlayer}</button>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-button" onClick={startManually}>{messages.setup.startGame}</button>
      </section>
    </main>
  );
}
