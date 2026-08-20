/**
 * lib/race/next-best-anchor.ts · "did this race count?" → the fallback.
 *
 * `POST /api/v5/race-authority` asks the runner whether a race that moved
 * their paces actually counted. HARD CONSTRAINT (docs/faff-iphone-design-
 * contract.md §"The confirm on a slower read" and
 * docs/design/iphone-v5/reference/README-v5-handoff.md §18a): if the runner
 * says `compromised` or `unrepresentative`, the engine falls back to the
 * NEXT-BEST anchor — never to the old, pre-race paces. Reverting to "the
 * number before this race" would make the question a disguised "make me
 * faster" button; recomputing from the honest remaining evidence pool is the
 * only answer that is not that button, whatever direction it lands.
 *
 * This module is the pure core of that fallback: exclude the flagged race
 * from the candidate pool and ask `bestRecentVdot` — the SAME selection
 * function every other VDOT read in the app uses — what the next-best anchor
 * is. No DB access here; the route loads candidates via `loadVdotInputs` and
 * this function just re-selects over them.
 */
import {
  bestRecentVdot, VDOT_FULL_VALUE_DAYS,
  type VdotCandidate,
} from '@/lib/training/vdot';
import type { RaceVdotInput, RunVdotInput } from '@/lib/training/vdot-inputs';

export interface NextBestAnchor {
  vdot: number | null;
  source: 'race' | 'run' | null;
  /** Race slug or run id, whichever produced the fallback. Null when no
   *  evidence remains at all (the flagged race was the only anchor). */
  refId: string | null;
  /** The full candidate this VDOT came from, for callers that want more
   *  (date, distance, authority tier). Null alongside `vdot`. */
  candidate: VdotCandidate | null;
}

/**
 * Recompute the best VDOT anchor with one race EXCLUDED entirely from the
 * candidate pool — not de-weighted, not blended, gone. That is what "did
 * not count" means: the race is not evidence, full stop, and whatever the
 * runner's remaining honest history says is the answer, however it compares
 * to the number the flagged race had displaced.
 */
export function nextBestVdotExcludingRace(
  raceCandidates: readonly RaceVdotInput[],
  runCandidates: readonly RunVdotInput[],
  excludeSlug: string,
  todayISO: string,
  runFloorMi: number,
  lookbackDays: number = VDOT_FULL_VALUE_DAYS,
): NextBestAnchor {
  const filtered = raceCandidates.filter((r) => r.slug !== excludeSlug);
  const { best } = bestRecentVdot(
    filtered as RaceVdotInput[],
    todayISO,
    lookbackDays,
    runCandidates as RunVdotInput[],
    runFloorMi,
  );
  if (!best) return { vdot: null, source: null, refId: null, candidate: null };
  return {
    vdot: best.vdot,
    source: best.source,
    refId: best.source === 'race' ? best.slug : best.id,
    candidate: best,
  };
}
