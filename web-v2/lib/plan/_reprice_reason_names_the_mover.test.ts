/**
 * lib/plan/_reprice_reason_names_the_mover.test.ts · REPRICESUBJECT-1.
 *
 * ── THE DEFECT, AS THE RUNNER MET IT ───────────────────────────────────────
 *
 * `plan_workout_proposals` id 12, raised into the owner's production account
 * at 2026-09-08T07:00:28Z against plan `pln_7636bcc0a201bf2d`. Headline:
 *
 *     "76 sessions ahead move to faster paces"
 *
 * Body, stored verbatim in `reason` and in `action_payload.why`:
 *
 *     "Your recent training puts your threshold at 7:10 per mile. This block
 *      is written at 7:10 per mile."
 *
 * David, reading it on his phone: "are paces already at 7:10?"
 *
 * They were. The payload's own `anchorMoves`, copied here EXACTLY as the row
 * carries them, say his threshold went 430 -> 430 — not a rounding artifact,
 * the same integer on both sides — and so did interval (401), repetition
 * (365) and marathon (472). The whole of the move was the easy ceiling
 * (502 -> 492) and the shakeout ceiling (532 -> 522), ten seconds per mile
 * faster each, which is what put `meanAnchorDeltaSecPerMi` at -3.33 and made
 * the HEADLINE correct.
 *
 * So the headline was right and the sentence under it cited the one anchor
 * that had measurably not moved, while naming neither of the two that had.
 * Rule 16: a sentence asserting a fact about a measurement is gated on that
 * measurement or it is not said.
 *
 * ── WHAT THIS FILE ASSERTS ─────────────────────────────────────────────────
 *
 *   1 · On David's exact numbers the sentence names an anchor that ACTUALLY
 *       moved, and cites two different paces.
 *   2 · It does not claim anything about his threshold, which did not move.
 *   3 · The ordinary case — threshold DID move — still produces the exact
 *       sentence that shipped, byte for byte. The fix may not be paid for
 *       with a regression on the common path.
 *   4 · A tie between two movers resolves deterministically, because on
 *       David's own row easy and shakeout moved by exactly the same 10 s/mi
 *       and an arbitrary winner would make the card depend on iteration order.
 *   5 · A sub-second move that both sides ROUND to the same displayed pace is
 *       not a mover. `fmtPace` is what the runner reads.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 *   · It cannot tell whether the repricing itself is CORRECT — whether 492
 *     is the right easy ceiling is `_recompute_paces.test.ts`'s question.
 *     This file only asks whether the sentence describes the payload it is
 *     attached to.
 *   · It cannot see the phone. `reason` is a string; whether the card renders
 *     it is `v5-proposals`' concern and Rule 13's.
 *   · It cannot catch a FUTURE surface that stops calling `repriceReason` and
 *     writes its own sentence. Only a scan can, and the three live call sites
 *     in `reanchor-plan.ts` plus `driftReason` in `pace-drift-autopropose.ts`
 *     are asserted to route through the shared `repriceSubject` by reading
 *     the source, below.
 *   · Its balance is deliberately even: it asserts what the sentence MUST say
 *     as strictly as what it must not, so a generator that went vague and
 *     stopped naming any anchor at all would fail here rather than pass by
 *     saying nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// `repriceReason` is a pure string function, but it lives in a module that
// reaches the pool. Mocked so this suite opens no connection and its verdict
// is about the sentence and nothing else.
vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

import { repriceReason } from './reanchor-plan';
import { repriceSubject, type RepriceAnchorMove } from './reprice-payload';

const HERE = __dirname;

/**
 * `action_payload.reprice.anchorMoves` from production row 12, transcribed
 * unaltered. Nothing here is invented or rounded for the test.
 */
const DAVID_MOVES: RepriceAnchorMove[] = [
  { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 430 },
  { key: 'interval_s_per_mi', fromSecPerMi: 401, toSecPerMi: 401 },
  { key: 'repetition_s_per_mi', fromSecPerMi: 365, toSecPerMi: 365 },
  { key: 'easy_ceiling_s_per_mi', fromSecPerMi: 502, toSecPerMi: 492 },
  { key: 'shakeout_ceiling_s_per_mi', fromSecPerMi: 532, toSecPerMi: 522 },
  { key: 'marathon_s_per_mi', fromSecPerMi: 472, toSecPerMi: 472 },
];

/** The exact sentence the runner was shown. The thing that must never recur. */
const THE_BAD_SENTENCE =
  'Your recent training puts your threshold at 7:10 per mile. This block is written at 7:10 per mile.';

