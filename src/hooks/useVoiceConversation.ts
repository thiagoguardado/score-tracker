import { useCallback, useEffect, useRef, useState } from "react";
import { spokenRanking } from "../domain/ranking";
import { parseGameVoiceCommand } from "../domain/voiceParser";
import { getMessages, type Locale } from "../i18n";
import { listenOnce, speak, stopAudio, supportsRecognition } from "../speech";
import type { Game, PlayerId, Round, VoicePhase, VoiceStatus } from "../types";

type PendingAction = "undo" | "finish" | null;

type Options = {
  game: Game;
  locale: Locale;
  onAddRound: (scores: Record<PlayerId, number>) => void;
  onDeleteRound: (roundId: string) => void;
  onFinish: () => void;
};

function scoreList(game: Game, scores: Record<PlayerId, number>, separator: string): string {
  return game.players.map((player) => `${player.name}, ${scores[player.id] ?? 0}`).join(separator);
}

export function useVoiceConversation({ game, locale, onAddRound, onDeleteRound, onFinish }: Options) {
  const messages = getMessages(locale);
  const initialStatus = (): VoiceStatus => ({ phase: "idle", transcript: "", message: messages.voice.idleMessage });
  const [status, setStatus] = useState<VoiceStatus>(initialStatus);
  const sessionActive = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!sessionActive.current) setStatus(initialStatus());
    return () => {
      sessionActive.current = false;
      stopAudio();
    };
  }, [locale]);

  const updateStatus = (phase: VoicePhase, message: string, transcript = "", draftScores?: Record<PlayerId, number>) => {
    setStatus({ phase, message, transcript, draftScores });
  };

  const say = async (text: string, phase: VoicePhase, draftScores?: Record<PlayerId, number>) => {
    updateStatus(phase, text, statusRef.current.transcript, draftScores);
    await speak(text, locale);
  };

  const reviewText = (scores: Record<PlayerId, number>, omittedNames: string[] = []): string => {
    const joinedNames = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(omittedNames);
    const omitted = omittedNames.length === 0
      ? ""
      : omittedNames.length === 1 ? messages.voice.omittedOne(joinedNames) : messages.voice.omittedMany(joinedNames);
    return messages.voice.review(scoreList(game, scores, messages.voice.scoreListSeparator), omitted);
  };

  const hear = async (draftScores?: Record<PlayerId, number>): Promise<string> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      updateStatus("listening", attempt === 0 ? messages.voice.listening : messages.voice.listeningAgain, "", draftScores);
      try {
        return await listenOnce(locale, 10_000);
      } catch (error) {
        lastError = error;
        const code = error instanceof Error ? error.message : "";
        if (code.includes("not-allowed") || code.includes("service-not-allowed") || code.includes("unavailable")) throw error;
        if (attempt === 0 && sessionActive.current) await say(messages.voice.didNotHear, "speaking-review", draftScores);
      }
    }
    throw lastError;
  };

  const friendlyError = (error: unknown): string => {
    const code = error instanceof Error ? error.message : "";
    if (code.includes("not-allowed") || code.includes("service-not-allowed")) return messages.voice.microphonePermission;
    if (code.includes("unavailable")) return messages.voice.unavailableBrowser;
    return messages.voice.failedSafely;
  };

  const run = useCallback(async () => {
    if (!supportsRecognition()) {
      updateStatus("error", messages.voice.unavailable);
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
        updateStatus("parsing", messages.voice.phase.parsing, transcript, pendingScores);
        const command = parseGameVoiceCommand(transcript, game.players, Boolean(pendingScores), locale);

        if (pendingAction) {
          if (command.type === "cancel") {
            await say(messages.voice.operationCancelled, "speaking-review");
            break;
          }
          if (command.type === "repeat") {
            await say(pendingAction === "undo" ? messages.voice.confirmUndo : messages.voice.confirmFinish, "awaiting-decision");
            continue;
          }
          if (command.type !== "confirm") {
            await say(messages.voice.confirmOrCancel, "awaiting-decision");
            continue;
          }

          updateStatus("applying", messages.voice.phase.applying, transcript);
          if (pendingAction === "undo") {
            const last = game.rounds.at(-1);
            if (last) onDeleteRound(last.id);
            const remaining = game.rounds.slice(0, -1);
            await say(`${messages.voice.lastRoundUndone} ${spokenRanking(game, locale, remaining)}`, "speaking-ranking");
          } else {
            onFinish();
            await say(`${messages.voice.gameFinished} ${spokenRanking(game, locale)}`, "speaking-ranking");
          }
          break;
        }

        if (pendingScores) {
          if (command.type === "confirm") {
            updateStatus("applying", messages.voice.phase.applying, transcript, pendingScores);
            const nextRound: Round = { id: "preview", createdAt: new Date().toISOString(), source: "voice", scores: pendingScores };
            onAddRound(pendingScores);
            await say(`${messages.voice.roundSaved} ${spokenRanking(game, locale, [...game.rounds, nextRound])}`, "speaking-ranking");
            break;
          }
          if (command.type === "cancel") {
            await say(messages.voice.roundCancelled, "speaking-review");
            break;
          }
          if (command.type === "repeat") {
            await say(reviewText(pendingScores, omittedNames), "awaiting-decision", pendingScores);
            continue;
          }
          if (command.type === "correct-score") {
            pendingScores = { ...pendingScores, [command.playerId]: command.score };
            const correctedName = game.players.find((player) => player.id === command.playerId)?.name;
            omittedNames = omittedNames.filter((name) => name !== correctedName);
            await say(reviewText(pendingScores, omittedNames), "awaiting-decision", pendingScores);
            continue;
          }
          if (command.type === "read-ranking") {
            await say(messages.voice.pendingRound, "awaiting-decision", pendingScores);
            continue;
          }
          await say(command.type === "unknown" ? command.hint ?? messages.voice.unknownPending : messages.voice.unknownPending, "awaiting-decision", pendingScores);
          continue;
        }

        if (command.type === "draft-round") {
          pendingScores = command.scores;
          omittedNames = command.omitted.map((player) => player.name);
          await say(reviewText(pendingScores, omittedNames), "awaiting-decision", pendingScores);
          continue;
        }
        if (command.type === "read-ranking") {
          await say(spokenRanking(game, locale), "speaking-ranking");
          break;
        }
        if (command.type === "read-round") {
          const number = command.roundNumber ?? game.rounds.length;
          const round = number > 0 ? game.rounds[number - 1] : undefined;
          const text = round ? messages.voice.round(number, scoreList(game, round.scores, messages.voice.scoreListSeparator)) : messages.voice.roundMissing;
          await say(text, "speaking-review");
          break;
        }
        if (command.type === "undo-last-round") {
          if (game.rounds.length === 0) {
            await say(messages.voice.nothingToUndo, "speaking-review");
            break;
          }
          pendingAction = "undo";
          await say(messages.voice.confirmUndo, "awaiting-decision");
          continue;
        }
        if (command.type === "finish-game") {
          pendingAction = "finish";
          await say(messages.voice.confirmFinish, "awaiting-decision");
          continue;
        }
        await say(command.type === "unknown" ? command.hint ?? messages.voice.unknownGeneral : messages.voice.unknownGeneral, "speaking-review");
        break;
      }
    } catch (error) {
      updateStatus("error", friendlyError(error));
    } finally {
      sessionActive.current = false;
      stopAudio();
      setStatus((current) => current.phase === "error" ? current : { ...initialStatus(), transcript: current.transcript });
    }
  }, [game, locale, messages, onAddRound, onDeleteRound, onFinish]);

  const activate = useCallback(() => {
    if (sessionActive.current) {
      if (["speaking-review", "speaking-ranking", "awaiting-decision"].includes(statusRef.current.phase)) {
        stopAudio();
      } else {
        sessionActive.current = false;
        stopAudio();
        setStatus(initialStatus());
      }
      return;
    }
    void run();
  }, [run, locale]);

  const cancel = useCallback(() => {
    sessionActive.current = false;
    stopAudio();
    setStatus(initialStatus());
  }, [locale]);

  return { status, activate, cancel, supported: supportsRecognition() };
}
