import { useCallback, useEffect, useRef, useState } from "react";
import { spokenRanking } from "../domain/ranking";
import { parseGameVoiceCommand } from "../domain/voiceParser";
import { getMessages, type Locale } from "../i18n";
import { finishListening, getSpeechErrorCode, listenOnce, speak, stopAudio, supportsRecognition } from "../speech";
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
  const [waitingForTap, setWaitingForTap] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [volume, setVolume] = useState(0);
  const sessionActive = useRef(false);
  const pendingScoresRef = useRef<Record<PlayerId, number> | undefined>(undefined);
  const pendingActionRef = useRef<PendingAction>(null);
  const omittedNamesRef = useRef<string[]>([]);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!sessionActive.current) setStatus(initialStatus());
    return () => {
      sessionActive.current = false;
      pendingScoresRef.current = undefined;
      pendingActionRef.current = null;
      omittedNamesRef.current = [];
      setWaitingForTap(false);
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

  const omittedText = (omittedNames: string[]): string => {
    const joinedNames = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(omittedNames);
    return (omittedNames.length === 1 ? messages.voice.omittedOne(joinedNames) : messages.voice.omittedMany(joinedNames)).trim();
  };

  const hear = async (draftScores?: Record<PlayerId, number>): Promise<string> => {
    let lastError: unknown;
    const attempts = 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      updateStatus(
        "starting",
        attempt === 0 ? messages.voice.startingMicrophone : messages.voice.listeningAgain,
        draftScores ? statusRef.current.transcript : "",
        draftScores,
      );
      try {
        return await listenOnce(
          locale,
          10_000,
          game.players.map((player) => player.name),
          () => updateStatus("listening", messages.voice.listening, draftScores ? statusRef.current.transcript : "", draftScores),
          setVolume,
          (partial) => updateStatus("listening", messages.voice.listening, partial, draftScores),
        );
      } catch (error) {
        lastError = error;
        const code = getSpeechErrorCode(error);
        if (code.includes("not-allowed") || code.includes("service-not-allowed") || code.includes("unavailable")) throw error;
        if (attempt === 0 && sessionActive.current) await say(messages.voice.didNotHear, "speaking-review", draftScores);
      }
    }
    throw lastError;
  };

  const friendlyError = (error: unknown): string => {
    const code = getSpeechErrorCode(error);
    if (code.includes("not-allowed") || code.includes("service-not-allowed")) return messages.voice.microphonePermissionDiagnostic(code);
    if (code.includes("unavailable")) return messages.voice.unavailableBrowser;
    return messages.voice.failedSafelyDiagnostic(code);
  };

  const run = useCallback(async () => {
    if (!supportsRecognition()) {
      updateStatus("error", messages.voice.unavailable);
      return;
    }

    sessionActive.current = true;
    setWaitingForTap(false);
    let pendingScores = pendingScoresRef.current;
    let pendingAction = pendingActionRef.current;
    let omittedNames = omittedNamesRef.current;
    let capturesThisActivation = 0;
    let pausedForGesture = false;

    const preservePending = () => {
      pendingScoresRef.current = pendingScores;
      pendingActionRef.current = pendingAction;
      omittedNamesRef.current = omittedNames;
      setConfirmationPending(Boolean(pendingScores || pendingAction));
    };
    const clearPending = () => {
      pendingScores = undefined;
      pendingAction = null;
      omittedNames = [];
      preservePending();
    };

    try {
      while (sessionActive.current) {
        if (capturesThisActivation > 0) {
          preservePending();
          pausedForGesture = true;
          setWaitingForTap(true);
          updateStatus("awaiting-decision", pendingAction ? messages.voice.tapToConfirmAction : messages.voice.tapToContinue, statusRef.current.transcript, pendingScores);
          break;
        }
        const transcript = await hear(pendingScores);
        capturesThisActivation += 1;
        if (!sessionActive.current) break;
        updateStatus("parsing", messages.voice.phase.parsing, transcript, pendingScores);
        const command = parseGameVoiceCommand(transcript, game.players, Boolean(pendingScores), locale);

        if (pendingAction) {
          if (command.type === "cancel") {
            clearPending();
            await say(messages.voice.operationCancelled, "speaking-review");
            break;
          }
          if (command.type === "repeat") {
            await say(pendingAction === "undo" ? messages.voice.confirmUndo : messages.voice.confirmFinish, "awaiting-decision");
            preservePending();
            continue;
          }
          if (command.type !== "confirm") {
            await say(messages.voice.confirmOrCancel, "awaiting-decision");
            preservePending();
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
          clearPending();
          break;
        }

        if (pendingScores) {
          if (command.type === "confirm") {
            updateStatus("applying", messages.voice.phase.applying, transcript, pendingScores);
            const nextRound: Round = { id: "preview", createdAt: new Date().toISOString(), source: "voice", scores: pendingScores };
            onAddRound(pendingScores);
            await say(`${messages.voice.roundSaved} ${spokenRanking(game, locale, [...game.rounds, nextRound])}`, "speaking-ranking");
            clearPending();
            break;
          }
          if (command.type === "cancel") {
            clearPending();
            await say(messages.voice.roundCancelled, "speaking-review");
            break;
          }
          if (command.type === "repeat") {
            await say(reviewText(pendingScores, omittedNames), "awaiting-decision", pendingScores);
            preservePending();
            continue;
          }
          if (command.type === "correct-score") {
            pendingScores = { ...pendingScores, [command.playerId]: command.score };
            const correctedName = game.players.find((player) => player.id === command.playerId)?.name;
            omittedNames = omittedNames.filter((name) => name !== correctedName);
            updateStatus("awaiting-decision", messages.voice.roundReady, transcript, pendingScores);
            preservePending();
            continue;
          }
          if (command.type === "read-ranking") {
            await say(messages.voice.pendingRound, "awaiting-decision", pendingScores);
            preservePending();
            continue;
          }
          await say(command.type === "unknown" ? command.hint ?? messages.voice.unknownPending : messages.voice.unknownPending, "awaiting-decision", pendingScores);
          preservePending();
          continue;
        }

        if (command.type === "draft-round") {
          pendingScores = command.scores;
          omittedNames = command.omitted.map((player) => player.name);
          updateStatus("awaiting-decision", messages.voice.roundReady, transcript, pendingScores);
          if (omittedNames.length > 0) await say(omittedText(omittedNames), "speaking-review", pendingScores);
          preservePending();
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
          preservePending();
          continue;
        }
        if (command.type === "finish-game") {
          pendingAction = "finish";
          await say(messages.voice.confirmFinish, "awaiting-decision");
          preservePending();
          continue;
        }
        await say(command.type === "unknown" ? command.hint ?? messages.voice.unknownGeneral : messages.voice.unknownGeneral, "speaking-review");
        break;
      }
    } catch (error) {
      if (sessionActive.current || getSpeechErrorCode(error) !== "aborted") updateStatus("error", friendlyError(error));
    } finally {
      sessionActive.current = false;
      stopAudio();
      setVolume(0);
      if (!pausedForGesture) {
        setWaitingForTap(false);
        setStatus((current) => current.phase === "error" ? current : { ...initialStatus(), transcript: current.transcript });
      }
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
    pendingScoresRef.current = undefined;
    pendingActionRef.current = null;
    omittedNamesRef.current = [];
    setWaitingForTap(false);
    setConfirmationPending(false);
    stopAudio();
    setStatus(initialStatus());
  }, [locale]);

  const confirmPending = useCallback(() => {
    const scores = pendingScoresRef.current;
    const action = pendingActionRef.current;
    if (!scores && !action) return;

    sessionActive.current = false;
    stopAudio();
    pendingScoresRef.current = undefined;
    pendingActionRef.current = null;
    omittedNamesRef.current = [];
    setWaitingForTap(false);
    setConfirmationPending(false);

    void (async () => {
      updateStatus("applying", messages.voice.phase.applying, statusRef.current.transcript, scores);
      if (scores) {
        const nextRound: Round = { id: "preview", createdAt: new Date().toISOString(), source: "voice", scores };
        onAddRound(scores);
        await say(`${messages.voice.roundSaved} ${spokenRanking(game, locale, [...game.rounds, nextRound])}`, "speaking-ranking");
      } else if (action === "undo") {
        const last = game.rounds.at(-1);
        if (last) onDeleteRound(last.id);
        await say(`${messages.voice.lastRoundUndone} ${spokenRanking(game, locale, game.rounds.slice(0, -1))}`, "speaking-ranking");
      } else if (action === "finish") {
        onFinish();
        await say(`${messages.voice.gameFinished} ${spokenRanking(game, locale)}`, "speaking-ranking");
      }
      setStatus(initialStatus());
    })();
  }, [game, locale, messages, onAddRound, onDeleteRound, onFinish]);

  return { status, activate, release: finishListening, cancel, confirmPending, confirmationPending, waitingForTap, supported: supportsRecognition(), volume };
}
