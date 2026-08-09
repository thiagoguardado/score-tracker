import { describe, expect, it } from "vitest";
import { normalizeSpeech, parseEnglishNumber, parsePortugueseNumber } from "./numbers";

describe("localized number parsing", () => {
  it.each([
    ["zero", 0],
    ["minus twelve", -12],
    ["one hundred and twenty three points", 123],
    ["two thousand forty", 2040],
    ["-19", -19],
  ])("parses English number %s", (spoken, expected) => {
    expect(parseEnglishNumber(spoken)).toBe(expected);
  });

  it.each([
    ["zero", 0],
    ["menos doze", -12],
    ["cento e vinte e três pontos", 123],
    ["dois mil e quarenta", 2040],
    ["-19", -19],
  ])("parses Portuguese number %s", (spoken, expected) => {
    expect(parsePortugueseNumber(spoken)).toBe(expected);
  });

  it("normalizes case, punctuation, and accents", () => {
    expect(normalizeSpeech("  MÁRIO, Seven! ")).toBe("mario seven");
  });
});
