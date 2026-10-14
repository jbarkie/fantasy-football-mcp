// Slot eligibility. Slots are filled from most to least restrictive; for nested
// eligibility sets like these (RB ⊂ FLEX ⊂ SUPER_FLEX) greedy filling is optimal.
export const SLOT_ELIGIBLE: Record<string, string[]> = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

export interface LineupPlayer {
  id: string;
  positions: string[];
  points: number | null; // null = no projection
  locked: boolean | "unknown";
  unavailable?: string; // e.g. "Out", "bye", "excluded"
}

export interface LineupResult {
  slots: Array<{ slot: string; id: string | null; points: number | null; fixed: boolean }>;
  total: number | null; // null when any filled slot has no projection
  known_total: number; // sum of the projections that exist
  unsupported_slots: string[];
}

// Shared by every platform's lineup tool so the model gets the same rules everywhere.
export const LINEUP_NOTE =
  "Locked or lock-unknown players stay where they are, even if excluded (see locked_exclusions). " +
  "Players ruled out (Out/IR/suspended) or on bye are never started. Starters with no projection stay in place and " +
  "unprojected bench players are never moved in, so totals are null when a starter has no projection " +
  "(gain still compares the projected players). An empty slot means no projected eligible player; pick one manually.";

// A lineup total is only known when every player in it has a projection. known_total is
// still useful for comparing two lineups that share the same unprojected players.
export function sumProjections(points: Array<number | null>) {
  const known = Math.round(points.reduce<number>((a, p) => a + (p ?? 0), 0) * 100) / 100;
  return { total: points.some((p) => p === null) ? null : known, known_total: known };
}

// currentStarters is aligned with starterSlots (Sleeper's `starters` array, "0" = empty).
export function optimizeLineup(starterSlots: string[], players: LineupPlayer[], currentStarters: string[]): LineupResult {
  const byId = new Map(players.map((p) => [p.id, p]));
  const used = new Set<string>();
  const result: LineupResult["slots"] = starterSlots.map((slot) => ({ slot, id: null, points: 0, fixed: false }));
  const unsupported = starterSlots.filter((s) => !SLOT_ELIGIBLE[s]);

  // A player whose game has started (or might have) cannot be moved: keep locked starters
  // in place, and never move a locked bench player in. Locks win over every other reason
  // to bench someone, including an explicit exclusion.
  // Without a projection there is no basis for a swap: an available starter with no
  // projection stays, and a bench player with no projection is never moved in.
  const isLocked = (p: LineupPlayer | undefined) => p !== undefined && p.locked !== false;
  const keepUnprojected = (p: LineupPlayer | undefined) => p !== undefined && p.points === null && !p.unavailable;
  starterSlots.forEach((slot, i) => {
    const p = byId.get(currentStarters[i]);
    if (isLocked(p) || keepUnprojected(p) || !SLOT_ELIGIBLE[slot]) {
      result[i] = { slot, id: currentStarters[i] && currentStarters[i] !== "0" ? currentStarters[i] : null, points: p ? p.points : 0, fixed: true };
      if (p) used.add(p.id);
    }
  });
  for (const p of players) if (isLocked(p)) used.add(p.id);

  const order = starterSlots
    .map((slot, i) => ({ slot, i }))
    .filter(({ i }) => !result[i].fixed)
    .sort((a, b) => SLOT_ELIGIBLE[a.slot].length - SLOT_ELIGIBLE[b.slot].length);

  for (const { slot, i } of order) {
    const best = players
      .filter((p) => !used.has(p.id) && !p.unavailable && p.points !== null && p.positions.some((x) => SLOT_ELIGIBLE[slot].includes(x)))
      .sort((a, b) => b.points! - a.points!)[0];
    if (best) {
      used.add(best.id);
      result[i] = { slot, id: best.id, points: best.points, fixed: false };
    }
  }
  return { slots: result, ...sumProjections(result.map((s) => s.points)), unsupported_slots: [...new Set(unsupported)] };
}
