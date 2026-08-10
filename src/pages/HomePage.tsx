import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LanguageSelect } from "../components/LanguageSelect";
import { ThemeSelect } from "../components/ThemeSelect";
import { rankingFor } from "../domain/ranking";
import { useI18n, type Locale, type Messages } from "../i18n";
import { useAppStore } from "../store";
import { releaseMicrophoneCapture } from "../speech";

function formatStartedAt(value: string, locale: Locale, messages: Messages): string {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (sameDay) return messages.home.todayAt(time);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function HomePage() {
  const navigate = useNavigate();
  const { locale, messages } = useI18n();
  const { state, deleteGame, storageHealthy } = useAppStore();
  const games = [...state.games].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  useEffect(() => {
    releaseMicrophoneCapture();
  }, []);

  const removeGame = (gameId: string) => {
    if (window.confirm(messages.home.deleteGameConfirm)) deleteGame(gameId);
  };

  return (
    <main className="page home-page">
      <header className="home-header">
        <div>
          <p className="eyebrow">{messages.home.tagline}</p>
          <h1>{messages.meta.title}</h1>
        </div>
        <div className="preference-selects">
          <LanguageSelect />
          <ThemeSelect />
        </div>
      </header>

      {!storageHealthy && <div className="alert" role="alert">{messages.home.storageError}</div>}

      <button className="new-game-card" onClick={() => navigate("/games/new")}>
        <span><strong>{messages.home.newGame}</strong><small>{messages.home.newGameSubtitle}</small></span>
        <span className="text-arrow" aria-hidden="true">→</span>
      </button>

      <section className="history-section" aria-labelledby="history-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{messages.home.savedOnDevice}</p>
            <h2 id="history-title">{messages.home.history}</h2>
          </div>
          {games.length > 0 && <span className="count-badge">{games.length}</span>}
        </div>

        {games.length === 0 ? (
          <div className="empty-state">
            <h3>{messages.home.firstGame}</h3>
            <p>{messages.home.emptyDescription}</p>
          </div>
        ) : (
          <div className="game-list">
            {games.map((game) => {
              const ranking = rankingFor(game, game.rounds, locale);
              const leader = game.rounds.length > 0 ? ranking[0] : undefined;
              const date = formatStartedAt(game.startedAt, locale, messages);
              return (
                <article className="game-card" key={game.id}>
                  <button className="game-card-main" onClick={() => navigate(`/games/${encodeURIComponent(game.id)}`)}>
                    <span className="game-card-copy">
                      <strong>{date}</strong>
                      <small>{messages.home.gameSummary(game.players.length, game.rounds.length)}</small>
                      <span className="game-summary">
                        {game.status === "active" ? messages.home.inProgress : leader ? messages.home.winner(leader.player.name, leader.total) : messages.home.finishedNoRounds}
                      </span>
                    </span>
                    <span className="text-arrow" aria-hidden="true">→</span>
                  </button>
                  <button className="text-action danger-subtle" aria-label={messages.home.deleteGameLabel(date)} onClick={() => removeGame(game.id)}>{messages.common.delete}</button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
