import {
  ArrowLeft, Check, ChevronRight, ClipboardList, History, Mic, Moon, Pencil,
  Plus, Share2, Square, Sun, Trash2, Trophy, Users, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { rankingFor, shareText } from "../domain/ranking";
import { useVoiceConversation } from "../hooks/useVoiceConversation";
import { useWakeLock } from "../hooks/useWakeLock";
import { useAppStore } from "../store";
import type { Game, PlayerId, Round, VoicePhase } from "../types";

type Panel = "ranking" | "history" | "players";

const phaseCopy: Record<VoicePhase, string> = {
  idle: "Pronto para ouvir",
  listening: "Ouvindo",
  parsing: "Conferindo",
  "speaking-review": "Falando",
  "awaiting-decision": "Aguardando confirmação",
  applying: "Salvando",
  "speaking-ranking": "Lendo ranking",
  error: "A voz precisa de atenção",
};

function formatGameDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function scoreRecord(game: Game, initial?: Record<PlayerId, number>): Record<PlayerId, number> {
  return Object.fromEntries(game.players.map((player) => [player.id, initial?.[player.id] ?? 0]));
}

function ScoreForm({ game, initial, title, onSave, onClose }: {
  game: Game;
  initial?: Record<PlayerId, number>;
  title: string;
  onSave: (scores: Record<PlayerId, number>) => void;
  onClose: () => void;
}) {
  const [scores, setScores] = useState(() => scoreRecord(game, initial));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="score-form-title">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div><p className="eyebrow">Entrada manual</p><h2 id="score-form-title">{title}</h2></div>
          <button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={21} /></button>
        </div>
        <div className="score-fields">
          {game.players.map((player) => (
            <label className="score-field" key={player.id}>
              <span>{player.name}</span>
              <input
                inputMode="numeric"
                type="number"
                step="1"
                value={scores[player.id]}
                onChange={(event) => setScores((current) => ({ ...current, [player.id]: Number.parseInt(event.target.value || "0", 10) }))}
              />
            </label>
          ))}
        </div>
        <button className="primary-button" onClick={() => onSave(scores)}><Check size={19} /> Confirmar rodada</button>
      </section>
    </div>
  );
}

function HistoryPanel({ game, canEdit, updateRound, deleteRound }: {
  game: Game;
  canEdit: boolean;
  updateRound: (roundId: string, scores: Record<PlayerId, number>) => void;
  deleteRound: (roundId: string) => void;
}) {
  const [editing, setEditing] = useState<Round | null>(null);
  if (game.rounds.length === 0) {
    return <div className="panel-empty"><History size={28} /><h3>Nenhuma rodada ainda</h3><p>Use o microfone para lançar os primeiros pontos.</p></div>;
  }
  return (
    <div className="round-list">
      {[...game.rounds].reverse().map((round, reverseIndex) => {
        const number = game.rounds.length - reverseIndex;
        return (
          <article className="round-card" key={round.id}>
            <div className="round-card-header">
              <div><span className="round-number">R{number}</span><small>{round.source === "voice" ? "Por voz" : "Manual"}</small></div>
              {canEdit && <div className="row-actions">
                <button className="icon-button" aria-label={`Editar rodada ${number}`} onClick={() => setEditing(round)}><Pencil size={17} /></button>
                <button className="icon-button danger-subtle" aria-label={`Excluir rodada ${number}`} onClick={() => {
                  if (window.confirm(`Excluir a rodada ${number}? O ranking será recalculado.`)) deleteRound(round.id);
                }}><Trash2 size={17} /></button>
              </div>}
            </div>
            <div className="round-scores">
              {game.players.map((player) => <span key={player.id}><small>{player.name}</small><strong>{round.scores[player.id] ?? 0}</strong></span>)}
            </div>
          </article>
        );
      })}
      {editing && <ScoreForm
        game={game}
        initial={editing.scores}
        title="Editar rodada"
        onClose={() => setEditing(null)}
        onSave={(scores) => { updateRound(editing.id, scores); setEditing(null); }}
      />}
    </div>
  );
}

