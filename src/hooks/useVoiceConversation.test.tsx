import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listenOnce, speak } from "../speech";
import type { Game } from "../types";
import { useVoiceConversation } from "./useVoiceConversation";

vi.mock("../speech", () => ({
  listenOnce: vi.fn(),
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
