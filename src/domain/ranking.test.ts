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
  it("compartilha posição em empates", () => {
    expect(rankingFor(game).map(({ player, position }) => [player.name, position])).toEqual([
      ["Ana", 1], ["Bia", 1], ["Caio", 3],
    ]);
  });

  it("gera textos falado e compartilhável", () => {
    expect(spokenRanking(game)).toContain("1º, Ana, 10 pontos");
    expect(shareText(game)).toContain("🥇 Bia — 10 pontos");
  });
});