function PlayersPanel({ game, canEdit, renamePlayer, addPlayer, removePlayer }: {
  game: Game;
  canEdit: boolean;
  renamePlayer: (playerId: PlayerId, name: string) => void;
  addPlayer: (name: string) => void;
  removePlayer: (playerId: PlayerId) => void;
}) {
  const [newName, setNewName] = useState("");
  const [draftNames, setDraftNames] = useState<Record<PlayerId, string>>(() => Object.fromEntries(game.players.map((player) => [player.id, player.name])));
  useEffect(() => {
    setDraftNames((current) => Object.fromEntries(game.players.map((player) => [player.id, current[player.id] ?? player.name])));
  }, [game.players]);
  return (
    <div className="players-panel">
      <p className="panel-note">Renomear preserva o histórico. Um jogador novo começa com zero nas rodadas anteriores.</p>
      <div className="manage-player-list">
        {game.players.map((player, index) => (
          <div className="manage-player" key={player.id}>
            <span className="player-number">{index + 1}</span>
            <input
              aria-label={`Nome de ${player.name}`}
              value={draftNames[player.id] ?? player.name}
              disabled={!canEdit}
              onChange={(event) => setDraftNames((current) => ({ ...current, [player.id]: event.target.value }))}
              onBlur={(event) => {
                const name = event.target.value.trim();
                const duplicate = game.players.some((candidate) => candidate.id !== player.id && candidate.name.localeCompare(name, "pt-BR", { sensitivity: "base" }) === 0);
                if (!name || duplicate) {
                  setDraftNames((current) => ({ ...current, [player.id]: player.name }));
                } else {
                  renamePlayer(player.id, name);
                  setDraftNames((current) => ({ ...current, [player.id]: name }));
                }
              }}
            />
            {canEdit && <button className="icon-button danger-subtle" aria-label={`Remover ${player.name}`} disabled={game.players.length <= 2} onClick={() => {
              if (window.confirm(`Remover ${player.name}? As pontuações desse jogador serão excluídas desta partida.`)) removePlayer(player.id);
            }}><Trash2 size={17} /></button>}
          </div>
        ))}
      </div>
      {canEdit && <form className="add-player-form" onSubmit={(event) => {
        event.preventDefault();
        const name = newName.trim();
        if (!name) return;
        if (game.players.some((player) => player.name.localeCompare(name, "pt-BR", { sensitivity: "base" }) === 0)) return;
        addPlayer(name);
        setNewName("");
      }}>
        <input aria-label="Nome do novo jogador" placeholder="Novo jogador" value={newName} onChange={(event) => setNewName(event.target.value)} />
        <button className="secondary-button" type="submit"><Plus size={18} /> Adicionar</button>
      </form>}
    </div>
  );
}

