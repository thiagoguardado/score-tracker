import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { loadState, saveState } from "./storage";
import type { AppState, Game, PlayerId, Round } from "./types";

type Action =
  | { type: "add-game"; game: Game }
  | { type: "update-game"; gameId: string; update: (game: Game) => Game }
  | { type: "delete-game"; gameId: string };

type StoreValue = {
  state: AppState;
  storageHealthy: boolean;
  createGame: (names: string[]) => string;
  deleteGame: (gameId: string) => void;
  addRound: (gameId: string, scores: Record<PlayerId, number>, source: Round["source"]) => void;
  updateRound: (gameId: string, roundId: string, scores: Record<PlayerId, number>) => void;
  deleteRound: (gameId: string, roundId: string) => void;
  renamePlayer: (gameId: string, playerId: PlayerId, name: string) => void;
  addPlayer: (gameId: string, name: string) => void;
  removePlayer: (gameId: string, playerId: PlayerId) => void;
  finishGame: (gameId: string) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

function uniqueId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function reducer(state: AppState, action: Action): AppState {
  if (action.type === "add-game") return { ...state, games: [action.game, ...state.games] };
  if (action.type === "delete-game") return { ...state, games: state.games.filter((game) => game.id !== action.gameId) };
  return {
    ...state,
    games: state.games.map((game) => (game.id === action.gameId ? action.update(game) : game)),
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [storageHealthy, setStorageHealthy] = useState(true);

  useEffect(() => {
    setStorageHealthy(saveState(state));
  }, [state]);

  const createGame = useCallback((names: string[]) => {
    const startedAt = new Date().toISOString();
    const game: Game = {
      id: startedAt,
      startedAt,
      status: "active",
      players: names.map((name) => ({ id: uniqueId(), name: name.trim() })),
      rounds: [],
    };
    dispatch({ type: "add-game", game });
    return game.id;
  }, []);

  const update = useCallback((gameId: string, updater: (game: Game) => Game) => {
    dispatch({ type: "update-game", gameId, update: updater });
  }, []);

  const value = useMemo<StoreValue>(() => ({
    state,
    storageHealthy,
    createGame,
    deleteGame: (gameId) => dispatch({ type: "delete-game", gameId }),
    addRound: (gameId, scores, source) => update(gameId, (game) => ({
      ...game,
      rounds: [...game.rounds, { id: uniqueId(), createdAt: new Date().toISOString(), source, scores }],
    })),
    updateRound: (gameId, roundId, scores) => update(gameId, (game) => ({
      ...game,
      rounds: game.rounds.map((round) => (round.id === roundId ? { ...round, scores } : round)),
    })),
    deleteRound: (gameId, roundId) => update(gameId, (game) => ({
      ...game,
      rounds: game.rounds.filter((round) => round.id !== roundId),
    })),
    renamePlayer: (gameId, playerId, name) => update(gameId, (game) => ({
      ...game,
      players: game.players.map((player) => (player.id === playerId ? { ...player, name: name.trim() } : player)),
    })),
    addPlayer: (gameId, name) => update(gameId, (game) => ({
      ...game,
      players: [...game.players, { id: uniqueId(), name: name.trim() }],
    })),
    removePlayer: (gameId, playerId) => update(gameId, (game) => ({
      ...game,
      players: game.players.filter((player) => player.id !== playerId),
      rounds: game.rounds.map((round) => {
        const scores = { ...round.scores };
        delete scores[playerId];
        return { ...round, scores };
      }),
    })),
    finishGame: (gameId) => update(gameId, (game) => ({
      ...game,
      status: "finished",
      finishedAt: game.finishedAt ?? new Date().toISOString(),
    })),
  }), [createGame, state, storageHealthy, update]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useAppStore precisa estar dentro de AppProvider");
  return value;
}
