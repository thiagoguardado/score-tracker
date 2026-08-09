import { describe, expect, it } from "vitest";
import type { Game } from "../types";
import { rankingFor, shareText, spokenRanking } from "./ranking";

const game: Game = {
  id: "game",
  startedAt: "2026-08-09T12:00:00.000Z",
  status: "finished",
  players: [
    { id: "a", name: "Ana" },
    { id: "b", name: "Bia" },
    { id: "c", name: "Caio" },
  ],
  rounds: [
    { id: "r1", createdAt: "2026-08-09T12:01:00.000Z", source: "voice", scores: { a: 10, b: 10, c: 5 } },
  ],
};

describe("ranking", () => {
  it("shares positions for tied scores", () => {
    expect(rankingFor(game).map(({ player, position }) => [player.name, position])).toEqual([
      ["Ana", 1], ["Bia", 1], ["Caio", 3],
    ]);
  });

  it("creates localized spoken and shareable text", () => {
    expect(spokenRanking(game, "en")).toContain("1, Ana, 10 points");
    expect(shareText(game, "en")).toContain("🥇 Bia — 10 points");
    expect(spokenRanking(game, "pt-BR")).toContain("1, Ana, 10 pontos");
    expect(shareText(game, "pt-BR")).toContain("Resultado da partida");
  });
});
