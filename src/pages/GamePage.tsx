import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { LanguageSelect } from "../components/LanguageSelect";
import { ThemeSelect } from "../components/ThemeSelect";
import { rankingFor, shareText } from "../domain/ranking";
import { useVoiceConversation } from "../hooks/useVoiceConversation";
import { useWakeLock } from "../hooks/useWakeLock";
import { useI18n, type Locale, type Messages } from "../i18n";
import { useAppStore } from "../store";
import type { Game, PlayerId, Round, VoicePhase } from "../types";

type Panel = "ranking" | "history" | "players";

function formatGameDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function ordinal(position: number, locale: Locale): string {
  if (locale === "pt-BR") return `${position}º`;
  const suffix = position % 100 >= 11 && position % 100 <= 13 ? "th"
    : position % 10 === 1 ? "st" : position % 10 === 2 ? "nd" : position % 10 === 3 ? "rd" : "th";
  return `${position}${suffix}`;
}

function phaseLabel(phase: VoicePhase, messages: Messages): string {
  const labels: Record<VoicePhase, string> = {
    idle: messages.voice.phase.idle,
    starting: messages.voice.phase.starting,
    listening: messages.voice.phase.listening,
    parsing: messages.voice.phase.parsing,
    "speaking-review": messages.voice.phase.speakingReview,
    "awaiting-decision": messages.voice.phase.awaitingDecision,
    applying: messages.voice.phase.applying,
    "speaking-ranking": messages.voice.phase.speakingRanking,
    error: messages.voice.phase.error,
  };
  return labels[phase];
}

function scoreRecord(game: Game, initial?: Record<PlayerId, number>): Record<PlayerId, number> {
  return Object.fromEntries(game.players.map((player) => [player.id, initial?.[player.id] ?? 0]));
}

function scoreInputRecord(game: Game, initial?: Record<PlayerId, number>): Record<PlayerId, string> {
  return Object.fromEntries(Object.entries(scoreRecord(game, initial)).map(([playerId, score]) => [playerId, String(score)]));
}

