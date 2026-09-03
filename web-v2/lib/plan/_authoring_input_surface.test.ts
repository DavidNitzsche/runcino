/**
 * INPUT-SURFACE-1 (2026-09-02) · WHAT IS ALLOWED TO INFLUENCE THE PLAN.
 *
 * `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` names the inputs that may shape the
 * plan and the authorities that may not. That document is prose; this is the
 * check, because a product rule with no gate is a hypothesis (Rule 20).
 *
 * It reads `ComposePlanInput`'s own field list out of `generate.ts` and demands
 * that every field be classified. A new field cannot be added without deciding,
 * in this file, which of the runner's eleven allowed inputs it serves — which
 * is the point: the surface is small on purpose and should be hard to grow.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ──────────────────────────────────
 *
 * It checks the SHAPE of the input surface, not the USE of it. A field on the
 * allowed list that is read for the wrong purpose deep inside the composer
 * passes here. It cannot see a removed authority that reaches the plan by some
 * route other than this interface — a module-level import, a direct DB read
 * inside the composer, or a value smuggled inside `paceAnchors`. It says
 * nothing about whether the plan produced is any good. Those need their own
 * gates; `check-goal-pace-leak.sh` is the model for catching a value that
 * arrives by a side door.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'lib/plan/generate.ts');

/** The runner's allowed inputs, verbatim from the doctrine, and the fields
 *  that serve each. Every entry is a decision someone made on purpose. */
const ALLOWED: Record<string, string[]> = {
  'demonstrated running history': [
    'recentWeeklyMi', 'recentLongMi', 'recentQualityPerWeek',
    'recentQualityDistanceMi', 'easyDayMedianMi', 'spikeAnchorLongMi',
    'rampBaseMi', 'rampBaseEvidence',
    // LONGEVIDENCE-1 · long-run history, which the owner's list names in its
    // own right: the longest run he has actually completed in normal training
    // over the last year, races and their prescribed windows excluded. It is
    // what sets the block's long-run ceiling now, in place of the tier band
    // keyed to `level` — the authority this file's own ratchet is removing.
    'demonstratedLongMi',
    // DESIGNEDWEEKEND-1 · the same history read on the axis a race-plus-long-run
    // weekend actually proposes: the largest two-consecutive-day total he has
    // run in representative training, and the day it started.
    'demonstratedPairMi', 'demonstratedPairFromISO',
  ],
  'demonstrated pace capacity': [
    'tPaceSec', 'bestRecentVdot', 'seasonAnchorVdot', 'seasonAnchorSource',
    'paceAnchors', 'belowTableAnchor',
  ],
  'physiological anchors for HR prescription': ['lthr', 'maxHr'],
  'marathon durability evidence': ['thesisAtAuthoring'],
  'race date and distance': [
    'raceDateISO', 'raceDistanceMi', 'distanceMi', 'slug', 'name', 'courseTerrain',
  ],
  'stated goal, kept distinct from capacity': [
    'goalSec', 'goalPaceSec', 'goalPaceIsCoachSet',
  ],
  'available training days': [
    'availableDows', 'trainingDaysPerWeek', 'longRunDow', 'qualityDows', 'restDow',
  ],
  'completed versus future dates': ['date', 'startMondayISO', 'isMidBlock'],
  'race and tune-up schedule': [
    'horizonRaces', 'midBlockRaces', 'priority', 'plannedRole',
  ],
  'prescription shape requested by the block': ['rxQuality', 'rxRaceSpecific'],
  'declared availability constraints': ['travelWindows', 'crossModes'],
};

/**
 * REMOVED AUTHORITIES still present on the interface.
 *
 * A RATCHET. It may shrink, never grow, and a stale entry FAILS — so the
 * removal cannot be quietly abandoned, and cannot be quietly forgotten once
 * done. Each carries the measured harm that put it on the list.
 */
const STILL_PRESENT: Record<string, string> = {
  tsbAtStart:
    'Daily training form. cutbackCadence(tsb) = tsb < -10 ? 3 : 4 re-phased 13 '
    + 'of 15 weeks when his form moved from -6 to -11. Doctrine: cutback weeks '
    + 'are authored into the plan, not triggered by daily state.',
  level:
    'Self-declared experience-level band. profile.experience_level reads '
    + '"advanced" because he typed it at onboarding, yielding a 65-90 mi/wk peak '
    + 'band against a measured best week of 48.5 and zero weeks at 50+. '
    + 'Doctrine: his actual history, not an onboarding label, determines load.',
  bestRecentVdotSelfReported:
    'Self-reported capacity. Same class as the label above: a number he stated '
    + 'rather than one he demonstrated.',
};

function inputFields(): string[] {
  const src = fs.readFileSync(SRC, 'utf8');
  const i = src.indexOf('interface ComposePlanInput');
  expect(i, 'ComposePlanInput not found — this gate is reading the wrong file').toBeGreaterThan(-1);
  let depth = 0;
  const open = src.indexOf('{', i);
  let k = open;
  for (; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(open + 1, k)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');
  return [...new Set([...body.matchAll(/^\s*(\w+)\??\s*:/gm)].map((m) => m[1]))];
}

describe('INPUT-SURFACE-1 · only the doctrine\'s inputs may shape the plan', () => {
  const fields = inputFields();

  it('LIVENESS · the interface was actually read', () => {
    // A gate that reports clean because it parsed nothing is the worst outcome
    // available, since it also reports confidence (Rule 18).
    expect(fields.length, 'parsed zero fields — the parser has stopped matching')
      .toBeGreaterThan(20);
  });

  it('every input field is classified against an allowed input', () => {
    const classified = new Set([...Object.values(ALLOWED).flat(), ...Object.keys(STILL_PRESENT)]);
    const unclassified = fields.filter((f) => !classified.has(f));
    expect(
      unclassified,
      'A new field can shape the plan and nobody has said which of the runner\'s '
      + 'allowed inputs it serves. Add it to ALLOWED with the input it belongs to, '
      + 'or — if it is an authority the doctrine removed — do not add it at all.\n'
      + `  unclassified: ${unclassified.join(', ')}`,
    ).toEqual([]);
  });

  it('RATCHET · a removed authority that is gone must be struck from the list', () => {
    // The stale half. Finishing the removal and leaving the entry here would let
    // the list drift into fiction, which is how an allowlist quietly stops
    // meaning anything.
    const stale = Object.keys(STILL_PRESENT).filter((f) => !fields.includes(f));
    expect(
      stale,
      'These are no longer on ComposePlanInput. The removal is done — delete '
      + `them from STILL_PRESENT so the list keeps meaning what it says.\n  ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('RATCHET · no allowed field may quietly become a removed authority', () => {
    const overlap = Object.values(ALLOWED).flat().filter((f) => f in STILL_PRESENT);
    expect(overlap, 'a field cannot be both allowed and pending removal').toEqual([]);
  });
});
