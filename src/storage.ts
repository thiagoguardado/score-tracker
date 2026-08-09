import { z } from "zod";
import type { AppState } from "./types";

export const STORAGE_KEY = "score-tracker:state:v1";
const RECOVERY_PREFIX = "score-tracker:recovery:";

const PlayerSchema = z.object({ id: z.string(), name: z.string().min(1) });
const RoundSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  source: z.enum(["voice", "manual"]),
  scores: z.record(z.string(), z.number().int().safe()),
});
const GameSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: z.enum(["active", "finished"]),
  players: z.array(PlayerSchema),
  rounds: z.array(RoundSchema),
});
const StateSchema = z.object({ version: z.literal(1), games: z.array(GameSchema) });

export const EMPTY_STATE: AppState = { version: 1, games: [] };

export function loadState(): AppState {
  if (typeof window === "undefined") return EMPTY_STATE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return EMPTY_STATE;
  try {
    return StateSchema.parse(JSON.parse(raw));
  } catch {
    try {
      window.localStorage.setItem(`${RECOVERY_PREFIX}${new Date().toISOString()}`, raw);
    } catch {
      // Recovery is best effort when storage is unavailable or full.
    }
    return EMPTY_STATE;
  }
}

export function saveState(state: AppState): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
