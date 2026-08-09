export type PlayerId = string;

export type Player = {
  id: PlayerId;
  name: string;
};

export type Round = {
  id: string;
  createdAt: string;
  source: "voice" | "manual";
  scores: Record<PlayerId, number>;
};

export type Game = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: "active" | "finished";
  players: Player[];
  rounds: Round[];
};

export type AppState = {
  version: 1;
  games: Game[];
};

export type RankingEntry = {
  player: Player;
  total: number;
  position: number;
};

export type VoicePhase =
  | "idle"
  | "listening"
  | "parsing"
  | "speaking-review"
  | "awaiting-decision"
  | "applying"
  | "speaking-ranking"
  | "error";

export type VoiceStatus = {
  phase: VoicePhase;
  transcript: string;
  message: string;
  draftScores?: Record<PlayerId, number>;
};
