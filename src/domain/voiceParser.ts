import type { Locale } from "../i18n";
import { getMessages } from "../i18n";
import type { Player, PlayerId } from "../types";
import { normalizeSpeech, parseLocalizedNumber } from "./numbers";

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

type Lexicon = {
  confirm: string[];
  cancel: string[];
  repeat: string[];
  correctionPrefixes: string[];
  correctionJoiners: string;
};

const LEXICONS: Record<Locale, Lexicon> = {
  en: {
    confirm: ["confirm", "confirmed", "approve", "approved", "save", "go ahead", "save it"],
    cancel: ["cancel", "discard", "forget it", "never mind"],
    repeat: ["repeat", "say again", "repeat that", "say that again"],
    correctionPrefixes: ["correct", "change", "set", "correction"],
    correctionJoiners: "to|at|is|with",
  },
  "pt-BR": {
    confirm: ["confirmar", "confirmado", "aprovar", "aprovado", "salvar", "pode salvar", "pode adicionar"],
    cancel: ["cancelar", "cancela", "descartar", "esquecer"],
    repeat: ["repetir", "repete", "dizer novamente", "falar novamente"],
    correctionPrefixes: ["corrigir", "correcao"],
    correctionJoiners: "para|e|eh|fica|com",
  },
};

function hasPhrase(normalized: string, phrases: string[]): boolean {
  const padded = ` ${normalized} `;
  return phrases.some((phrase) => normalized === phrase || padded.includes(` ${phrase} `));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const RESERVED_NAME_TOKENS: Record<Locale, Set<string>> = {
  en: new Set([
    "and", "at", "cancel", "change", "confirm", "correct", "finish", "game", "is", "last",
    "minus", "negative", "point", "points", "ranking", "read", "repeat", "round", "save", "score",
    "scoreboard", "set", "standings", "to", "undo", "who", "winning", "with",
  ]),
  "pt-BR": new Set([
    "cancelar", "com", "confirmar", "corrigir", "desfazer", "e", "eh", "encerrar", "finalizar",
    "fica", "ganhando", "jogo", "menos", "negativo", "para", "placar", "ponto", "pontos", "quem",
    "ranking", "repetir", "rodada", "salvar", "terminar", "ultima",
  ]),
};

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function scoreFollows(tokens: string[], nameIndex: number, locale: Locale): boolean {
  for (let length = 1; length <= 4 && nameIndex + length < tokens.length; length += 1) {
    if (parseLocalizedNumber(tokens.slice(nameIndex + 1, nameIndex + length + 1).join(" "), locale) !== null) return true;
  }
  return false;
}

/**
 * Whisper often returns a plausible spelling for a proper name. Correct only
 * a single word that is immediately associated with a score and has one clear
 * close match among the players. Ambiguous words are deliberately untouched.
 */
function canonicalizePlayerNames(transcript: string, players: Player[], locale: Locale): string {
  const tokens = normalizeSpeech(transcript).split(" ").filter(Boolean);
  const names = players
    .map((player) => ({ player, normalized: normalizeSpeech(player.name) }))
    .filter(({ normalized }) => normalized.length >= 3 && !normalized.includes(" "));

  return tokens.map((token, index) => {
    if (names.some(({ normalized }) => normalized === token)) return token;
    if (token.length < 3 || RESERVED_NAME_TOKENS[locale].has(token) || parseLocalizedNumber(token, locale) !== null) return token;
    if (!scoreFollows(tokens, index, locale)) return token;

    const ranked = names
      .map(({ normalized }) => {
        const distance = editDistance(token, normalized);
        return { normalized, distance, similarity: 1 - distance / Math.max(token.length, normalized.length) };
      })
      .sort((left, right) => left.distance - right.distance || right.similarity - left.similarity);
    const best = ranked[0];
    if (!best) return token;
    const distanceLimit = Math.max(token.length, best.normalized.length) <= 4 ? 1 : 2;
    if (best.distance > distanceLimit || best.similarity < 0.67) return token;
    const second = ranked[1];
    if (second && (second.distance === best.distance || second.similarity >= best.similarity - 0.12)) return token;
    return best.normalized;
  }).join(" ");
}

function correctionFrom(transcript: string, players: Player[], locale: Locale): GameVoiceCommand | null {
  const normalized = ` ${canonicalizePlayerNames(transcript, players, locale)} `;
  const lexicon = LEXICONS[locale];
  for (const player of players) {
    const name = normalizeSpeech(player.name);
    const match = new RegExp(`\\b${escapeRegExp(name)}\\b`).exec(normalized);
    if (!match) continue;
    const afterName = normalized
      .slice((match.index ?? 0) + match[0].length)
      .replace(new RegExp(`^\\s*(?:${lexicon.correctionJoiners})\\s+`), "");
    const score = parseLocalizedNumber(afterName, locale);
    if (score !== null) return { type: "correct-score", playerId: player.id, score };
  }
  return null;
}

function roundFrom(transcript: string, players: Player[], locale: Locale): GameVoiceCommand | null {
  const normalized = canonicalizePlayerNames(transcript, players, locale);
  const messages = getMessages(locale);
  const occurrences = players
    .map((player) => {
      const name = normalizeSpeech(player.name);
      const matches = [...normalized.matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"))];
      return { player, name, matches };
    })
    .filter(({ matches }) => matches.length > 0);

  if (occurrences.some(({ matches }) => matches.length > 1)) {
    return { type: "unknown", transcript, hint: messages.voice.duplicatePlayer };
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
    const score = parseLocalizedNumber(segment, locale);
    if (score === null) {
      return { type: "unknown", transcript, hint: messages.voice.missingScore(current.player.name) };
    }
    scores[current.player.id] = score;
  }

  const mentioned = new Set(ordered.map(({ player }) => player.id));
  return { type: "draft-round", scores, omitted: players.filter((player) => !mentioned.has(player.id)) };
}

export function parseGameVoiceCommand(
  transcript: string,
  players: Player[],
  hasPendingRound: boolean,
  locale: Locale = "en",
): GameVoiceCommand {
  const normalized = normalizeSpeech(transcript);
  const lexicon = LEXICONS[locale];

  if (hasPhrase(normalized, lexicon.cancel)) return { type: "cancel" };
  if (hasPhrase(normalized, lexicon.confirm)) return { type: "confirm" };

  if (locale === "pt-BR") {
    const roundMatch = normalized.match(/(?:repetir|dizer|ler)(?: a)? rodada (.+)$/);
    if (roundMatch) {
      const value = roundMatch[1] === "ultima" ? undefined : parseLocalizedNumber(roundMatch[1], locale) ?? undefined;
      return { type: "read-round", roundNumber: value };
    }
    if (normalized.includes("ultima rodada") && normalized.includes("repet")) return { type: "read-round" };
    if (normalized.includes("desfazer") && normalized.includes("rodada")) return { type: "undo-last-round" };
    if (normalized.includes("finalizar") || normalized.includes("encerrar jogo") || normalized.includes("terminar jogo")) return { type: "finish-game" };
    if (normalized === "ranking" || normalized.includes("placar") || normalized.includes("quem esta ganhando") || normalized.includes("classificacao")) return { type: "read-ranking" };
  } else {
    const roundMatch = normalized.match(/(?:repeat|say|read)(?: the)? (?:round) (.+)$/);
    if (roundMatch) {
      const value = roundMatch[1] === "last" ? undefined : parseLocalizedNumber(roundMatch[1], locale) ?? undefined;
      return { type: "read-round", roundNumber: value };
    }
    if (normalized.includes("last round") && normalized.includes("repeat")) return { type: "read-round" };
    if (normalized.includes("undo") && normalized.includes("round")) return { type: "undo-last-round" };
    if (normalized.includes("finish game") || normalized.includes("end game") || normalized === "finish") return { type: "finish-game" };
    if (normalized === "ranking" || normalized.includes("scoreboard") || normalized.includes("who is winning") || normalized.includes("standings")) return { type: "read-ranking" };
  }

  if (hasPhrase(normalized, lexicon.repeat)) return { type: "repeat" };

  if (hasPendingRound || lexicon.correctionPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    const correction = correctionFrom(transcript, players, locale);
    if (correction) return correction;
  }

  return roundFrom(transcript, players, locale) ?? { type: "unknown", transcript };
}

export function parsePlayerNames(transcript: string, locale: Locale = "en"): string[] {
  const cleaned = locale === "pt-BR"
    ? transcript.replace(/^(os )?jogadores (sao|serao|são|serão)?\s*/i, "").replace(/\.$/, "").trim()
    : transcript.replace(/^(the )?players (are|will be)?\s*/i, "").replace(/\.$/, "").trim();
  if (!cleaned) return [];

  const conjunction = locale === "pt-BR" ? "e" : "and";
  const ignored = locale === "pt-BR" ? ["e", "jogador", "jogadores"] : ["and", "player", "players"];
  const commaParts = cleaned.split(/[,;]+/).map((part) => part.trim()).filter(Boolean);
  const conjunctionPattern = new RegExp(`\\s+${conjunction}\\s+`, "i");
  const expanded = commaParts.length > 1
    ? commaParts.flatMap((part) => part.split(conjunctionPattern))
    : cleaned.split(/\s+/).filter((part) => normalizeSpeech(part) !== conjunction);
  return expanded
    .map((name) => name.replace(new RegExp(`^${conjunction}\\s+`, "i"), "").trim())
    .filter((name) => name && !ignored.includes(normalizeSpeech(name)));
}

export function parseSetupVoiceCommand(transcript: string, hasNames: boolean, locale: Locale = "en"): SetupVoiceCommand {
  const normalized = normalizeSpeech(transcript);
  const lexicon = LEXICONS[locale];
  if (hasPhrase(normalized, lexicon.cancel)) return { type: "cancel" };
  if (hasPhrase(normalized, lexicon.confirm)) return { type: "confirm" };
  if (hasPhrase(normalized, lexicon.repeat)) return { type: "repeat" };

  const rename = locale === "pt-BR"
    ? transcript.match(/^\s*(?:corrigir|renomear)\s+(.+?)\s+para\s+(.+?)\s*$/i)
    : transcript.match(/^\s*(?:correct|rename|change)\s+(.+?)\s+(?:to|as)\s+(.+?)\s*$/i);
  if (rename) return { type: "rename", from: rename[1].trim(), to: rename[2].trim() };
  const add = locale === "pt-BR"
    ? transcript.match(/^\s*(?:adicionar|incluir)\s+(.+?)\s*$/i)
    : transcript.match(/^\s*(?:add|include)\s+(.+?)\s*$/i);
  if (add) return { type: "add", name: add[1].trim() };
  const remove = locale === "pt-BR"
    ? transcript.match(/^\s*(?:remover|excluir|tirar)\s+(.+?)\s*$/i)
    : transcript.match(/^\s*(?:remove|delete)\s+(.+?)\s*$/i);
  if (remove) return { type: "remove", name: remove[1].trim() };

  if (!hasNames) {
    const names = parsePlayerNames(transcript, locale);
    if (names.length > 0) return { type: "names", names };
  }
  return { type: "unknown" };
}
