import { describe, expect, it } from "vitest";
import { EMPTY_STATE, loadState, saveState, STORAGE_KEY } from "./storage";

describe("storage", () => {
  it("salva e carrega o estado versionado", () => {
    expect(saveState(EMPTY_STATE)).toBe(true);
    expect(loadState()).toEqual(EMPTY_STATE);
  });

  it("preserves a recovery copy when stored state is invalid", () => {
    window.localStorage.setItem(STORAGE_KEY, "{invalido");
    expect(loadState()).toEqual(EMPTY_STATE);
    expect(Object.keys(window.localStorage).some((key) => key.startsWith("score-tracker:recovery:"))).toBe(true);
  });
});
