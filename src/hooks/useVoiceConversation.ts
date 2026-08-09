import { useCallback, useEffect, useRef, useState } from "react";
import { parseGameVoiceCommand } from "../domain/voiceParser";
import { spokenRanking } from "../domain/ranking";
import { listenOnce, speak, stopAudio, supportsRecognition } from "../speech";
import type { Game, PlayerId, Round, VoicePhase, VoiceStatus } from "../types";

type PendingAction = "undo" | "finish" | null;

type Options = {
  game: Game;
  onAddRound: (scores: Record<PlayerId, number>) => void;
  onDeleteRound: (roundId: string) => void;
  onFinish: () => void;
};

const INITIAL_STATUS: VoiceStatus = { phase: "idle", transcript: "", message: "Toque e fale os pontos ou um comando" };

function scoreList(game: Game, scores: Record<PlayerId, number>): string {
  return game.players.map((player) => `${player.name}, ${scores[player.id] ?? 0}`).join(". ");
}

function reviewText(game: Game, scores: Record<PlayerId, number>, omittedNames: string[] = []): string {
  const omitted = omittedNames.length > 0
    ? ` ${omittedNames.join(" e ")} ${omittedNames.length === 1 ? "não foi mencionado e ficou" : "não foram mencionados e ficaram"} com zero.`
    : "";
  return `Entendi. ${scoreList(game, scores)}.${omitted} Diga confirmar, repetir, corrigir ou cancelar.`;
}

function roundText(game: Game, round: Round, number: number): string {
  return `Rodada ${number}. ${scoreList(game, round.scores)}.`;
}

function friendlyError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code.includes("not-allowed") || code.includes("service-not-allowed")) return "Permita o uso do microfone e verifique se a Siri está ativada.";
  if (code.includes("unavailable")) return "A voz não está disponível neste navegador. Você ainda pode digitar a rodada.";
  return "Não consegui continuar por voz. Nada foi alterado; tente novamente.";
}

