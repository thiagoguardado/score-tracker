import { beforeEach, describe, expect, it } from "vitest";
import { detectInitialLocale, LOCALE_STORAGE_KEY } from "./i18n";

describe("locale selection", () => {
  beforeEach(() => window.localStorage.clear());

  it("selects Portuguese from the browser language", () => {
    expect(detectInitialLocale(["pt-BR", "en-US"])).toBe("pt-BR");
  });

  it("falls back to English", () => {
    expect(detectInitialLocale(["fr-FR"])).toBe("en");
  });

  it("gives a saved manual choice priority", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(detectInitialLocale(["pt-BR"])).toBe("en");
  });
});
