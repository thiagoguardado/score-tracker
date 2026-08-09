import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectInitialTheme, resolveTheme, THEME_STORAGE_KEY } from "./theme";

describe("theme selection", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to the system preference", () => {
    expect(detectInitialTheme()).toBe("system");
  });

  it("gives a saved manual choice priority", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(detectInitialTheme()).toBe("dark");
  });

  it("resolves the current system color scheme", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });
});
