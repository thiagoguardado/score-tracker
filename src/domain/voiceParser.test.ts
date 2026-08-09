import { describe, expect, it } from "vitest";
import type { Player } from "../types";
import { parseGameVoiceCommand, parsePlayerNames, parseSetupVoiceCommand } from "./voiceParser";

const players: Player[] = [
  { id: "thiago", name: "Thiago" },
  { id: "mario", name: "Mário" },
  { id: "paula", name: "Paula" },
  { id: "tomas", name: "Tomás" },
];

describe("parseGameVoiceCommand", () => {
  it("monta uma rodada e preenche ausentes com zero", () => {
    const command = parseGameVoiceCommand("Thiago zero, Mário sete e Tomás dezenove", players, false);
    expect(command).toMatchObject({
      type: "draft-round",
      scores: { thiago: 0, mario: 7, paula: 0, tomas: 19 },
    });
    if (command.type === "draft-round") expect(command.omitted.map((player) => player.name)).toEqual(["Paula"]);
  });

  it("corrige um valor na rodada pendente", () => {
    expect(parseGameVoiceCommand("Corrigir Mário para menos doze", players, true)).toEqual({
      type: "correct-score",
      playerId: "mario",
      score: -12,
    });
  });

  it.each([
    ["quem está ganhando", "read-ranking"],
    ["desfazer a última rodada", "undo-last-round"],
    ["finalizar jogo", "finish-game"],
    ["aprovar", "confirm"],
  ])("entende o comando %s", (speech, type) => {
    expect(parseGameVoiceCommand(speech, players, false).type).toBe(type);
  });

  it("entende uma rodada específica", () => {
    expect(parseGameVoiceCommand("repetir a rodada três", players, false)).toEqual({ type: "read-round", roundNumber: 3 });
  });
});

describe("setup por voz", () => {
  it("separa nomes mesmo quando a transcrição não inclui vírgulas", () => {
    expect(parsePlayerNames("Thiago Mário Paula e Tomás")).toEqual(["Thiago", "Mário", "Paula", "Tomás"]);
  });

  it("separa também a conjunção depois da última vírgula", () => {
    expect(parsePlayerNames("Thiago, Mário, Paula e Tomás")).toEqual(["Thiago", "Mário", "Paula", "Tomás"]);
  });

  it("interpreta correção de nome", () => {
    expect(parseSetupVoiceCommand("corrigir Mario para Mário", true)).toEqual({ type: "rename", from: "Mario", to: "Mário" });
  });
});
