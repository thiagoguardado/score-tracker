import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../types";
import { listenOnce, speak } from "../speech";
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
  players: [{ id: "thiago", name: "Thiago" }, { id: "mario", name: "Mário" }],
  rounds: [],
};

describe("useVoiceConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("faz a rodada, corrige e confirma sem novo toque", async () => {
    vi.mocked(listenOnce)
      .mockResolvedValueOnce("Thiago zero e Mário sete")
      .mockResolvedValueOnce("repetir")
      .mockResolvedValueOnce("corrigir Mário para nove")
      .mockResolvedValueOnce("confirmar");
    const onAddRound = vi.fn();
    const { result } = renderHook(() => useVoiceConversation({
      game,
      onAddRound,
      onDeleteRound: vi.fn(),
      onFinish: vi.fn(),
    }));

    act(() => result.current.activate());
    await waitFor(() => expect(onAddRound).toHaveBeenCalledWith({ thiago: 0, mario: 9 }));
    expect(vi.mocked(listenOnce)).toHaveBeenCalledTimes(4);
    expect(vi.mocked(speak).mock.calls.at(-1)?.[0]).toContain("Ranking");
  });

  it("não salva antes de confirmar", async () => {
    vi.mocked(listenOnce)
      .mockResolvedValueOnce("Thiago três e Mário cinco")
      .mockResolvedValueOnce("cancelar");
    const onAddRound = vi.fn();
    const { result } = renderHook(() => useVoiceConversation({ game, onAddRound, onDeleteRound: vi.fn(), onFinish: vi.fn() }));

    act(() => result.current.activate());
    await waitFor(() => expect(vi.mocked(speak)).toHaveBeenCalledWith(expect.stringContaining("Nenhum valor foi salvo")));
    expect(onAddRound).not.toHaveBeenCalled();
  });
});