export default function GamePage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const {
    state, addRound, updateRound, deleteRound, renamePlayer, addPlayer, removePlayer, finishGame,
  } = useAppStore();
  const game = state.games.find((item) => item.id === gameId);
  const [panel, setPanel] = useState<Panel>("ranking");
  const [manualOpen, setManualOpen] = useState(false);
  const [editingFinished, setEditingFinished] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(true);
  const [toast, setToast] = useState("");

  const onAddRound = useCallback((scores: Record<PlayerId, number>) => {
    if (game) addRound(game.id, scores, "voice");
  }, [addRound, game]);
  const onDeleteRound = useCallback((roundId: string) => {
    if (game) deleteRound(game.id, roundId);
  }, [deleteRound, game]);
  const onFinish = useCallback(() => {
    if (game) finishGame(game.id);
  }, [finishGame, game]);

  const voice = useVoiceConversation({ game: game ?? { id: "", startedAt: "", status: "active", players: [], rounds: [] }, onAddRound, onDeleteRound, onFinish });
  const wake = useWakeLock(Boolean(game && game.status === "active" && wakeEnabled));
  const ranking = useMemo(() => game ? rankingFor(game) : [], [game]);

  if (!game) return <Navigate to="/" replace />;
  const canEdit = game.status === "active" || editingFinished;
  const voiceActive = voice.status.phase !== "idle" && voice.status.phase !== "error";

  const share = async () => {
    const text = shareText(game);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Resultado da partida", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setToast("Resultado copiado");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(text);
        setToast("Resultado copiado");
      } catch {
        setToast("Não foi possível compartilhar");
      }
    }
    window.setTimeout(() => setToast(""), 2500);
  };

  return (
    <main className={`game-page ${game.status === "finished" ? "finished" : ""}`}>
      <header className="game-topbar">
        <button className="icon-button on-dark" aria-label="Voltar ao histórico" onClick={() => navigate("/")}><ArrowLeft size={22} /></button>
        <div className="game-title"><small>{game.status === "active" ? "Jogo em andamento" : "Resultado final"}</small><strong>{formatGameDate(game.startedAt)}</strong></div>
        {game.status === "active" ? (
          <button className={`wake-button ${wake.active ? "active" : ""}`} aria-label={wakeEnabled ? "Permitir que a tela apague" : "Manter a tela ligada"} onClick={() => setWakeEnabled((value) => !value)}>
            {wakeEnabled ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        ) : <span className="topbar-spacer" />}
      </header>

      <section className="scoreboard-shell">
        <div className="scoreboard-heading">
          <div><p className="eyebrow">{game.rounds.length} {game.rounds.length === 1 ? "rodada" : "rodadas"}</p><h1>{panel === "ranking" ? "Ranking" : panel === "history" ? "Rodadas" : "Jogadores"}</h1></div>
          {game.status === "finished" && <Trophy size={34} className="result-trophy" />}
        </div>

        {panel === "ranking" && <div className="ranking-list" aria-label="Ranking atual">
          {ranking.map(({ player, total, position }, index) => (
            <article className={`ranking-row place-${position}`} key={player.id}>
              <span className="rank-position">{position}<sup>º</sup></span>
              <span className="rank-avatar" aria-hidden="true">{player.name.slice(0, 1).toLocaleUpperCase("pt-BR")}</span>
              <span className="rank-name"><strong>{player.name}</strong>{index === 0 && game.rounds.length > 0 && <small>Na liderança</small>}</span>
              <strong className="rank-score">{total}</strong>
            </article>
          ))}
        </div>}

        {panel === "history" && <HistoryPanel
          game={game}
          canEdit={canEdit}
          updateRound={(roundId, scores) => updateRound(game.id, roundId, scores)}
          deleteRound={(roundId) => deleteRound(game.id, roundId)}
        />}

        {panel === "players" && <PlayersPanel
          game={game}
          canEdit={canEdit}
          renamePlayer={(playerId, name) => renamePlayer(game.id, playerId, name)}
          addPlayer={(name) => addPlayer(game.id, name)}
          removePlayer={(playerId) => removePlayer(game.id, playerId)}
        />}

        {game.status === "active" && panel === "ranking" && <section className={`voice-card phase-${voice.status.phase}`} aria-live="polite">
          <div className="voice-status-line"><span className="voice-pulse" /><strong>{phaseCopy[voice.status.phase]}</strong></div>
          <p>{voice.status.message}</p>
          {voice.status.transcript && <blockquote>“{voice.status.transcript}”</blockquote>}
          {voice.status.draftScores && <div className="draft-score-chips">
            {game.players.map((player) => <span key={player.id}>{player.name} <strong>{voice.status.draftScores?.[player.id] ?? 0}</strong></span>)}
          </div>}
        </section>}

        {game.status === "finished" && panel === "ranking" && <div className="result-actions">
          <button className="primary-button" onClick={() => void share()}><Share2 size={19} /> Compartilhar resultado</button>
          <button className="secondary-button" onClick={() => setEditingFinished((value) => !value)}><Pencil size={18} /> {editingFinished ? "Encerrar edição" : "Editar resultado"}</button>
        </div>}
      </section>

      {game.status === "active" && <div className="voice-dock">
        <button
          className={`main-mic ${voiceActive ? "active" : ""}`}
          aria-label={voiceActive ? "Interromper ou encerrar conversa" : "Falar com o placar"}
          onClick={() => { void wake.request(); voice.activate(); }}
        >
          <span className="mic-rings" aria-hidden="true" />
          {voiceActive ? <Square size={25} fill="currentColor" /> : <Mic size={31} />}
        </button>
        <div><strong>{voiceActive ? phaseCopy[voice.status.phase] : "Falar com o placar"}</strong><small>{voice.supported ? "Diga os nomes e os pontos" : "Voz indisponível neste navegador"}</small></div>
        <button className="manual-link" onClick={() => setManualOpen(true)}>Digitar</button>
      </div>}

      <nav className="game-nav" aria-label="Navegação do jogo">
        <button className={panel === "ranking" ? "active" : ""} onClick={() => setPanel("ranking")}><Trophy size={20} /><span>Ranking</span></button>
        <button className={panel === "history" ? "active" : ""} onClick={() => setPanel("history")}><ClipboardList size={20} /><span>Rodadas</span></button>
        <button className={panel === "players" ? "active" : ""} onClick={() => setPanel("players")}><Users size={20} /><span>Jogadores</span></button>
        {game.status === "active" && <button className="finish-nav" onClick={() => {
          if (window.confirm("Finalizar o jogo e congelar o resultado?")) finishGame(game.id);
        }}><ChevronRight size={20} /><span>Finalizar</span></button>}
      </nav>

      {manualOpen && <ScoreForm
        game={game}
        title="Adicionar rodada"
        onClose={() => setManualOpen(false)}
        onSave={(scores) => { addRound(game.id, scores, "manual"); setManualOpen(false); }}
      />}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
