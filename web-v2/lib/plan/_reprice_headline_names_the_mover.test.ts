/**
 * lib/plan/_reprice_headline_names_the_mover.test.ts · REPRICEHEADLINE-1.
 *
 * ── THE DEFECT, AS THE RUNNER MET IT ───────────────────────────────────────
 *
 * `plan_workout_proposals` id 12, the only reprice row in production, raised
 * into the owner's account at 2026-09-08T07:00:28Z and still `pending`. Its
 * stored headline, read back from the row verbatim:
 *
 *     "76 sessions ahead move to faster paces"
 *
 * David, reading it on his phone: "This is nice and I agree this shouldn't be
 * buried and on today is a good spot. But it's confusing. Are paces already
 * at 7:10?" And on being offered the count as the explanation: "I don't care
 * about '76 sessions' I just care about what you told me tbh."
 *
 * The anchor moves on that row, copied below EXACTLY as the payload carries
 * them, say his threshold went 430 -> 430 and so did interval (401),
 * repetition (365) and marathon (472). The whole move was the easy ceiling
 * (502 -> 492) and the shakeout ceiling (532 -> 522). So:
 *
 *   · the headline led with SCOPE, which is the one question he said he did
 *     not care about, while `ProposalCardV5`'s own contract is "headline is
 *     what changes";
 *   · it printed a count `affectedFrom` already draws in full on the same
 *     card as "76 prescribed sessions, from this day to the end of the
 *     block" (Rule 17);
 *   · and "faster paces" came from a mean over all six anchors INCLUDING the
 *     four that did not move, so the pace he actually reasons in was exactly
 *     where it had been. Hence the question.
 *
 * ── WHAT THIS FILE ASSERTS ─────────────────────────────────────────────────
 *
 *   1 · On his exact numbers the headline names an anchor that ACTUALLY
 *       moved, and states the pace it moves to.
 *   2 · It no longer prints the session count, which the card draws elsewhere.
 *   3 · Headline and body name the SAME anchor. This is the whole point: one
 *       repricing, one subject, one number (Rule 16).
 *   4 · The writer (`actionFromReprice`) and the legacy reader
 *       (`actionFromPending`) produce the IDENTICAL string, because a second
 *       copy of the wording is how they drift apart unseen.
 *   5 · A payload with no move set still gets an honest sentence, and it is
 *       the scope wording that shipped — absent moves and no visible mover
 *       are not the same fact as a nameable one (Rule 11).
 *   6 · A source ratchet: no OTHER module composes the sentence itself.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 *   · WHETHER THE REPRICING IS CORRECT. Whether 492 is the right easy ceiling
 *     is `_recompute_paces.test.ts`'s question. This file only asks whether
 *     the card describes the payload it is attached to.
 *   · THE DIRECTION CHIP. It still comes from `meanAnchorDeltaSecPerMi` and
 *     can still disagree in SIGN with the anchor the headline names. That is
 *     documented and deliberate (`repriceHeadline`'s header says why sourcing
 *     it from the subject would be a Rule 9 cliff), and nothing here would go
 *     red if it changed.
 *   · THE PHONE. `describe` is a string; whether `ProposalCardV5` draws it is
 *     Rule 13's question and was answered by rendering, not here.
 *   · ALREADY-STORED ROWS. Row 12 keeps its old headline, because `toWire`
 *     reads the persisted string. This governs the next repricing.
 */
