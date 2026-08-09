import { ArrowRight, Plus, Trash2, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { rankingFor } from "../domain/ranking";
import { useAppStore } from "../store";

function formatStartedAt(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  if (sameDay) return `Hoje, ${time}`;
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function HomePage() {
  const navigate = useNavigate();
  const { state, deleteGame, storageHealthy } = useAppStore();
  const games = [...state.games].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const removeGame = (gameId: string) => {
    if (window.confirm("Excluir este jogo e todas as suas rodadas? Essa ação não pode ser desfeita.")) deleteGame(gameId);
  };

  return (
    <main className="page home-page">
      <header className="home-header">
        <div className="brand-mark" aria-hidden="true"><Trophy size={22} /></div>
        <div>
          <p className="eyebrow">Seu placar de mesa</p>
          <h1>Placar</h1>
        </div>
      </header>

      {!storageHealthy && <div className="alert" role="alert">Não foi possível salvar no aparelho. Verifique o espaço e as permissões do navegador.</div>}

      <button className="new-game-card" onClick={() => navigate("/games/new")}>
        <span className="new-game-icon"><Plus size={28} /></span>
        <span><strong>Novo jogo</strong><small>Cadastre os jogadores por voz</small></span>
        <ArrowRight size={24} aria-hidden="true" />
      </button>

      <section className="history-section" aria-labelledby="history-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Salvo neste aparelho</p>
            <h2 id="history-title">Histórico</h2>
          </div>
          {games.length > 0 && <span className="count-badge">{games.length}</span>}
        </div>

        {games.length === 0 ? (
          <div className="empty-state">
            <div className="empty-trophy" aria-hidden="true"><Trophy size={30} /></div>
            <h3>Sua primeira partida começa aqui</h3>
            <p>Os jogos e todas as rodadas ficam salvos automaticamente neste aparelho.</p>
          </div>
        ) : (
          <div className="game-list">
            {games.map((game) => {
              const ranking = rankingFor(game);
              const leader = game.rounds.length > 0 ? ranking[0] : undefined;
              return (
                <article className="game-card" key={game.id}>
                  <button className="game-card-main" onClick={() => navigate(`/games/${encodeURIComponent(game.id)}`)}>
                    <span className={`status-dot ${game.status}`} aria-hidden="true" />
                    <span className="game-card-copy">
                      <strong>{formatStartedAt(game.startedAt)}</strong>
                      <small>{game.players.length} jogadores · {game.rounds.length} {game.rounds.length === 1 ? "rodada" : "rodadas"}</small>
                      <span className="game-summary">
                        {game.status === "active" ? "Em andamento" : leader ? `${leader.player.name} venceu com ${leader.total}` : "Finalizado sem rodadas"}
                      </span>
                    </span>
                    <ArrowRight size={20} aria-hidden="true" />
                  </button>
                  <button className="icon-button danger-subtle" aria-label={`Excluir jogo de ${formatStartedAt(game.startedAt)}`} onClick={() => removeGame(game.id)}>
                    <Trash2 size={18} />
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
