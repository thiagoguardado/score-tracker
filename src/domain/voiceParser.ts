import type { Player, PlayerId } from "../types";
import { normalizeSpeech, parsePortugueseNumber } from "./numbers";

export type GameVoiceCommand =
  | { type: "draft-round"; scores: Record<PlayerId, number>; omitted: Player[] }
  | { type: "correct-score"; playerId: PlayerId; score: number }
  | { type: "confirm" }
  | { type: "repeat" }
  | { type: "read-ranking" }
  | { type: "read-round"; roundNumber?: number }
  | { type: "undo-last-round" }
  | { type: "finish-game" }
  | { type: "cancel" }
  | { type: "unknown"; transcript: string; hint?: string };

export type SetupVoiceCommand =
  | { type: "confirm" }
  | { type: "repeat" }
  | { type: "cancel" }
  | { type: "add"; name: string }
  | { type: "remove"; name: string }
  | { type: "rename"; from: string; to: string }
  | { type: "names"; names: string[] }
  | { type: "unknown" };

const CONFIRM_WORDS = ["confirmar", "confirmado", "aprovar", "aprovado", "salvar", "pode salvar", "pode adicionar"];
const CANCEL_WORDS = ["cancelar", "cancela", "descartar", "esquecer"];

function hasPhrase(normalized: string, phrases: string[]): boolean {
  return phrases.some((phrase) => normalized === phrase || normalized.includes(` ${phrase} `) || normalized.startsWith(`${phrase} `));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function correctionFrom(transcript: string, players: Player[]): GameVoiceCommand | null {
  const normalized = ` ${normalizeSpeech(transcript)} `;
  for (const player of players) {
    const name = normalizeSpeech(player.name);
    const match = new RegExp(`\\b${escapeRegExp(name)}\\b`).exec(normalized);
    if (!match) continue;
    const afterName = normalized.slice((match.index ?? 0) + match[0].length).replace(/^\s*(?:para|e|eh|fica|com)\s+/, "");
    const score = parsePortugueseNumber(afterName);
    if (score !== null) return { type: "correct-score", playerId: player.id, score };
  }
  return null;
}

function roundFrom(transcript: string, players: Player[]): GameVoiceCommand | null {
  const normalized = normalizeSpeech(transcript);
  const occurrences = players
    .map((player) => {
      const name = normalizeSpeech(player.name);
      const matches = [...normalized.matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"))];
      return { player, name, matches };
    })
    .filter(({ matches }) => matches.length > 0);

  if (occurrences.some(({ matches }) => matches.length > 1)) {
    return { type: "unknown", transcript, hint: "Um jogador foi mencionado mais de uma vez." };
  }

  const ordered = occurrences
    .map(({ player, name, matches }) => ({ player, start: matches[0].index ?? 0, end: (matches[0].index ?? 0) + name.length }))
    .sort((a, b) => a.start - b.start);

  if (ordered.length === 0) return null;

  const scores: Record<PlayerId, number> = Object.fromEntries(players.map((player) => [player.id, 0]));
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    const segment = normalized.slice(current.end, next?.start ?? normalized.length);
    const score = parsePortugueseNumber(segment);
    if (score === null) {
      return { type: "unknown", transcript, hint: `Não entendi o valor de ${current.player.name}.` };
    }
    scores[current.player.id] = score;
  }

  const mentioned = new Set(ordered.map(({ player }) => player.id));
  return { type: "draft-round", scores, omitted: players.filter((player) => !mentioned.has(player.id)) };
}

export function parseGameVoiceCommand(transcript: string, players: Player[], hasPendingRound: boolean): GameVoiceCommand {
  const normalized = normalizeSpeech(transcript);
  const padded = ` ${normalized} `;

  if (hasPhrase(padded, CANCEL_WORDS)) return { type: "cancel" };
  if (hasPhrase(padded, CONFIRM_WORDS)) return { type: "confirm" };

  const roundMatch = normalized.match(/(?:repetir|dizer|ler)(?: a)? rodada (.+)$/);
  if (roundMatch) {
    const value = roundMatch[1] === "ultima" ? undefined : parsePortugueseNumber(roundMatch[1]) ?? undefined;
    return { type: "read-round", roundNumber: value };
  }
  if (normalized.includes("ultima rodada") && normalized.includes("repet")) return { type: "read-round" };
  if (["repetir", "repete", "dizer novamente", "falar novamente"].includes(normalized)) return { type: "repeat" };

  if (normalized.includes("desfazer") && normalized.includes("rodada")) return { type: "undo-last-round" };
  if (normalized.includes("finalizar") || normalized.includes("encerrar jogo") || normalized.includes("terminar jogo")) {
    return { type: "finish-game" };
  }
  if (normalized === "ranking" || normalized.includes("placar") || normalized.includes("quem esta ganhando") || normalized.includes("classificacao")) {
    return { type: "read-ranking" };
  }

  if (hasPendingRound || normalized.startsWith("corrigir") || normalized.startsWith("correcao")) {
    const correction = correctionFrom(transcript, players);
    if (correction) return correction;
  }

  const round = roundFrom(transcript, players);
  return round ?? { type: "unknown", transcript };
}

export function parsePlayerNames(transcript: string): string[] {
  const cleaned = transcript
    .replace(/^(os )?jogadores (sao|serao|são|serão)?\s*/i, "")
    .replace(/\.$/, "")
    .trim();
  if (!cleaned) return [];

  const commaParts = cleaned.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
  const expanded = commaParts.length > 1
    ? commaParts.flatMap((part) => part.split(/\s+e\s+/i))
    : cleaned.split(/\s+/).filter((part) => normalizeSpeech(part) !== "e");
  return expanded
    .map((name) => name.replace(/^e\s+/i, "").trim())
    .filter((name) => name && !["e", "jogador", "jogadores"].includes(normalizeSpeech(name)));
}

export function parseSetupVoiceCommand(transcript: string, hasNames: boolean): SetupVoiceCommand {
  const normalized = normalizeSpeech(transcript);
  const padded = ` ${normalized} `;
  if (hasPhrase(padded, CANCEL_WORDS)) return { type: "cancel" };
  if (hasPhrase(padded, CONFIRM_WORDS)) return { type: "confirm" };
  if (["repetir", "repete", "dizer novamente"].includes(normalized)) return { type: "repeat" };

  const rename = transcript.match(/^\s*(?:corrigir|renomear)\s+(.+?)\s+para\s+(.+?)\s*$/i);
  if (rename) return { type: "rename", from: rename[1].trim(), to: rename[2].trim() };
  const add = transcript.match(/^\s*(?:adicionar|incluir)\s+(.+?)\s*$/i);
  if (add) return { type: "add", name: add[1].trim() };
  const remove = transcript.match(/^\s*(?:remover|excluir|tirar)\s+(.+?)\s*$/i);
  if (remove) return { type: "remove", name: remove[1].trim() };

  if (!hasNames) {
    const names = parsePlayerNames(transcript);
    if (names.length > 0) return { type: "names", names };
  }
  return { type: "unknown" };
}
