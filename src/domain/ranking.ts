import type { Game, PlayerId, RankingEntry, Round } from "../types";

export function totalsFor(game: Game, rounds: Round[] = game.rounds): Record<PlayerId, number> {
  const totals = Object.fromEntries(game.players.map((player) => [player.id, 0]));
  for (const round of rounds) {
    for (const player of game.players) {
      totals[player.id] += round.scores[player.id] ?? 0;
    }
  }
  return totals;
}

export function rankingFor(game: Game, rounds: Round[] = game.rounds): RankingEntry[] {
  const totals = totalsFor(game, rounds);
  const ordered = game.players
    .map((player) => ({ player, total: totals[player.id] }))
    .sort((a, b) => b.total - a.total || a.player.name.localeCompare(b.player.name, "pt-BR"));

  let previousTotal: number | undefined;
  let previousPosition = 0;
  return ordered.map((entry, index) => {
    const position = entry.total === previousTotal ? previousPosition : index + 1;
    previousTotal = entry.total;
    previousPosition = position;
    return { ...entry, position };
  });
}

export function spokenRanking(game: Game, rounds: Round[] = game.rounds): string {
  const entries = rankingFor(game, rounds);
  if (entries.length === 0) return "Ainda não há jogadores.";
  return `Ranking. ${entries
    .map(({ player, position, total }) => `${position}º, ${player.name}, ${total} ${Math.abs(total) === 1 ? "ponto" : "pontos"}`)
    .join(". ")}.`;
}

export function shareText(game: Game): string {
  const medal = (position: number) => ({ 1: "🥇", 2: "🥈", 3: "🥉" })[position] ?? `${position}.`;
  const lines = rankingFor(game).map(({ player, position, total }) => `${medal(position)} ${player.name} — ${total} pontos`);
  return [`🏆 Resultado da partida`, "", ...lines, "", `${game.rounds.length} ${game.rounds.length === 1 ? "rodada jogada" : "rodadas jogadas"}`].join("\n");
}
