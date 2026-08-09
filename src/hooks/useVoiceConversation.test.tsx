import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenOnce, speak } from "../speech";
import type { Game } from "../types";
import { useVoiceConversation } from "./useVoiceConversation";

vi.mock("../speech", () => ({
  getSpeechErrorCode: (error: unknown) => error instanceof Error ? error.message : "speech-error",
  listenOnce: vi.fn(),
  requiresUserGestureBetweenRecognitions: vi.fn(() => /iPad|iPhone|iPod/i.test(window.navigator.userAgent)),
  speak: vi.fn().mockResolvedValue(undefined),
  stopAudio: vi.fn(),
  supportsRecognition: vi.fn(() => true),
}));

const game: Game = {
  id: "game",
  startedAt: "2026-08-09T12:00:00.000Z",
  status: "active",
  players: [{ id: "alex", name: "Alex" }, { id: "sam", name: "Sam" }],
  rounds: [],
};

describe("useVoiceConversation", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("drafts, repeats, corrects, and confirms without another tap", async () => {
    vi.mocked(listenOnce)
      .mockResolvedValueOnce("Alex zero and Sam seven")
      .mockResolvedValueOnce("repeat")
      .mockResolvedValueOnce("correct Sam to nine")
      .mockResolvedValueOnce("confirm");
    const onAddRound = vi.fn();
    const { result } = renderHook(() => useVoiceConversation({
      game,
      locale: "en",
      onAddRound,
      onDeleteRound: vi.fn(),
      onFinish: vi.fn(),
    }));

    act(() => result.current.activate());
    await waitFor(() => expect(onAddRound).toHaveBeenCalledWith({ alex: 0, sam: 9 }));
    expect(vi.mocked(listenOnce)).toHaveBeenCalledTimes(4);
    expect(vi.mocked(speak).mock.calls.at(-1)?.[0]).toContain("Ranking");
    expect(vi.mocked(speak).mock.calls.at(-1)?.[1]).toBe("en");
  });

  it("does not save before confirmation", async () => {
    vi.mocked(listenOnce)
      .mockResolvedValueOnce("Alex three and Sam five")
      .mockResolvedValueOnce("cancel");
    const onAddRound = vi.fn();
    const { result } = renderHook(() => useVoiceConversation({ game, locale: "en", onAddRound, onDeleteRound: vi.fn(), onFinish: vi.fn() }));

    act(() => result.current.activate());
    await waitFor(() => expect(vi.mocked(speak)).toHaveBeenCalledWith(expect.stringContaining("No scores were saved"), "en"));
    expect(onAddRound).not.toHaveBeenCalled();
  });

  it("shows a complete draft without reading every score aloud", async () => {
    vi.mocked(listenOnce)
      .mockResolvedValueOnce("Alex three and Sam five")
      .mockResolvedValueOnce("confirm");
    const onAddRound = vi.fn();
    const { result } = renderHook(() => useVoiceConversation({ game, locale: "en", onAddRound, onDeleteRound: vi.fn(), onFinish: vi.fn() }));

    act(() => result.current.activate());
    await waitFor(() => expect(onAddRound).toHaveBeenCalledWith({ alex: 3, sam: 5 }));

    expect(vi.mocked(speak)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(speak).mock.calls[0]?.[0]).toContain("Round saved");
  });

  it("only speaks the omission warning before confirmation", async () => {
    vi.mocked(listenOnce)
      .mockResolvedValueOnce("Alex three")
      .mockResolvedValueOnce("cancel");
    const { result } = renderHook(() => useVoiceConversation({ game, locale: "en", onAddRound: vi.fn(), onDeleteRound: vi.fn(), onFinish: vi.fn() }));

    act(() => result.current.activate());
    await waitFor(() => expect(vi.mocked(speak)).toHaveBeenCalledWith(expect.stringContaining("Sam was not mentioned"), "en"));

    expect(vi.mocked(speak).mock.calls[0]?.[0]).not.toContain("Alex, 3");
  });

  it("requires a fresh tap for each recognition turn on iOS", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    vi.mocked(listenOnce)
      .mockResolvedValueOnce("Alex three and Sam five")
      .mockResolvedValueOnce("confirm");
    const onAddRound = vi.fn();
    const { result } = renderHook(() => useVoiceConversation({ game, locale: "en", onAddRound, onDeleteRound: vi.fn(), onFinish: vi.fn() }));

    act(() => result.current.activate());
    await waitFor(() => expect(result.current.waitingForTap).toBe(true));
    expect(vi.mocked(listenOnce)).toHaveBeenCalledTimes(1);

    act(() => result.current.activate());
    await waitFor(() => expect(onAddRound).toHaveBeenCalledWith({ alex: 3, sam: 5 }));
    expect(vi.mocked(listenOnce)).toHaveBeenCalledTimes(2);
  });

  it("uses Portuguese commands when Portuguese is selected", async () => {
    vi.mocked(listenOnce)
      .mockResolvedValueOnce("Alex três e Sam cinco")
      .mockResolvedValueOnce("confirmar");
    const onAddRound = vi.fn();
    const { result } = renderHook(() => useVoiceConversation({ game, locale: "pt-BR", onAddRound, onDeleteRound: vi.fn(), onFinish: vi.fn() }));

    act(() => result.current.activate());
    await waitFor(() => expect(onAddRound).toHaveBeenCalledWith({ alex: 3, sam: 5 }));
    expect(vi.mocked(speak).mock.calls.at(-1)?.[1]).toBe("pt-BR");
  });
});
