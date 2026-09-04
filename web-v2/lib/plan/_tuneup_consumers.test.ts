/**
 * TUNEUPTYPE-1 · what the five "consumers" actually do, and the correction.
 *
 * ── THE CLAIM THIS FILE RETRACTS ───────────────────────────────────────────
 *
 * `docs/reports/core-closure-2026-09-04/BASELINE-PLAN-AUDIT.md` originally
 * reported that the live block's `type = 'race_week_tuneup'` row on 2026-11-17
 * — nineteen days before CIM — inherited FIVE exemptions it had not earned:
 * adapter protection, exemption from pace recompute, pricing off the stated
 * GOAL, no effort cue, and no session on the Watch.
 *
 * **Three of those five were wrong, and this file is the correction.**
 *
 * The error was reading `RECOMPUTE_EXEMPT_TYPES` as "nothing re-prices this
 * row" without checking whether something ELSE does. Something else does:
 * `lib/race/race-row-refresh.ts:603` selects
 *
 *     WHERE pw.plan_id = $1 AND pw.type IN ('race', 'race_week_tuneup')
 *
 * and re-prices both from the race-pace brain on every recompute. The generic
 * evidence-time loop skips them precisely BECAUSE a dedicated owner has them —
 * which is Rule 16 working, not a gap in it. A tune-up's pace is not frozen and
 * never was.
 *
 * The doctrine registry already said so, and it is what caught the mistake:
 * `CONVENTION.calibration-intro-window` asserts in its own words that race day
 * and the race-week tune-up "are priced by the race-pace brain's own refresh
 * path (lib/race/race-row-refresh.ts, 2026-09-01), never by the generic
 * evidence-time recompute loop". An attempt to route those rows through the
 * generic loop and to add the type to `EFFORT_CUED_TYPES` failed that claim,
 * and the claim was right. Both changes were reverted rather than the claim
 * loosened (CLAUDE.md Rule 7: fix the engine, never widen the claim).
 *
 * ── WHAT SURVIVES ──────────────────────────────────────────────────────────
 *
 *   · The NAME is still odd on a non-race week — Rule 16 on a type name. Held
 *     by the ratchet in `_layout_contract.test.ts` at 3,475, may shrink and
 *     never grow.
 *   · The WATCH consequence is real and separate:
 *     `lib/onboarding/_onboarding_e2e.test.ts` measures 127 instances of the
 *     wrist getting "No workout scheduled" for these rows. It is tracked there,
 *     in that file's KNOWN list, with its own measurement.
 *
 * This file exists so the retraction is a GATE and not a paragraph. If someone
 * reads the original audit and tries the same three "fixes" again, these
 * assertions say why they were reverted.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22): it asserts ownership and routing, not
 * whether the race-pace brain prices a tune-up WELL. That is
 * `lib/race/_race_row_refresh*.test.ts`'s question.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACE_PROTECTED_TYPES } from './adapt';
import { EFFORT_CUED_TYPES } from './anchor-provenance';
import { narrowToPrescriptionType } from '@/lib/training/prescriptions';

const WEB = join(__dirname, '..', '..');

describe('TUNEUPTYPE-1 · the tune-up row has ONE pricing owner, and it is not the generic loop', () => {
  it('the race-pace brain owns race AND race_week_tuneup rows', () => {
    // THE FACT THAT RETRACTS THREE FIFTHS OF THE ORIGINAL FINDING.
    const src = readFileSync(join(WEB, 'lib/race/race-row-refresh.ts'), 'utf8');
    expect(src).toMatch(/pw\.type IN \('race', 'race_week_tuneup'\)/);
  });

  it('so the generic recompute loop deliberately skips them — one writer, not none', () => {
    const src = readFileSync(join(WEB, 'lib/plan/recompute-paces.ts'), 'utf8');
    expect(src).toMatch(/RECOMPUTE_EXEMPT_TYPES = \[[^\]]*'race_week_tuneup'[^\]]*\]/);
  });

  it('and the effort-cue set correctly excludes them · a race-brain pace is not fabricated', () => {
    // The calibration intro withholds a pace the engine INVENTED off a
    // provisional anchor. A tune-up's pace comes from the race brain, so there
    // is nothing to withhold. `CONVENTION.calibration-intro-window` enforces
    // this and failed when it was changed.
    expect(EFFORT_CUED_TYPES.has('race_week_tuneup')).toBe(false);
    expect(EFFORT_CUED_TYPES.has('race')).toBe(false);
    for (const t of ['threshold', 'intervals', 'tempo']) expect(EFFORT_CUED_TYPES.has(t)).toBe(true);
  });

  it('adapter protection stays, and is consistent with that ownership', () => {
    // Shaving a row the race machinery prices would put two owners in conflict
    // over the same session. The protection is the same claim as the pricing.
    expect([...RACE_PROTECTED_TYPES]).toContain('race_week_tuneup');
    expect([...RACE_PROTECTED_TYPES]).toContain('race');
  });

  it('the WATCH consequence is the one that survives, and it is tracked', () => {
    // Real, measured at 127 instances, and separate from the pricing question.
    // The narrowing exists; what the onboarding sweep still finds is the
    // fallback path, and that file's KNOWN list carries the measurement.
    expect(narrowToPrescriptionType('race_week_tuneup')).toBe('threshold');
    const known = readFileSync(join(WEB, 'lib/onboarding/_onboarding_e2e.test.ts'), 'utf8');
    expect(known).toMatch(/WATCH_FALLBACK_HAS_NO_SESSION_IN_IT/);
    expect(known).toMatch(/RE-MEASURED 2026-09-04: 127 instances/);
  });
});