describe('REPRICESUBJECT-1 · the repricing sentence names the anchor that moved', () => {
  it("reproduces David's row and no longer prints the sentence he was shown", () => {
    const out = repriceReason({
      arm: 'race-prep',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 430,
      moves: DAVID_MOVES,
      evidence: { source: 'run', refId: null },
    });
    // eslint-disable-next-line no-console
    console.log('[REPRICESUBJECT-1 · production row 12]', out);
    expect(out).not.toBe(THE_BAD_SENTENCE);
  });

  it('names an anchor that actually moved, and cites two different paces', () => {
    const out = repriceReason({
      arm: 'race-prep',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 430,
      moves: DAVID_MOVES,
      evidence: { source: 'run', refId: null },
    });

    // Rule 13 clause 3 · assert the SHAPE of what he reads, not the absence of
    // the bad string. An empty sentence satisfies "the bad string is gone".
    const subject = repriceSubject(DAVID_MOVES);
    expect(subject).not.toBeNull();
    expect(['easy_ceiling_s_per_mi', 'shakeout_ceiling_s_per_mi']).toContain(subject!.key);
    expect(out).toContain(subject!.label);

    // Both of the anchor's own numbers, and they are DIFFERENT numbers — the
    // whole defect was two identical paces in one comparison.
    const paces = out.match(/\d+:\d\d/g) ?? [];
    expect(paces).toHaveLength(2);
    expect(paces[0]).not.toBe(paces[1]);
  });

  it('says nothing about the threshold, which did not move', () => {
    const out = repriceReason({
      arm: 'race-prep',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 430,
      moves: DAVID_MOVES,
      evidence: { source: 'run', refId: null },
    });
    expect(out.toLowerCase()).not.toContain('threshold');
    // 430 s/mi is 7:10, the number that appeared twice on the real card.
    expect(out).not.toContain('7:10');
  });

  it('breaks the easy/shakeout tie deterministically', () => {
    // Both moved exactly 10 s/mi on the real row, so "largest delta" alone
    // does not decide it. Reversing the array must not change the answer.
    const forward = repriceSubject(DAVID_MOVES);
    const backward = repriceSubject([...DAVID_MOVES].reverse());
    expect(forward!.key).toBe(backward!.key);
    expect(forward!.key).toBe('easy_ceiling_s_per_mi');
  });

  it('picks the LARGEST mover when the deltas differ', () => {
    const moves: RepriceAnchorMove[] = [
      { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 430 },
      { key: 'easy_ceiling_s_per_mi', fromSecPerMi: 502, toSecPerMi: 498 },
      { key: 'marathon_s_per_mi', fromSecPerMi: 472, toSecPerMi: 455 },
    ];
    expect(repriceSubject(moves)!.key).toBe('marathon_s_per_mi');
    expect(repriceReason({
      arm: 'maintenance',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 430,
      moves,
    })).toBe('Your recent training puts your marathon pace at 7:35 per mile. '
      + 'This block is written at 7:52 per mile.');
  });
});

describe('REPRICESUBJECT-1 · the common path is unchanged', () => {
  it('still names threshold, in the exact words that shipped, when threshold moves', () => {
    const moves: RepriceAnchorMove[] = [
      { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 420 },
      { key: 'easy_ceiling_s_per_mi', fromSecPerMi: 502, toSecPerMi: 492 },
    ];
    expect(repriceReason({
      arm: 'race-prep',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 420,
      moves,
      evidence: { source: 'run', refId: null },
    })).toBe('Your recent training puts your threshold at 7:00 per mile. '
      + 'This block is written at 7:10 per mile.');
  });

  it('prefers threshold even when another anchor moved further', () => {
    // Threshold is the anchor a marathoner reasons in. It loses its claim on
    // the sentence only when it STANDS STILL, never merely for moving less.
    const moves: RepriceAnchorMove[] = [
      { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 428 },
      { key: 'easy_ceiling_s_per_mi', fromSecPerMi: 502, toSecPerMi: 470 },
    ];
    expect(repriceSubject(moves)!.key).toBe('threshold_s_per_mi');
  });

  it('keeps the race-result voice', () => {
    const moves: RepriceAnchorMove[] = [
      { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 420 },
    ];
    expect(repriceReason({
      arm: 'race-prep',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 420,
      moves,
      evidence: { source: 'race', refId: 'r1' },
    })).toBe('A race result puts your threshold at 7:00 per mile. '
      + 'This block is written at 7:10 per mile.');
  });

  it('falls back to the threshold pair when no move set is supplied', () => {
    expect(repriceReason({
      arm: 'race-prep',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 420,
      evidence: { source: 'run', refId: null },
    })).toBe('Your recent training puts your threshold at 7:00 per mile. '
      + 'This block is written at 7:10 per mile.');
  });

  it('keeps the canonical-prior branch, and gives it the same honesty', () => {
    const moved: RepriceAnchorMove[] = [
      { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 420 },
    ];
    expect(repriceReason({
      arm: 'canonical-prior',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 420,
      moves: moved,
    })).toBe('This block was priced before the canonical pace layer read your history. '
      + 'Your evidence puts threshold at 7:00 per mile, and the block is written at 7:10.');

    // Same arm, David's shape: threshold still, easy ceiling moving.
    const out = repriceReason({
      arm: 'canonical-prior',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 430,
      moves: DAVID_MOVES,
    });
    expect(out.toLowerCase()).not.toContain('threshold');
    expect(out).toContain('easy ceiling');
  });
});

