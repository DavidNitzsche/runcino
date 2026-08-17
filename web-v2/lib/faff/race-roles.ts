/**
 * lib/faff/race-roles.ts · what a race's priority MEANS to the plan.
 *
 * Ruled in the web recomposition deck (Decision 3c): the Targets RACES beat
 * splits into CALENDAR and RESULTS, and calendar rows carry a role chip whose
 * caption states what the generator actually does with that race — not an
 * abstract "A race / Tune-up" tag that says nothing about the plan.
 *
 * The captions are read off the mid-block embedding the generator performs
 * (lib/plan/generate.ts · embedMidBlockRaces, landed 2026-08-17):
 *
 *   A · the goal race. The whole block points at it; it owns the taper.
 *   B · the calendar day BECOMES a race day standing in the week. The two
 *       preceding days ease, 1-4 days after run easy before quality resumes,
 *       and the week is flagged as a cutback.
 *   C · the race replaces the week's NEAREST QUALITY SLOT. The race is that
 *       week's quality: one easy day either side, no mini-taper, no
 *       recovery debt.
 *
 * A race with no stated priority is treated as C — that is exactly how
 * races-state buckets it (upcomingCs takes `priority === 'C' || null`), and
 * how the generator then embeds it.
 */

export type RaceRole = 'A' | 'B' | 'C';

export interface RaceRoleRead {
  role: RaceRole;
  /** One-line caption naming what the plan does with this race. */
  line: string;
  /** Short right-hand tag under the date. */
  tag: string;
  /** Palette token for the role chip. */
  tone: string;
}

const TONE: Record<RaceRole, string> = {
  A: '#D03F3F',
  B: '#F3AD38',
  C: '#8A90A0',
};

/**
 * Resolve the role read for a calendar row.
 *
 * `ownGoal` is the race's own goal time when the runner set one (a B tune-up
 * with a 45:00 target says so; one without stays silent rather than
 * inventing a number).
 */
export function resolveRaceRole(
  priority: 'A' | 'B' | 'C' | null | undefined,
  opts: { ownGoal?: string | null } = {},
): RaceRoleRead {
  const ownGoal = opts.ownGoal && opts.ownGoal.trim() ? opts.ownGoal.trim() : null;

  if (priority === 'A') {
    return {
      role: 'A',
      line: 'goal race · everything points here',
      tag: ownGoal ? `${ownGoal} goal` : 'goal race',
      tone: TONE.A,
    };
  }
  if (priority === 'B') {
    return {
      role: 'B',
      line: ownGoal
        ? `tune-up · race day in your plan · own goal ${ownGoal}`
        : 'tune-up · race day in your plan',
      tag: 'tune-up',
      tone: TONE.B,
    };
  }
  // C, and anything unstated · races-state buckets null with the Cs.
  return {
    role: 'C',
    line: ownGoal
      ? `converts a quality day · own goal ${ownGoal}`
      : 'converts a quality day · no taper, no recovery debt',
    tag: 'quality day',
    tone: TONE.C,
  };
}

export type RaceProvenance = 'official' | 'logged' | 'provisional';

export interface ProvenanceRead {
  label: string;
  /** The source of the time, stated under it. */
  source: string;
  tone: string;
  /** True when the time must not be presented as authoritative race
   *  performance (CLAUDE.md race-data Rule 3). */
  provisional: boolean;
}

/**
 * Provenance chip for a RESULTS row. Null in, null out — a past race with
 * no time at all gets no chip and the row says so instead.
 */
export function resolveProvenance(
  provenance: RaceProvenance | null | undefined,
): ProvenanceRead | null {
  if (provenance === 'official') {
    return { label: 'Official', source: 'Chip time', tone: '#86efa0', provisional: false };
  }
  if (provenance === 'logged') {
    return { label: 'Logged', source: 'You logged it', tone: '#27B4E0', provisional: false };
  }
  if (provenance === 'provisional') {
    // Rule 3 · a watch/Strava-matched time never displays as an
    // authoritative result. The chip says so at the row.
    return { label: 'Provisional', source: 'Watch time', tone: '#F3AD38', provisional: true };
  }
  return null;
}