function ScoreForm({ game, initial, title, onSave, onClose }: {
  game: Game;
  initial?: Record<PlayerId, number>;
  title: string;
  onSave: (scores: Record<PlayerId, number>) => void;
  onClose: () => void;
}) {
  const { messages } = useI18n();
  const [scoreInputs, setScoreInputs] = useState(() => scoreInputRecord(game, initial));
  const scoresAreValid = game.players.every((player) => /^-?\d+$/.test(scoreInputs[player.id] ?? ""));
  const save = () => {
    if (!scoresAreValid) return;
    onSave(Object.fromEntries(game.players.map((player) => [player.id, Number.parseInt(scoreInputs[player.id], 10)])));
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="score-form-title">
        <div className="sheet-header">
          <div><p className="eyebrow">{messages.game.manualEntry}</p><h2 id="score-form-title">{title}</h2></div>
          <button className="text-action" onClick={onClose}>{messages.common.close}</button>
        </div>
        <div className="score-fields">
          {game.players.map((player) => (
            <label className="score-field" key={player.id}>
              <span>{player.name}</span>
              <input
                inputMode="text"
                type="text"
                pattern="-?[0-9]*"
                autoComplete="off"
                aria-invalid={!/^-?\d+$/.test(scoreInputs[player.id] ?? "")}
                value={scoreInputs[player.id]}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  if (/^-?\d*$/.test(value)) setScoreInputs((current) => ({ ...current, [player.id]: value }));
                }}
              />
            </label>
          ))}
        </div>
        <button className="primary-button" disabled={!scoresAreValid} onClick={save}>{messages.game.confirmRound}</button>
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
  const { messages } = useI18n();
  const [editing, setEditing] = useState<Round | null>(null);
  if (game.rounds.length === 0) {
    return <div className="panel-empty"><h3>{messages.game.noRounds}</h3><p>{messages.game.noRoundsDescription}</p></div>;
  }
  return (
    <div className="round-list">
      {[...game.rounds].reverse().map((round, reverseIndex) => {
        const number = game.rounds.length - reverseIndex;
        return (
          <article className="round-card" key={round.id}>
            <div className="round-card-header">
              <div><span className="round-number">R{number}</span><small>{round.source === "voice" ? messages.common.byVoice : messages.common.manual}</small></div>
              {canEdit && <div className="row-actions">
                <button className="text-action" aria-label={messages.game.editRoundLabel(number)} onClick={() => setEditing(round)}>{messages.common.edit}</button>
                <button className="text-action danger-subtle" aria-label={messages.game.deleteRoundLabel(number)} onClick={() => {
                  if (window.confirm(messages.game.deleteRoundConfirm(number))) deleteRound(round.id);
                }}>{messages.common.delete}</button>
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
        title={messages.game.editRound}
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
  const { locale, messages } = useI18n();
  const [newName, setNewName] = useState("");
  const [draftNames, setDraftNames] = useState<Record<PlayerId, string>>(() => Object.fromEntries(game.players.map((player) => [player.id, player.name])));
  useEffect(() => {
    setDraftNames((current) => Object.fromEntries(game.players.map((player) => [player.id, current[player.id] ?? player.name])));
  }, [game.players]);
  return (
    <div className="players-panel">
      <p className="panel-note">{messages.game.playersNote}</p>
      <div className="manage-player-list">
        {game.players.map((player, index) => (
          <div className="manage-player" key={player.id}>
            <span className="player-number">{index + 1}</span>
            <input
              aria-label={messages.game.playerNameLabel(player.name)}
              value={draftNames[player.id] ?? player.name}
              disabled={!canEdit}
              onChange={(event) => setDraftNames((current) => ({ ...current, [player.id]: event.target.value }))}
              onBlur={(event) => {
                const name = event.target.value.trim();
                const duplicate = game.players.some((candidate) => candidate.id !== player.id && candidate.name.localeCompare(name, locale, { sensitivity: "base" }) === 0);
                if (!name || duplicate) setDraftNames((current) => ({ ...current, [player.id]: player.name }));
                else {
                  renamePlayer(player.id, name);
                  setDraftNames((current) => ({ ...current, [player.id]: name }));
                }
              }}
            />
            {canEdit && <button className="text-action danger-subtle" aria-label={messages.game.removePlayerLabel(player.name)} disabled={game.players.length <= 2} onClick={() => {
              if (window.confirm(messages.game.removePlayerConfirm(player.name))) removePlayer(player.id);
            }}>{messages.common.delete}</button>}
          </div>
        ))}
      </div>
      {canEdit && <form className="add-player-form" onSubmit={(event) => {
        event.preventDefault();
        const name = newName.trim();
        if (!name) return;
        if (game.players.some((player) => player.name.localeCompare(name, locale, { sensitivity: "base" }) === 0)) return;
        addPlayer(name);
        setNewName("");
      }}>
        <input aria-label={messages.game.newPlayer} placeholder={messages.game.newPlayer} value={newName} onChange={(event) => setNewName(event.target.value)} />
        <button className="secondary-button" type="submit">{messages.game.addPlayer}</button>
      </form>}
    </div>
  );
}

export default function GamePage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { locale, messages } = useI18n();
  const { state, addRound, updateRound, deleteRound, renamePlayer, addPlayer, removePlayer, finishGame } = useAppStore();
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

  const emptyGame: Game = { id: "", startedAt: "", status: "active", players: [], rounds: [] };
  const voice = useVoiceConversation({ game: game ?? emptyGame, locale, onAddRound, onDeleteRound, onFinish });
  const wake = useWakeLock(Boolean(game && game.status === "active" && wakeEnabled));
  const ranking = useMemo(() => game ? rankingFor(game, game.rounds, locale) : [], [game, locale]);

  if (!game) return <Navigate to="/" replace />;
  const canEdit = game.status === "active" || editingFinished;
  const voiceActive = !voice.waitingForTap && voice.status.phase !== "idle" && voice.status.phase !== "error";

  const share = async () => {
    const text = shareText(game, locale);
    try {
      if (navigator.share) {
        await navigator.share({ title: messages.share.title, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setToast(messages.game.resultCopied);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(text);
        setToast(messages.game.resultCopied);
      } catch {
        setToast(messages.game.shareFailed);
      }
    }
    window.setTimeout(() => setToast(""), 2500);
  };

  const panelTitle = panel === "ranking" ? messages.game.ranking : panel === "history" ? messages.game.rounds : messages.game.players;
  const currentPhase = phaseLabel(voice.status.phase, messages);

  return (
    <main className={`game-page ${game.status === "finished" ? "finished" : ""}`}>
      <header className="game-topbar">
        <button className="text-action on-dark" onClick={() => navigate("/")}>{messages.home.history}</button>
        <div className="game-title"><small>{game.status === "active" ? messages.game.active : messages.game.finalResult}</small><strong>{formatGameDate(game.startedAt, locale)}</strong></div>
        <div className="game-topbar-actions">
          <LanguageSelect onDark />
          <ThemeSelect onDark />
          {game.status === "active" && (
            <button className={`wake-button ${wake.active ? "active" : ""}`} aria-label={wakeEnabled ? messages.game.keepScreenAwakeOff : messages.game.keepScreenAwakeOn} onClick={() => setWakeEnabled((value) => !value)}>
              {wakeEnabled ? messages.game.screenOn : messages.game.screenOff}
            </button>
          )}
        </div>
      </header>

      <section className="scoreboard-shell">
        <div className="scoreboard-heading">
          <div><p className="eyebrow">{messages.game.roundCount(game.rounds.length)}</p><h1>{panelTitle}</h1></div>
        </div>

        {panel === "ranking" && <div className="ranking-list" aria-label={messages.game.currentRanking}>
          {ranking.map(({ player, total, position }, index) => (
            <article className={`ranking-row place-${position}`} key={player.id}>
              <span className="rank-position">{index === 0 && game.rounds.length > 0 && <span className="leader-emoji" aria-hidden="true">🏆</span>}{ordinal(position, locale)}</span>
              <span className="rank-name"><strong>{player.name}</strong>{index === 0 && game.rounds.length > 0 && <small>{messages.game.leading}</small>}</span>
              <strong className="rank-score">{total}</strong>
            </article>
          ))}
        </div>}

        {panel === "history" && <HistoryPanel game={game} canEdit={canEdit} updateRound={(roundId, scores) => updateRound(game.id, roundId, scores)} deleteRound={(roundId) => deleteRound(game.id, roundId)} />}
        {panel === "players" && <PlayersPanel game={game} canEdit={canEdit} renamePlayer={(playerId, name) => renamePlayer(game.id, playerId, name)} addPlayer={(name) => addPlayer(game.id, name)} removePlayer={(playerId) => removePlayer(game.id, playerId)} />}

        {game.status === "active" && panel === "ranking" && <>
          <section className={`voice-card phase-${voice.status.phase}`} aria-live="polite">
            <div className="voice-status-line"><strong>{currentPhase}</strong></div>
            <p>{voice.status.message}</p>
            {voice.status.transcript && <blockquote>“{voice.status.transcript}”</blockquote>}
            {voice.status.draftScores && <div className="draft-score-chips">
              {game.players.map((player) => <span key={player.id}>{player.name} <strong>{voice.status.draftScores?.[player.id] ?? 0}</strong></span>)}
            </div>}
          </section>
          <aside className="command-help" aria-label={messages.game.commandHelpTitle}>
            <strong>{messages.game.commandHelpTitle}</strong>
            <span>{messages.game.commandHelp}</span>
          </aside>
        </>}

        {game.status === "finished" && panel === "ranking" && <div className="result-actions">
          <button className="primary-button" onClick={() => void share()}>{messages.game.shareResult}</button>
          <button className="secondary-button" onClick={() => setEditingFinished((value) => !value)}>{editingFinished ? messages.game.stopEditing : messages.game.editResult}</button>
        </div>}
      </section>

      {game.status === "active" && <div className="voice-dock">
        <button
          className={`main-mic ${voiceActive ? "active" : ""}`}
          aria-label={voiceActive ? messages.setup.endConversation : messages.game.talkToScoreboard}
          onClick={() => { void wake.request(); voice.activate(); }}
        >
          <span><span aria-hidden="true">🎙️</span> {voiceActive ? messages.game.stopVoice : messages.game.startVoice}</span>
        </button>
        <div><strong>{voiceActive ? currentPhase : messages.game.talkToScoreboard}</strong><small>{voice.supported ? messages.game.sayNamesAndScores : messages.game.voiceUnavailable}</small></div>
        <button className="manual-link" onClick={() => setManualOpen(true)}>{messages.game.type}</button>
      </div>}

      <nav className="game-nav" aria-label={messages.game.navigation}>
        <button className={panel === "ranking" ? "active" : ""} onClick={() => setPanel("ranking")}><span>{messages.game.ranking}</span></button>
        <button className={panel === "history" ? "active" : ""} onClick={() => setPanel("history")}><span>{messages.game.rounds}</span></button>
        <button className={panel === "players" ? "active" : ""} onClick={() => setPanel("players")}><span>{messages.game.players}</span></button>
        {game.status === "active" && <button className="finish-nav" onClick={() => {
          if (window.confirm(messages.game.finishConfirm)) finishGame(game.id);
        }}><span>{messages.game.finish}</span></button>}
      </nav>

      {manualOpen && <ScoreForm game={game} title={messages.game.addRound} onClose={() => setManualOpen(false)} onSave={(scores) => { addRound(game.id, scores, "manual"); setManualOpen(false); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