import { describe as suite, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { actionFromReprice } from '@/lib/brain/proposal/generate/from-reprice';
import { repriceHeadline, repriceSubject, type RepriceAnchorMove, type RepricePayload } from './reprice-payload';
import { repriceReason } from './reanchor-plan';

/** Proposal 12's `anchorMoves`, verbatim from the production row. */
const ROW12: RepriceAnchorMove[] = [
  { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 430 },
  { key: 'interval_s_per_mi', fromSecPerMi: 401, toSecPerMi: 401 },
  { key: 'repetition_s_per_mi', fromSecPerMi: 365, toSecPerMi: 365 },
  { key: 'easy_ceiling_s_per_mi', fromSecPerMi: 502, toSecPerMi: 492 },
  { key: 'shakeout_ceiling_s_per_mi', fromSecPerMi: 532, toSecPerMi: 522 },
  { key: 'marathon_s_per_mi', fromSecPerMi: 472, toSecPerMi: 472 },
];

/** Row 12's own mean, to four places, as the payload stored it. */
const ROW12_MEAN = -3.3333333333333335;

function payloadOf(moves: RepriceAnchorMove[], mean: number, n: number): RepricePayload {
  return {
    kind: 'reprice',
    planId: 'pln_7636bcc0a201bf2d',
    arm: 'race-prep',
    fromVdot: 50,
    toVdot: 50,
    toSource: 'measured_vdot',
    measured: true,
    anchorMoves: moves,
    meanAnchorDeltaSecPerMi: mean,
    workoutsAffected: n,
    workoutsSealed: 0,
    computedAt: '2026-09-08T07:00:28.478Z',
  };
}

function headlineOfAction(p: RepricePayload): string {
  const a = actionFromReprice(p);
  if (a.kind !== 'COORDINATED') throw new Error(`expected COORDINATED, got ${a.kind}`);
  return a.describe;
}

suite('REPRICEHEADLINE-1 · the headline names what moved', () => {
  it('row 12: names the easy ceiling and the pace it moves to', () => {
    const out = headlineOfAction(payloadOf(ROW12, ROW12_MEAN, 76));
    // The two anchors that moved did so by exactly 10 s/mi each, so the tie is
    // broken by canonical order and easy ceiling wins. 492 s/mi is 8:12.
    expect(out).toBe('Easy ceiling moves to 8:12 across the block');
  });

  it('row 12: the sentence David objected to is gone', () => {
    const out = headlineOfAction(payloadOf(ROW12, ROW12_MEAN, 76));
    expect(out).not.toBe('76 sessions ahead move to faster paces');
    // "I don't care about '76 sessions'". The count is drawn by
    // `affectedFrom` as its own row, with the scope spelled out.
    expect(out).not.toContain('76');
    expect(out).not.toContain('sessions ahead');
  });

  it('row 12: it does not claim a direction the body cannot corroborate', () => {
    const out = headlineOfAction(payloadOf(ROW12, ROW12_MEAN, 76));
    // The mean was -3.33 across six anchors, four of which held still. The
    // headline states the anchor and its number instead of generalising.
    expect(out).not.toContain('faster paces');
    expect(out).not.toContain('easier paces');
  });

  it('headline and body name the SAME anchor, and the same number (Rule 16)', () => {
    const head = headlineOfAction(payloadOf(ROW12, ROW12_MEAN, 76));
    const body = repriceReason({
      arm: 'race-prep',
      fromThresholdSecPerMi: 430,
      toThresholdSecPerMi: 430,
      moves: ROW12,
      evidence: null,
    });
    const subject = repriceSubject(ROW12);
    expect(subject?.key).toBe('easy_ceiling_s_per_mi');
    // Both sentences carry the label and both carry 8:12. This is the pair
    // that read as two disconnected facts on his phone.
    expect(head.toLowerCase()).toContain('easy ceiling');
    expect(body.toLowerCase()).toContain('easy ceiling');
    expect(head).toContain('8:12');
    expect(body).toContain('8:12');
    // And the body still names the OTHER side, which the headline does not.
    expect(body).toContain('8:22');
  });

  it('threshold moving keeps first refusal, and reads naturally', () => {
    const moves: RepriceAnchorMove[] = [
      { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 420 },
      { key: 'easy_ceiling_s_per_mi', fromSecPerMi: 502, toSecPerMi: 492 },
    ];
    expect(repriceHeadline({ moves, meanAnchorDeltaSecPerMi: -10, workoutsAffected: 76 }))
      .toBe('Threshold moves to 7:00 across the block');
  });

  it('a label that already ends in the word "pace" is not doubled', () => {
    const moves: RepriceAnchorMove[] = [
      { key: 'marathon_s_per_mi', fromSecPerMi: 472, toSecPerMi: 462 },
    ];
    // "Marathon pace pace moves to" is how a template betrays itself.
    expect(repriceHeadline({ moves, meanAnchorDeltaSecPerMi: -10, workoutsAffected: 40 }))
      .toBe('Marathon pace moves to 7:42 across the block');
  });

  it('the writer and the legacy reader produce the identical string', async () => {
    // `actionFromPending` reaches a pool import, so the legacy branch is
    // exercised through the shared composer both call rather than through the
    // DB reader. What must not drift is the WORDING, and that is this string.
    const { repriceHeadline: composer } = await import('./reprice-payload');
    const viaWriter = headlineOfAction(payloadOf(ROW12, ROW12_MEAN, 76));
    const viaReader = composer({
      moves: ROW12,
      meanAnchorDeltaSecPerMi: ROW12_MEAN,
      workoutsAffected: 76,
    });
    expect(viaReader).toBe(viaWriter);
  });

  it('no move set falls back to the scope sentence that shipped (Rule 11)', () => {
    expect(repriceHeadline({ moves: null, meanAnchorDeltaSecPerMi: -4, workoutsAffected: 76 }))
      .toBe('76 sessions ahead move to faster paces');
    expect(repriceHeadline({ moves: null, meanAnchorDeltaSecPerMi: 4, workoutsAffected: 76 }))
      .toBe('76 sessions ahead move to easier paces');
    expect(repriceHeadline({ moves: null, meanAnchorDeltaSecPerMi: 0, workoutsAffected: 76 }))
      .toBe('76 sessions ahead get updated paces');
    // Verb agreement, which only shows up when you read the rendered string.
    expect(repriceHeadline({ moves: null, meanAnchorDeltaSecPerMi: 0, workoutsAffected: 1 }))
      .toBe('1 session ahead gets updated paces');
  });

  it('an anchor that moved by less than a rounded second is not nameable', () => {
    // 430.0 and 430.4 are both "7:10". A headline claiming a move between
    // them claims something the runner cannot see, so the subject refuses and
    // the scope sentence is what is left that is true.
    const moves: RepriceAnchorMove[] = [
      { key: 'threshold_s_per_mi', fromSecPerMi: 430.0, toSecPerMi: 430.4 },
    ];
    expect(repriceHeadline({ moves, meanAnchorDeltaSecPerMi: 0.4, workoutsAffected: 76 }))
      .toBe('76 sessions ahead get updated paces');
  });

  it('RULE 9 · crossing the writer\'s own floor changes degree, not kind', () => {
    // `writeReanchorProposal` refuses when every anchor moves < 1 s/mi, so a
    // card that exists always has a mover of >= 1 s/mi, and a move of >= 1
    // ALWAYS crosses a rounded second. Walk the easy ceiling down through
    // that floor: every card that can actually be raised names an anchor, and
    // the pace it names moves one second at a time.
    const seen: string[] = [];
    for (let delta = 1; delta <= 12; delta += 1) {
      const moves: RepriceAnchorMove[] = [
        { key: 'easy_ceiling_s_per_mi', fromSecPerMi: 502, toSecPerMi: 502 - delta },
      ];
      seen.push(repriceHeadline({ moves, meanAnchorDeltaSecPerMi: -delta, workoutsAffected: 76 }));
    }
    // No step falls back to the scope wording, and none is a different KIND
    // of sentence from its neighbour.
    for (const s of seen) {
      expect(s).toMatch(/^Easy ceiling moves to \d+:\d\d across the block$/);
    }
    // 501 s/mi is 8:21 and 490 is 8:10 — monotone, one second per step.
    expect(seen[0]).toBe('Easy ceiling moves to 8:21 across the block');
    expect(seen[seen.length - 1]).toBe('Easy ceiling moves to 8:10 across the block');
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('RATCHET · only reprice-payload.ts composes this sentence', () => {
    // A future surface that grows its own copy is exactly how the writer and
    // the legacy reader drifted apart in the first place. Rule 18: this
    // assertion states how many files it read and fails on zero.
    const roots = ['lib/brain/proposal', 'lib/plan', 'lib/faff'];
    const base = join(__dirname, '..', '..');
    const offenders: string[] = [];
    let filesRead = 0;
    const walk = (dir: string): void => {
      for (const e of readdirSafe(dir)) {
        const full = join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!e.name.endsWith('.ts') || e.name.includes('.test.')) continue;
        filesRead += 1;
        if (full.endsWith(join('lib', 'plan', 'reprice-payload.ts'))) continue;
        const src = readFileSync(full, 'utf8');
        /* A doc comment QUOTING the sentence David read is documentation and
         * several files legitimately carry it; a CODE line building it is a
         * second author. Only the second is the drift this ratchet exists to
         * stop, so comment lines are excluded by their leading marker. */
        const composing = src.split('\n').filter((ln) => {
          if (!ln.includes('sessions ahead')) return false;
          const t = ln.trimStart();
          return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
        });
        if (composing.length === 0) continue;
        offenders.push(full.slice(base.length + 1));
      }
    };
    for (const r of roots) walk(join(base, r));
    expect(filesRead).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});

function readdirSafe(dir: string): Array<{ name: string; isDirectory(): boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