export function useVoiceConversation({ game, onAddRound, onDeleteRound, onFinish }: Options) {
  const [status, setStatus] = useState<VoiceStatus>(INITIAL_STATUS);
  const sessionActive = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => () => {
    sessionActive.current = false;
    stopAudio();
  }, []);

  const updateStatus = (phase: VoicePhase, message: string, transcript = "", draftScores?: Record<PlayerId, number>) => {
    setStatus({ phase, message, transcript, draftScores });
  };

  const say = async (text: string, phase: VoicePhase, draftScores?: Record<PlayerId, number>) => {
    updateStatus(phase, text, statusRef.current.transcript, draftScores);
    await speak(text);
  };

  const hear = async (draftScores?: Record<PlayerId, number>): Promise<string> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      updateStatus("listening", attempt === 0 ? "Ouvindo…" : "Ouvindo novamente…", "", draftScores);
      try {
        return await listenOnce(10_000);
      } catch (error) {
        lastError = error;
        const code = error instanceof Error ? error.message : "";
        if (code.includes("not-allowed") || code.includes("service-not-allowed") || code.includes("unavailable")) throw error;
        if (attempt === 0 && sessionActive.current) await say("Não ouvi. Pode repetir?", "speaking-review", draftScores);
      }
    }
    throw lastError;
  };

  const run = useCallback(async () => {
    if (!supportsRecognition()) {
      updateStatus("error", "A voz não está disponível aqui. Use a entrada manual.");
      return;
    }

    sessionActive.current = true;
    let pendingScores: Record<PlayerId, number> | undefined;
    let pendingAction: PendingAction = null;
    let omittedNames: string[] = [];

    try {
      while (sessionActive.current) {
        const transcript = await hear(pendingScores);
        if (!sessionActive.current) break;
        updateStatus("parsing", "Conferindo…", transcript, pendingScores);
        const command = parseGameVoiceCommand(transcript, game.players, Boolean(pendingScores));

        if (pendingAction) {
          if (command.type === "cancel") {
            await say("Operação cancelada.", "speaking-review");
            break;
          }
          if (command.type === "repeat") {
            await say(pendingAction === "undo" ? "Desfazer a última rodada. Confirmar?" : "Finalizar o jogo. Confirmar?", "awaiting-decision");
            continue;
          }
          if (command.type !== "confirm") {
            await say("Diga confirmar ou cancelar.", "awaiting-decision");
            continue;
          }

          updateStatus("applying", "Aplicando…", transcript);
          if (pendingAction === "undo") {
            const last = game.rounds.at(-1);
            if (last) onDeleteRound(last.id);
            const remaining = game.rounds.slice(0, -1);
            await say(`Última rodada desfeita. ${spokenRanking(game, remaining)}`, "speaking-ranking");
          } else {
            onFinish();
            await say(`Jogo finalizado. ${spokenRanking(game)}`, "speaking-ranking");
          }
          break;
        }

        if (pendingScores) {
          if (command.type === "confirm") {
            updateStatus("applying", "Salvando rodada…", transcript, pendingScores);
            const nextRound: Round = { id: "preview", createdAt: new Date().toISOString(), source: "voice", scores: pendingScores };
            onAddRound(pendingScores);
            await say(`Rodada salva. ${spokenRanking(game, [...game.rounds, nextRound])}`, "speaking-ranking");
            break;
          }
          if (command.type === "cancel") {
            await say("Rodada cancelada. Nenhum valor foi salvo.", "speaking-review");
            break;
          }
          if (command.type === "repeat") {
            await say(reviewText(game, pendingScores, omittedNames), "awaiting-decision", pendingScores);
            continue;
          }
          if (command.type === "correct-score") {
            pendingScores = { ...pendingScores, [command.playerId]: command.score };
            omittedNames = omittedNames.filter((name) => name !== game.players.find((player) => player.id === command.playerId)?.name);
            await say(reviewText(game, pendingScores, omittedNames), "awaiting-decision", pendingScores);
            continue;
          }
          if (command.type === "read-ranking") {
            await say("Existe uma rodada aguardando confirmação. Diga confirmar, repetir, corrigir ou cancelar.", "awaiting-decision", pendingScores);
            continue;
          }
          const hint = command.type === "unknown" ? command.hint : undefined;
          await say(hint ?? "Não entendi. Diga confirmar, repetir, corrigir ou cancelar.", "awaiting-decision", pendingScores);
          continue;
        }

        if (command.type === "draft-round") {
          pendingScores = command.scores;
          omittedNames = command.omitted.map((player) => player.name);
          await say(reviewText(game, pendingScores, omittedNames), "awaiting-decision", pendingScores);
          continue;
        }
        if (command.type === "read-ranking") {
          await say(spokenRanking(game), "speaking-ranking");
          break;
        }
        if (command.type === "read-round") {
          const number = command.roundNumber ?? game.rounds.length;
          const round = number > 0 ? game.rounds[number - 1] : undefined;
          await say(round ? roundText(game, round, number) : "Essa rodada não existe.", "speaking-review");
          break;
        }
        if (command.type === "undo-last-round") {
          if (game.rounds.length === 0) {
            await say("Ainda não há rodada para desfazer.", "speaking-review");
            break;
          }
          pendingAction = "undo";
          await say("Desfazer a última rodada. Confirmar?", "awaiting-decision");
          continue;
        }
        if (command.type === "finish-game") {
          pendingAction = "finish";
          await say("Finalizar o jogo. Confirmar?", "awaiting-decision");
          continue;
        }
        const hint = command.type === "unknown" ? command.hint : undefined;
        await say(hint ?? "Não entendi. Fale os nomes e os pontos, ou peça o ranking.", "speaking-review");
        break;
      }
    } catch (error) {
      updateStatus("error", friendlyError(error));
    } finally {
      sessionActive.current = false;
      stopAudio();
      setStatus((current) => current.phase === "error" ? current : { ...INITIAL_STATUS, transcript: current.transcript });
    }
  }, [game, onAddRound, onDeleteRound, onFinish]);

  const activate = useCallback(() => {
    if (sessionActive.current) {
      if (statusRef.current.phase === "speaking-review" || statusRef.current.phase === "speaking-ranking" || statusRef.current.phase === "awaiting-decision") {
        stopAudio();
      } else {
        sessionActive.current = false;
        stopAudio();
        setStatus(INITIAL_STATUS);
      }
      return;
    }
    void run();
  }, [run]);

  const cancel = useCallback(() => {
    sessionActive.current = false;
    stopAudio();
    setStatus(INITIAL_STATUS);
  }, []);

  return { status, activate, cancel, supported: supportsRecognition() };
}
