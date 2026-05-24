/**
 * Read-time run deduplication.
 *
 * Multiple feed paths (Strava sync, watch upload, Apple Health import) often
 * write the SAME physical run as separate rows: a 7.8 mi Strava activity, the
 * watch's own 7.2 mi upload of the same session, plus segmented 1.2 mi + 6 mi
 * fragments from a paused-then-resumed recording. The user sees 4 entries for
 * what was one run, and downstream surfaces (weekly mileage, VDOT signals)
 * double-count.
 *
 * This module collapses overlapping runs at read time, no DB writes. Group
 * runs by start-time proximity (default 15 min — runs in practice are 30+ min
 * apart, so a 15 min window only ever matches the SAME session). Pick a
 * canonical per group by source-rank then largest distance; carry the merged
 * source ids on the canonical so the UI can show "merged from N" + offer an
 * unmerge.
 *
 * Conservative on purpose: a 1 mi crash run + an 11 mi completed run started
 * 30 min apart STAY SEPARATE — distinct sessions. A user can also pin a run
 * as "keep separate" (see /api/runs/[id]/unmerge), which the grouper honors.
 */

import type { NormalizedActivity } from '../app/api/strava/activities/route-shared';

/** Source-quality rank: Strava (rich detail) > watch (HR + planned link) >
 *  Apple Health (just totals). Higher number wins canonical pick. */
function sourceRank(name: string | undefined, idIsPositive: boolean): number {
  // Strava activities have positive ids (their real activity id). Synthetic
  // canonical writes (watch, health) use negative ids.
  if (idIsPositive) return 3;
  const n = (name || '').toLowerCase();
  if (n.includes('watch')) return 2;
  return 1; // apple-health or unknown
}

/** A run that has been collapsed into another. Carried on the canonical's
 *  `mergedSources` array so the UI can show provenance + offer unmerge. */
export interface MergedSource {
  id: number;
  name: string;
  distanceMi: number;
  movingTimeS: number;
  startLocal: string;
  /** "strava" | "watch" | "apple-health" | etc. */
  source: string;
}

/** Canonical run + the list of merged sources collapsed into it. */
export interface DedupedRun extends NormalizedActivity {
  /** Other rows that represent the same physical session and were folded
   *  into this canonical. Empty when this run had no duplicates. */
  mergedSources: MergedSource[];
}

/** Set of activity ids the user has explicitly pinned as "keep separate".
 *  These will never be folded into another canonical, regardless of
 *  start-time proximity. Loaded from run_merge_overrides. */
export type KeepSeparateIds = ReadonlySet<number>;

/** Optional manual merge override: forces these ids to collapse into the
 *  target id even if their start times wouldn't otherwise match. Loaded
 *  from run_merge_overrides where mode='merge-into'. */
export type ForceMergeMap = ReadonlyMap<number, number>; // sourceId -> targetCanonicalId

export interface DedupeOptions {
  /** ± minutes around start time considered "the same session". */
  toleranceMin?: number;
  /** Smaller-distance / larger-distance ratio that two rows must clear to
   *  auto-merge. Default 0.75 — Strava 7.8 + watch 7.2 of the SAME session
   *  (ratio 0.92) merges; a 1mi crash + 11mi restart (ratio 0.09) does NOT,
   *  even if their starts overlap. Conservative on purpose: better to leave
   *  a real dupe split and let the user manually merge than to false-merge
   *  a crash-restart and silently hide the partial run's stats. */
  distanceRatioMin?: number;
  keepSeparate?: KeepSeparateIds;
  forceMerge?: ForceMergeMap;
}

/**
 * Group activities by start-time proximity, return one DedupedRun per group.
 * Stable: input order doesn't change the canonical pick (uses source rank +
 * distance tie-break). Idempotent: re-running on an already-deduped list is
 * a no-op.
 */
