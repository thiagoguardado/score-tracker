import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { rankingFor, shareText } from "../domain/ranking";
import { useVoiceConversation } from "../hooks/useVoiceConversation";
import { useI18n, type Locale, type Messages } from "../i18n";
import { prepareVoiceModel, useVoiceModel } from "../localTranscription";
import { useAppStore } from "../store";
import { releaseMicrophoneCapture } from "../speech";
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
    <div className="modal-backdrop" role="presentation">
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="score-form-title">
        <div className="sheet-header">
          <div><p className="eyebrow">{messages.game.manualEntry}</p><h2 id="score-form-title">{title}</h2></div>
          <button className="text-action" onClick={onClose}>{messages.common.close}</button>
        </div>
        <div className="score-fields">
          {game.players.map((player) => (
            <div className="score-field" key={player.id}>
              <span>{player.name}</span>
              <span className="score-input-control">
                <input
                  aria-label={player.name}
                  inputMode="numeric"
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
                <button
                  className="score-sign-button"
                  type="button"
                  aria-label={messages.game.toggleScoreSign(player.name)}
                  onClick={() => setScoreInputs((current) => {
                    const value = current[player.id] ?? "0";
                    const next = value.startsWith("-") ? value.slice(1) || "0" : value === "0" ? "-" : `-${value}`;
                    return { ...current, [player.id]: next };
                  })}
                >+/−</button>
              </span>
            </div>
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
  const [toast, setToast] = useState("");
  const voiceModel = useVoiceModel();

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
  const ranking = useMemo(() => game ? rankingFor(game, game.rounds, locale) : [], [game, locale]);

  useEffect(() => {
    if (game?.status === "finished") releaseMicrophoneCapture();
  }, [game?.status]);

  if (!game) return <Navigate to="/" replace />;
  const canEdit = game.status === "active" || editingFinished;
  const voiceActive = voice.status.phase === "starting" || voice.status.phase === "listening";
  const modelUsable = voiceModel.phase === "ready";
  const modelBusy = voiceModel.phase === "downloading" || voiceModel.phase === "initializing" || voiceModel.phase === "transcribing";
  const showVoiceCard = voice.status.phase !== "idle" || voice.confirmationPending;

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
        <button className="text-action" onClick={() => navigate("/")}>{messages.common.home}</button>
        <div className="game-title"><small>{game.status === "active" ? messages.game.active : messages.game.finalResult}</small><strong>{formatGameDate(game.startedAt, locale)}</strong></div>
        <div className="game-topbar-actions" aria-hidden="true" />
      </header>

      <section className="scoreboard-shell">
        <div className="scoreboard-heading">
          <div><p className="eyebrow">{messages.game.roundCount(game.rounds.length)}</p><h1>{panelTitle}</h1></div>
        </div>

        <nav className="game-nav" aria-label={messages.game.navigation}>
          <button className={panel === "ranking" ? "active" : ""} onClick={() => setPanel("ranking")}><span>{messages.game.ranking}</span></button>
          <button className={panel === "history" ? "active" : ""} onClick={() => setPanel("history")}><span>{messages.game.rounds}</span></button>
          <button className={panel === "players" ? "active" : ""} onClick={() => setPanel("players")}><span>{messages.game.players}</span></button>
          {game.status === "active" && <button className="finish-nav" onClick={() => {
            if (window.confirm(messages.game.finishConfirm)) finishGame(game.id);
          }}><span>{messages.game.finish}</span></button>}
        </nav>

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

        {game.status === "active" && panel === "ranking" && showVoiceCard && <>
          <section className={`voice-card phase-${voice.status.phase}`} aria-live="polite">
            <div className="voice-status-line"><strong>{currentPhase}</strong></div>
            <p>{voice.status.message}</p>
            {voice.status.transcript && <blockquote>“{voice.status.transcript}”</blockquote>}
            {voice.status.draftScores && <div className="draft-score-chips">
              {game.players.map((player) => <span key={player.id}>{player.name} <strong>{voice.status.draftScores?.[player.id] ?? 0}</strong></span>)}
            </div>}
          </section>
        </>}

        {game.status === "finished" && panel === "ranking" && <div className="result-actions">
          <button className="primary-button" onClick={() => void share()}>{messages.game.shareResult}</button>
          <button className="secondary-button" onClick={() => setEditingFinished((value) => !value)}>{editingFinished ? messages.game.stopEditing : messages.game.editResult}</button>
        </div>}
      </section>

      {game.status === "active" && <div className="voice-dock">
        <div className="voice-dock-panel">
          <div className="voice-dock-copy">
            {modelUsable && <strong>{voiceActive ? currentPhase : messages.game.talkToScoreboard}</strong>}
            <small>{voice.supported ? messages.game.commandHint : messages.game.voiceUnavailable}</small>
            <div className="voice-dock-actions">
              <button className="manual-link" onClick={() => setManualOpen(true)}>{messages.game.type}</button>
              {voice.confirmationPending && <button className="voice-confirm" onClick={voice.confirmPending}>{messages.common.confirm}</button>}
            </div>
          </div>
        </div>
        <button
          className={`main-mic ${voiceActive ? "active" : ""}`}
          disabled={modelBusy}
          aria-label={modelUsable
            ? (voiceActive ? messages.setup.endConversation : messages.game.talkToScoreboard)
            : voiceModel.phase === "error" ? messages.voiceModel.retry : messages.voiceModel.download}
          data-model-phase={voiceModel.phase}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            if (modelUsable) voice.activate();
            else prepareVoiceModel();
          }}
          onPointerUp={(event) => { event.preventDefault(); if (modelUsable) voice.release(); }}
          onPointerCancel={voice.cancel}
          onLostPointerCapture={() => { if (modelUsable) voice.release(); }}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
              if (modelUsable) voice.activate();
              else prepareVoiceModel();
            }
          }}
          onKeyUp={(event) => { if (modelUsable && (event.key === "Enter" || event.key === " ")) voice.release(); }}
        >
          <strong>{modelUsable ? "MIC" : voiceModel.phase === "transcribing" ? "…" : modelBusy ? `${Math.round(voiceModel.progress)}%` : "↓"}</strong>
          {modelUsable && <small>{voiceActive ? messages.game.stopVoice : messages.game.startVoice}</small>}
          <span className="mic-volume" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(voice.volume, voice.microphone.rms)})` }} /></span>
          {!modelUsable && <span className="mic-progress" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, voiceModel.progress / 100))})` }} /></span>}
        </button>
      </div>}

      {manualOpen && <ScoreForm game={game} title={messages.game.addRound} onClose={() => setManualOpen(false)} onSave={(scores) => { addRound(game.id, scores, "manual"); setManualOpen(false); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
