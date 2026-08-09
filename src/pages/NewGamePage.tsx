import { ArrowLeft, Mic, Plus, Trash2, Volume2 } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeSpeech } from "../domain/numbers";
import { parseSetupVoiceCommand } from "../domain/voiceParser";
import { listenOnce, speak, stopAudio, supportsRecognition } from "../speech";
import { useAppStore } from "../store";

type NameField = { id: string; name: string };

const newField = (name = ""): NameField => ({ id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, name });

function namesSpeech(names: string[]): string {
  return `${names.length} jogadores. ${names.join(". ")}. Diga confirmar, repetir, adicionar, remover ou corrigir um nome.`;
}

function validNames(fields: NameField[]): string[] | null {
  const names = fields.map((field) => field.name.trim()).filter(Boolean);
  if (names.length < 2) return null;
  const normalized = names.map(normalizeSpeech);
  return new Set(normalized).size === normalized.length ? names : null;
}

export default function NewGamePage() {
  const navigate = useNavigate();
  const { createGame } = useAppStore();
  const [fields, setFields] = useState<NameField[]>([newField(), newField()]);
  const [voiceMessage, setVoiceMessage] = useState("Diga os nomes em uma única frase");
  const [voiceActive, setVoiceActive] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);

  const commitGame = (names: string[]) => {
    const id = createGame(names);
    navigate(`/games/${encodeURIComponent(id)}`);
  };

  const startManually = () => {
    const names = validNames(fields);
    if (!names) {
      setError("Informe pelo menos dois nomes diferentes.");
      return;
    }
    commitGame(names);
  };

  const runVoiceSetup = async () => {
    if (running.current) {
      running.current = false;
      stopAudio();
      setVoiceActive(false);
      setVoiceMessage("Conversa encerrada");
      return;
    }
    if (!supportsRecognition()) {
      setError("A voz não está disponível neste navegador. Cadastre os jogadores abaixo.");
      return;
    }

    running.current = true;
    setVoiceActive(true);
    setError("");
    let currentNames = fields.map((field) => field.name.trim()).filter(Boolean);

    try {
      while (running.current) {
        setVoiceMessage("Ouvindo…");
        const transcript = await listenOnce();
        if (!running.current) break;
        setVoiceMessage(`“${transcript}”`);
        const command = parseSetupVoiceCommand(transcript, currentNames.length > 0);

        if (command.type === "cancel") {
          await speak("Cadastro cancelado.");
          break;
        }
        if (command.type === "confirm") {
          if (currentNames.length < 2) {
            await speak("Preciso de pelo menos dois jogadores. Diga os nomes novamente.");
            currentNames = [];
            continue;
          }
          if (new Set(currentNames.map(normalizeSpeech)).size !== currentNames.length) {
            await speak("Existem nomes repetidos. Corrija antes de confirmar.");
            continue;
          }
          await speak("Jogadores confirmados. Vamos começar.");
          commitGame(currentNames);
          return;
        }
        if (command.type === "repeat") {
          await speak(currentNames.length ? namesSpeech(currentNames) : "Ainda não entendi os jogadores. Diga todos os nomes.");
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
          await speak(currentNames.length ? "Não entendi. Diga confirmar, repetir, adicionar, remover ou corrigir." : "Diga todos os nomes dos jogadores.");
          continue;
        }

        setFields(currentNames.map(newField));
        await speak(namesSpeech(currentNames));
      }
    } catch (voiceError) {
      const code = voiceError instanceof Error ? voiceError.message : "";
      setError(code.includes("not-allowed") ? "Permita o microfone e verifique se a Siri está ativada." : "Não consegui ouvir. Você pode tentar novamente ou digitar os nomes.");
    } finally {
      running.current = false;
      stopAudio();
      setVoiceActive(false);
      setVoiceMessage("Diga os nomes em uma única frase");
    }
  };

  return (
    <main className="page setup-page">
      <header className="topbar">
        <button className="icon-button" aria-label="Voltar" onClick={() => navigate("/")}><ArrowLeft size={22} /></button>
        <span>Novo jogo</span>
        <span className="topbar-spacer" />
      </header>

      <section className="setup-hero">
        <p className="eyebrow">Quem vai jogar?</p>
        <h1>Cadastre por voz</h1>
        <p>Fale os nomes, confira ouvindo e diga “confirmar”.</p>
        <button className={`setup-mic ${voiceActive ? "active" : ""}`} onClick={() => void runVoiceSetup()}>
          <span className="mic-orbit"><Mic size={30} /></span>
          <span><strong>{voiceActive ? "Encerrar conversa" : "Dizer jogadores"}</strong><small>{voiceMessage}</small></span>
        </button>
        {!supportsRecognition() && <div className="voice-unavailable"><Volume2 size={18} /> Voz indisponível; use os campos abaixo.</div>}
      </section>

      <section className="manual-setup" aria-labelledby="players-title">
        <div className="section-heading compact">
          <div><p className="eyebrow">Conferência manual</p><h2 id="players-title">Jogadores</h2></div>
          <span className="count-badge">{fields.filter((field) => field.name.trim()).length}</span>
        </div>
        <div className="player-fields">
          {fields.map((field, index) => (
            <div className="player-field" key={field.id}>
              <span className="player-number">{index + 1}</span>
              <input
                aria-label={`Nome do jogador ${index + 1}`}
                placeholder="Nome"
                value={field.name}
                onChange={(event) => {
                  setFields((current) => current.map((item) => item.id === field.id ? { ...item, name: event.target.value } : item));
                  setError("");
                }}
              />
              <button className="icon-button danger-subtle" aria-label={`Remover jogador ${index + 1}`} disabled={fields.length <= 2} onClick={() => setFields((current) => current.filter((item) => item.id !== field.id))}>
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
        <button className="text-button" onClick={() => setFields((current) => [...current, newField()])}><Plus size={18} /> Adicionar jogador</button>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-button" onClick={startManually}>Começar jogo</button>
      </section>
    </main>
  );
}
