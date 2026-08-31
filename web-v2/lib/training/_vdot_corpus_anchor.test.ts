/**
 * _vdot_corpus_anchor.test.ts · THE CORPUS IS THE ANCHOR (2026-08-30).
 *
 * The owner's ruling: fitness is inferred from the RUNNING. A race is one
 * input among hundreds, not the root and not the ceiling. See
 * `lib/training/vdot-corpus.ts` for the reasoning; this file is the gate.
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ─────────────────────────────
 *
 * Every fixture here is synthetic and internally consistent, so the suite is
 * structurally incapable of catching:
 *
 *  · A CORPUS THAT IS UNIFORMLY WRONG. Three sessions on a short-measuring
 *    GPS course, or a treadmill reading fast, corroborate each other
 *    perfectly. Corroboration defends against one bad row, never against a
 *    bad instrument, and no assertion below can tell the two apart. The
 *    per-row defences (`clockDisprovedBySplits`, `lib/runs/coherence.ts`,
 *    `passesRunHonestyGate`) are what stand there, and the downstream
 *    seasonal-gain bound in `recompute-paces.ts#maxSeasonalVdotGain` is what
 *    limits how fast a re-anchor may spend the result.
 *  · WHETHER THE NUMBER IS RIGHT FOR A HUMAN. It asserts the selection
 *    ALGEBRA — which evidence bounds which — not that a runner whose tempos
 *    read 48 can race a 48. That is a claim about physiology this file makes
 *    nowhere.
 *  · THE LOADER. `loadVdotInputs` decides which rows become candidates at
 *    all; nothing here executes SQL, so a window bug upstream is invisible to
 *    it. `vdot-inputs-window.test.ts` is the suite that owns that.
 *
 * ── BALANCE (Rule 22) ────────────────────────────────────────────────────
 *
 * Counted deliberately, because a gate written by the same reasoning as the
 * engine inherits its instinct. Cases where the corpus must RAISE the read:
 * 5. Cases where it must REFUSE to, or must be bounded: 6. The suite is not
 * allowed to be one-sided in either direction, and the two halves are named
 * in the describe blocks so the count stays checkable.
 */
import { describe, it, expect } from 'vitest';
import { bestRecentVdot, vdotFromTpace, TRAINING_ESTIMATE_SOFT_CAP_VDOT } from '@/lib/training/vdot';
import {
  corroboratedCorpusVdot,
  CORROBORATION_MIN_OBSERVATIONS,
} from '@/lib/training/vdot-corpus';

const TODAY = '2026-10-12';

/** A slow A-race half — the kind the owner says must stop being the root.
 *  1:41:53 over 13.1 mi reads VDOT 44.1. */
const SLOW_RACE = [{
  slug: 'afc', name: 'AFC Half', date: '2026-09-20', priority: 'A',
  distance_mi: 13.1, finish_seconds: 6113,
}];

/** `n` threshold sessions, one every 4 days back from TODAY, at `paceSPerMi`. */
function sessions(n: number, paceSPerMi: number, tag = 't') {
  return Array.from({ length: n }, (_, i) => ({
    id: `${tag}${i}`,
    date: new Date(Date.parse(TODAY + 'T12:00:00Z') - (i * 4 + 2) * 86400000)
      .toISOString().slice(0, 10),
    workout_type: 'threshold',
    distance_mi: 5,
    finish_seconds: Math.round(5 * paceSPerMi),
    avg_hr: 168, max_hr: 188, zone: 'threshold' as const,
  }));
}

function read(races: unknown[], runs: unknown[]) {
  return bestRecentVdot(races as never, TODAY, 180, runs as never, 4);
}