describe('REPRICESUBJECT-1 · what counts as a move', () => {
  it('refuses when nothing moved, rather than inventing a subject', () => {
    expect(repriceSubject(DAVID_MOVES.filter((m) => m.fromSecPerMi === m.toSecPerMi))).toBeNull();
    expect(repriceSubject([])).toBeNull();
    expect(repriceSubject(null)).toBeNull();
  });

  it('does not count a change the runner cannot see', () => {
    // 430.0 and 430.4 both print "7:10". A sentence claiming a move between
    // them claims something unobservable (Rule 16, and `fmtPace`'s rounding).
    expect(repriceSubject([
      { key: 'easy_ceiling_s_per_mi', fromSecPerMi: 502.0, toSecPerMi: 502.4 },
    ])).toBeNull();
    // One whole second apart always crosses a displayed second.
    expect(repriceSubject([
      { key: 'easy_ceiling_s_per_mi', fromSecPerMi: 502.0, toSecPerMi: 503.0 },
    ])!.key).toBe('easy_ceiling_s_per_mi');
  });

  it('skips an anchor with no priced side, which has nothing to compare', () => {
    expect(repriceSubject([
      { key: 'easy_ceiling_s_per_mi', fromSecPerMi: null, toSecPerMi: 492 },
    ])).toBeNull();
  });

  it('never falls back to the threshold NUMBERS once a subject is chosen', () => {
    // The failure mode a partial fix would leave: right label, wrong pair.
    const out = repriceReason({
      arm: 'race-prep',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 430,
      moves: DAVID_MOVES,
      evidence: { source: 'run', refId: null },
    });
    expect(out).toContain('8:12'); // 492 s/mi, the new easy ceiling
    expect(out).toContain('8:22'); // 502 s/mi, what the block is written at
  });
});

describe('REPRICESUBJECT-1 · every repricing sentence routes through the picker', () => {
  /**
   * Rule 20 · the behavioural cases above cannot see a call site that stops
   * passing `moves`, or a fifth generator that grows its own hardcoded
   * subject. This reads the source. It is a ratchet on the four sites that
   * exist; a new one must be added here deliberately.
   */
  const read = (p: string) => readFileSync(path.resolve(HERE, p), 'utf8');

  it('all three repriceReason call sites pass the move set', () => {
    const src = read('reanchor-plan.ts');
    const calls = src.split('repriceReason({').slice(1);
    expect(calls).toHaveLength(3); // liveness: the scan found the call sites
    for (const c of calls) {
      const args = c.slice(0, c.indexOf('}),'));
      expect(args).toContain('moves:');
      expect(args).toContain('anchorMovesBetween(');
    }
  });

  it('the drift monitor sentence asks the same picker', () => {
    const src = read('../audit/pace-drift-autopropose.ts');
    expect(src).toContain('repriceSubject(');
    // And it no longer hardcodes the word as the sentence's subject.
    expect(src).not.toContain('put threshold at ${to}');
  });

  it('the pace-visibility comparison has exactly one definition', () => {
    // `fmtPace(a) !== fmtPace(b)` must appear once, in lib/format/run.ts.
    const fmt = read('../format/run.ts');
    expect(fmt).toContain('export function paceDisplayChanges');
    for (const f of ['reanchor-plan.ts', 'reprice-payload.ts', '../audit/pace-drift-autopropose.ts']) {
      const body = read(f).split('\n').filter((l) => !l.trim().startsWith('*')).join('\n');
      expect(body).not.toContain('fmtPace(a) !== fmtPace(b)');
    }
  });
});
