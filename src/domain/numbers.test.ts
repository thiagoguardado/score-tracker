import { describe, expect, it } from "vitest";
import { normalizeSpeech, parsePortugueseNumber } from "./numbers";

describe("parsePortugueseNumber", () => {
  it.each([
    ["zero", 0],
    ["menos doze", -12],
    ["cento e vinte e três pontos", 123],
    ["dois mil e quarenta", 2040],
    ["-19", -19],
  ])("interpreta %s", (spoken, expected) => {
    expect(parsePortugueseNumber(spoken)).toBe(expected);
  });

  it("ignora caixa, pontuação e acentos ao normalizar", () => {
    expect(normalizeSpeech("  MÁRIO, Sete! ")).toBe("mario sete");
  });
});
