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
  it("builds an English round and fills omitted players with zero", () => {
    const command = parseGameVoiceCommand("Thiago zero, Mário seven and Tomás nineteen", players, false, "en");
    expect(command).toMatchObject({ type: "draft-round", scores: { thiago: 0, mario: 7, paula: 0, tomas: 19 } });
    if (command.type === "draft-round") expect(command.omitted.map((player) => player.name)).toEqual(["Paula"]);
  });

  it("builds a Portuguese round and fills omitted players with zero", () => {
    const command = parseGameVoiceCommand("Thiago zero, Mário sete e Tomás dezenove", players, false, "pt-BR");
    expect(command).toMatchObject({ type: "draft-round", scores: { thiago: 0, mario: 7, paula: 0, tomas: 19 } });
  });

  it("associates an accented Portuguese player with a digit score", () => {
    expect(parseGameVoiceCommand("Mario 5", players, false, "pt-BR")).toMatchObject({
      type: "draft-round",
      scores: { mario: 5 },
    });
  });

  it("corrects an English pending score", () => {
    expect(parseGameVoiceCommand("Correct Mário to minus twelve", players, true, "en")).toEqual({
      type: "correct-score", playerId: "mario", score: -12,
    });
  });

  it("corrects a Portuguese pending score", () => {
    expect(parseGameVoiceCommand("Corrigir Mário para menos doze", players, true, "pt-BR")).toEqual({
      type: "correct-score", playerId: "mario", score: -12,
    });
  });

  it.each([
    ["who is winning", "read-ranking"],
    ["undo the last round", "undo-last-round"],
    ["finish game", "finish-game"],
    ["approve", "confirm"],
  ])("understands the English command %s", (speech, type) => {
    expect(parseGameVoiceCommand(speech, players, false, "en").type).toBe(type);
  });

  it("reads a numbered round in both languages", () => {
    expect(parseGameVoiceCommand("repeat round three", players, false, "en")).toEqual({ type: "read-round", roundNumber: 3 });
    expect(parseGameVoiceCommand("repetir a rodada três", players, false, "pt-BR")).toEqual({ type: "read-round", roundNumber: 3 });
  });
});

describe("voice player setup", () => {
  it("splits English names with or without commas", () => {
    expect(parsePlayerNames("Thiago Mário Paula and Tomás", "en")).toEqual(["Thiago", "Mário", "Paula", "Tomás"]);
    expect(parsePlayerNames("Thiago, Mário, Paula and Tomás", "en")).toEqual(["Thiago", "Mário", "Paula", "Tomás"]);
  });

  it("splits Portuguese names with or without commas", () => {
    expect(parsePlayerNames("Thiago Mário Paula e Tomás", "pt-BR")).toEqual(["Thiago", "Mário", "Paula", "Tomás"]);
    expect(parsePlayerNames("Thiago, Mário, Paula e Tomás", "pt-BR")).toEqual(["Thiago", "Mário", "Paula", "Tomás"]);
  });

  it("renames a player in both languages", () => {
    expect(parseSetupVoiceCommand("rename Mario to Mário", true, "en")).toEqual({ type: "rename", from: "Mario", to: "Mário" });
    expect(parseSetupVoiceCommand("corrigir Mario para Mário", true, "pt-BR")).toEqual({ type: "rename", from: "Mario", to: "Mário" });
  });
});