export function dedupeRunsForDisplay(
  runs: NormalizedActivity[],
  opts: DedupeOptions = {},
): DedupedRun[] {
  const tolMs = (opts.toleranceMin ?? 15) * 60_000;
  const ratioMin = opts.distanceRatioMin ?? 0.75;
  const keepSeparate = opts.keepSeparate ?? new Set<number>();
  const forceMerge = opts.forceMerge ?? new Map<number, number>();

  // Sort by start ascending so groups form deterministically and the
  // canonical's start is the earliest in the group.
  const sorted = runs.slice().sort((a, b) => a.startLocal.localeCompare(b.startLocal));

  // Phase 1: build groups. Each group is { canonical, sources: [...] }.
  type Group = { canonical: NormalizedActivity; sources: NormalizedActivity[] };
  const groups: Group[] = [];
  const idToGroup = new Map<number, Group>();

  // Pass 1: place keep-separate rows into their own singleton groups first,
  // so they're never absorbed by another. Forced-merge sources will be
  // placed alongside their target in pass 2.
  for (const r of sorted) {
    if (keepSeparate.has(r.id) && !forceMerge.has(r.id)) {
      const g: Group = { canonical: r, sources: [] };
      groups.push(g);
      idToGroup.set(r.id, g);
    }
  }

  // Pass 2: place remaining rows into the best matching group, or open a new one.
  for (const r of sorted) {
    if (idToGroup.has(r.id)) continue; // already placed in pass 1

    // Forced merge: if user pinned this run as "merge into X", attach to X's group.
    const forcedTarget = forceMerge.get(r.id);
    if (forcedTarget != null) {
      const g = idToGroup.get(forcedTarget);
      if (g) {
        g.sources.push(r);
        idToGroup.set(r.id, g);
        continue;
      }
      // Target hasn't been placed yet — fall through to time-based grouping;
      // we'll catch it on a later pass.
    }

    const startMs = Date.parse(r.startLocal);
    if (!Number.isFinite(startMs)) {
      // No usable start — singleton group, can't be merged.
      const g: Group = { canonical: r, sources: [] };
      groups.push(g);
      idToGroup.set(r.id, g);
      continue;
    }

    // Find a group whose canonical starts within tolerance AND has a
    // distance close enough to be the same physical session (ratio guard
    // — 1mi crash + 11mi restart MUST NOT auto-merge, even though their
    // starts overlap).
    let host: Group | null = null;
    for (const g of groups) {
      if (keepSeparate.has(g.canonical.id)) continue;
      const gStartMs = Date.parse(g.canonical.startLocal);
      if (!Number.isFinite(gStartMs)) continue;
      if (Math.abs(gStartMs - startMs) > tolMs) continue;
      const a = Math.max(g.canonical.distanceMi, r.distanceMi);
      const b = Math.min(g.canonical.distanceMi, r.distanceMi);
      if (a <= 0) continue;
      if (b / a < ratioMin) continue;
      host = g;
      break;
    }

    if (host) {
      host.sources.push(r);
      idToGroup.set(r.id, host);
      // Re-pick canonical if this newcomer outranks the current one (richer
      // source OR same rank + larger distance).
      if (compareForCanonical(r, host.canonical) > 0) {
        const old = host.canonical;
        host.canonical = r;
        host.sources = host.sources.filter((s) => s.id !== r.id);
        host.sources.push(old);
      }
    } else {
      const g: Group = { canonical: r, sources: [] };
      groups.push(g);
      idToGroup.set(r.id, g);
    }
  }

  // Phase 2: emit one DedupedRun per group, with mergedSources attached.
  return groups
    .map<DedupedRun>((g) => ({
      ...g.canonical,
      mergedSources: g.sources.map((s) => ({
        id: s.id,
        name: s.name,
        distanceMi: s.distanceMi,
        movingTimeS: s.movingTimeS,
        startLocal: s.startLocal,
        source: s.name?.toLowerCase().includes('watch') ? 'watch' : 'strava',
      })),
    }))
    // Restore "most-recent first" ordering that callers expect.
    .sort((a, b) => b.startLocal.localeCompare(a.startLocal));
}

/** Positive return = `a` should be canonical over `b`. Compares source rank
 *  first, then distance. */
function compareForCanonical(a: NormalizedActivity, b: NormalizedActivity): number {
  const aRank = sourceRank(a.name, a.id > 0);
  const bRank = sourceRank(b.name, b.id > 0);
  if (aRank !== bRank) return aRank - bRank;
  return a.distanceMi - b.distanceMi;
}