// ─────────────────────────────────────────────────────────────────────────
describe('the corpus can RAISE the read · the upward half', () => {
  it('a runner with NO RACE AT ALL gets a real anchor from training alone', () => {
    // The day-one path for every new user, and the owner's stated requirement:
    // "What if another runner doesn't have a past race? ... We anchor it into
    // the evidence."
    const r = read([], sessions(6, 425));
    expect(r.best).not.toBeNull();
    expect(r.best!.source).toBe('run');
    expect(r.corpus.ok).toBe(true);
    // The read is the sessions' own zone-implied VDOT, uncapped by anything.
    expect(r.best!.vdot).toBeCloseTo(vdotFromTpace(425)!, 5);
  });

  it('a badly-paced race no longer caps a well-evidenced runner', () => {
    // THE DEFECT THIS CHANGE EXISTS FOR. Same corpus, with and without a slow
    // race in scope. Before, the race set `bestRaceRaw + 1` as the ceiling and
    // every training read was clamped to it; the runner's whole training
    // history was worth one point above one bad day.
    const withRace = read(SLOW_RACE, sessions(6, 425));
    const withoutRace = read([], sessions(6, 425));
    expect(withRace.best!.vdot).toBeCloseTo(withoutRace.best!.vdot, 5);
    // And it is far above what the race alone would have licensed.
    expect(withRace.best!.vdot).toBeGreaterThan(44.1 + TRAINING_ESTIMATE_SOFT_CAP_VDOT);
  });

  it('the ceiling is made of the corpus, not of a race', () => {
    const r = read(SLOW_RACE, sessions(6, 425));
    expect(r.corpus.ok).toBe(true);
    if (!r.corpus.ok) return;
    // Stated as an identity rather than a magnitude: whatever the corpus says,
    // that plus the doctrinal lead is what bounds a single session.
    const ceiling = r.corpus.vdot + TRAINING_ESTIMATE_SOFT_CAP_VDOT;
    for (const c of r.considered) {
      if (c.source === 'run') expect(c.vdot_raw).toBeLessThanOrEqual(ceiling + 1e-9);
    }
  });

  it('more good training keeps moving it · the ceiling is not a function of one day', () => {
    const slower = read(SLOW_RACE, sessions(6, 455)).best!.vdot;
    const faster = read(SLOW_RACE, sessions(6, 425)).best!.vdot;
    expect(faster).toBeGreaterThan(slower);
  });

  it('names WHICH runs set the level · a number that decides paces is answerable', () => {
    // Rule 21's observability half. "Has this ever pushed up, and on what
    // evidence" must be answerable without re-deriving anything.
    const r = read(SLOW_RACE, sessions(6, 425));
    expect(r.corpus.ok).toBe(true);
    if (!r.corpus.ok) return;
    expect(r.corpus.supporting).toHaveLength(CORROBORATION_MIN_OBSERVATIONS);
    expect(r.corpus.observations).toBe(6);
    for (const o of r.corpus.supporting) expect(o.id).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('the corpus must REFUSE · the downward half', () => {
  it('ONE standout session cannot set the level · corroboration, not cherry-picking', () => {
    // The phantom-5K shape (CLAUDE.md §Race-data) and the 2026-08-11
    // broken-clock row, in one assertion. A single fast read among modest ones
    // must not become the anchor.
    const modest = sessions(5, 470, 'm');           // ~VDOT 42-43
    const standout = sessions(1, 380, 'x');          // a wildly fast outlier
    const r = read([], [...standout, ...modest]);
    const modestVdot = vdotFromTpace(470)!;
    // The level is the modest corpus, not the outlier.
    expect(r.corpus.ok).toBe(true);
    if (!r.corpus.ok) return;
    expect(r.corpus.vdot).toBeCloseTo(modestVdot, 5);
    // The outlier is admitted but bounded to the corroborated level + the
    // doctrinal lead. It leads; it does not define.
    expect(r.best!.vdot).toBeCloseTo(modestVdot + TRAINING_ESTIMATE_SOFT_CAP_VDOT, 5);
    expect(r.best!.vdot).toBeLessThan(vdotFromTpace(380)!);
  });

  it('below the corroboration minimum the corpus REFUSES, and the race bounds again', () => {
    // A runner in their first fortnight. Two good sessions are not yet a
    // corpus, and the honest answer is the race-anchored ceiling that has
    // always applied — not an unbounded read off two lucky days.
    const r = read(SLOW_RACE, sessions(CORROBORATION_MIN_OBSERVATIONS - 1, 425));
    expect(r.corpus.ok).toBe(false);
    if (r.corpus.ok) return;
    expect(r.corpus.reason).toBe('insufficient_corroboration');
    expect(r.best!.vdot).toBeCloseTo(44.1 + TRAINING_ESTIMATE_SOFT_CAP_VDOT, 5);
  });

  it('"no runs" and "not enough runs" are different facts (Rule 11)', () => {
    const none = read(SLOW_RACE, []);
    expect(none.corpus.ok).toBe(false);
    if (none.corpus.ok) return;
    expect(none.corpus.reason).toBe('no_observations');
    expect(none.corpus.observations).toBe(0);

    const some = read(SLOW_RACE, sessions(1, 425));
    expect(some.corpus.ok).toBe(false);
    if (some.corpus.ok) return;
    expect(some.corpus.reason).toBe('insufficient_corroboration');
    expect(some.corpus.observations).toBe(1);
  });

  it('a race still wins when it is genuinely the best evidence', () => {
    // "A race still matters." Mediocre training under a strong race must
    // resolve to the race — the change removes the race as a CEILING, it does
    // not demote the race as EVIDENCE.
    const r = read(SLOW_RACE, sessions(6, 520));   // sessions well below race pace
    expect(r.best!.source).toBe('race');
    expect(r.best!.vdot).toBeCloseTo(44.1, 1);
  });

  it('the refusal carries no vdot · a "don\'t know" cannot be spent as a number', () => {
    const r = corroboratedCorpusVdot([]);
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty('vdot');
  });

  it('the read is an ORDER statistic · adding slow runs cannot lower it', () => {
    // The Rule 8 argument in `vdot-corpus.ts`'s header, as a test: taper days,
    // recovery jogs and post-race shuffles are observations BELOW the level,
    // and the Kth-highest is a function of the top K only.
    const base = sessions(4, 425, 'a');
    const withJunk = [...base, ...sessions(8, 560, 'j')];
    const a = read([], base);
    const b = read([], withJunk);
    expect(a.corpus.ok && b.corpus.ok).toBe(true);
    if (!a.corpus.ok || !b.corpus.ok) return;
    expect(b.corpus.vdot).toBeCloseTo(a.corpus.vdot, 5);
    expect(b.best!.vdot).toBeCloseTo(a.best!.vdot, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('the order statistic itself', () => {
  it('is the Kth highest, and no single value moves it', () => {
    const obs = [90, 50, 49, 48, 47].map((v, i) => ({ id: `o${i}`, date: TODAY, vdot: v }));
    const r = corroboratedCorpusVdot(obs, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.vdot).toBe(49);
    // Raise the top observation arbitrarily · the level does not move.
    const raised = corroboratedCorpusVdot(
      obs.map((o) => (o.vdot === 90 ? { ...o, vdot: 200 } : o)), 3);
    expect(raised.ok && raised.vdot).toBe(49);
  });
});
