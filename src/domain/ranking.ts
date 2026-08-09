import { getMessages, type Locale } from "../i18n";
import type { Game, PlayerId, RankingEntry, Round } from "../types";

export function totalsFor(game: Game, rounds: Round[] = game.rounds): Record<PlayerId, number> {
  const totals = Object.fromEntries(game.players.map((player) => [player.id, 0]));
  for (const round of rounds) {
    for (const player of game.players) totals[player.id] += round.scores[player.id] ?? 0;
  }
  return totals;
}

export function rankingFor(game: Game, rounds: Round[] = game.rounds, locale: Locale = "en"): RankingEntry[] {
  const totals = totalsFor(game, rounds);
  const ordered = game.players
    .map((player) => ({ player, total: totals[player.id] }))
    .sort((a, b) => b.total - a.total || a.player.name.localeCompare(b.player.name, locale, { sensitivity: "base" }));

  let previousTotal: number | undefined;
  let previousPosition = 0;
  return ordered.map((entry, index) => {
    const position = entry.total === previousTotal ? previousPosition : index + 1;
    previousTotal = entry.total;
    previousPosition = position;
    return { ...entry, position };
  });
}

export function spokenRanking(game: Game, locale: Locale = "en", rounds: Round[] = game.rounds): string {
  const messages = getMessages(locale);
  const entries = rankingFor(game, rounds, locale);
  if (entries.length === 0) return messages.voice.noPlayers;
  return `${messages.voice.ranking}. ${entries
    .map(({ player, position, total }) => `${position}, ${player.name}, ${total} ${Math.abs(total) === 1 ? messages.voice.point : messages.voice.points}`)
    .join(messages.voice.scoreListSeparator)}.`;
}

export function shareText(game: Game, locale: Locale = "en"): string {
  const messages = getMessages(locale);
  const lines = rankingFor(game, game.rounds, locale).map(({ player, position, total }) =>
    `${position}. ${player.name} — ${total} ${Math.abs(total) === 1 ? messages.voice.point : messages.voice.points}`,
  );
  return [messages.share.heading, "", ...lines, "", messages.share.roundsPlayed(game.rounds.length)].join("\n");
}
