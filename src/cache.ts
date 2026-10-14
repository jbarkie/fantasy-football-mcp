import type { CacheMeta, Cached, Game, LeaguePoints, PlayerMap } from "./types";

export const KEYS = {
  players: "players",
  espnPlayers: "espn:players",
  points: (leagueId: string, season: string, week: number) => `points:${leagueId}:${season}:${week}`,
  schedule: (season: string) => `schedule:${season}`,
  meta: "meta",
};

export interface KVLike {
  get(key: string, type: "text"): Promise<string | null>;
}

// Parsed values are kept in isolate memory so warm requests skip JSON parsing. The
// promise is stored, so concurrent reads of the same key share one parse.
const memo = new Map<string, { at: number; value: Promise<unknown> }>();
const MEMO_MS = 5 * 60 * 1000;

function read<T>(kv: KVLike, key: string): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value as Promise<T | null>;
  const value = kv.get(key, "text").then((text) => (text === null ? null : (JSON.parse(text) as T)));
  memo.set(key, { at: Date.now(), value });
  value.catch(() => memo.delete(key)); // don't cache failures
  return value;
}

export const clearMemo = () => memo.clear();

// Data gaps shared by every platform: stale caches, cache-job warnings for this week, and
// games with no kickoff time (their locks can't be known).
export const STALE_MS = 36 * 3600 * 1000;

export function staleGap(label: string, c: Cached<unknown> | null, now: Date): string[] {
  return c && now.getTime() - new Date(c.fetched_at).getTime() > STALE_MS ? [`${label} cache is stale (fetched ${c.fetched_at}).`] : [];
}

export function warningGaps(meta: CacheMeta | null, week: number): string[] {
  // Warnings name the weeks they affect; only surface ones for this week (or none named).
  return (meta?.warnings ?? []).flatMap((w) => {
    const weeks = [...w.matchAll(/week (\d+)/g)].map((m) => Number(m[1]));
    return weeks.length === 0 || weeks.includes(week) ? [`Cache warning: ${w}`] : [];
  });
}

export function kickoffGaps(games: Game[] | null, week: number): string[] {
  return games && games.some((g) => g.week === week && !g.kickoff)
    ? [`Some week ${week} games have no kickoff time; players in those games show locked: "unknown".`]
    : [];
}

export class DataCache {
  constructor(readonly kv: KVLike) {}
  players = () => read<Cached<PlayerMap>>(this.kv, KEYS.players);
  espnPlayers = () => read<Cached<PlayerMap>>(this.kv, KEYS.espnPlayers);
  points = (leagueId: string, season: string, week: number) => read<Cached<LeaguePoints>>(this.kv, KEYS.points(leagueId, season, week));
  schedule = (season: string) => read<Cached<Game[]>>(this.kv, KEYS.schedule(season));
  meta = () => read<CacheMeta>(this.kv, KEYS.meta);
}
