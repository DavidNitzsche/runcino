/**
 * lib/plan/_runner_instruction.test.ts · RUNNERLANG-1 (2026-09-02).
 *
 * Two gates, for the two halves of the owner's instruction:
 *
 *   1 · A RETIRED PHRASE DOES NOT COME BACK, and what replaces it is a
 *       well-formed instruction rather than wreckage.
 *   2 · A SENTENCE THAT BELONGS TO THE BLOCK IS SAID ONCE (Rule 17).
 *
 * ── ASSERT THE SHAPE, NOT THE ABSENCE ──────────────────────────────────────
 *
 * The citation scrub is the cautionary tale this file is written against. Its
 * test asserted that "Research/" was absent from the output. It passed — while
 * turning "Cruise intervals · Research/04 §5.3." into "Cruise intervals.3.".
 * An absence-only assertion cannot see wreckage.
 *
 * So every INPUT below is a verbatim authored string read out of this repo on
 * 2026-09-02, and every one is checked for the shape of the RESULT: sentence-
 * terminated, no doubled space, no stranded separator or leading punctuation,
 * no orphaned lower-case sentence opening, non-empty, and shorter than the
 * absurd. The absence check is there too, and it is the least of them.
 *
 * ── WHAT THESE GATES CANNOT FAIL ON (Rule 22) ──────────────────────────────
 *
 *   · SHORTHAND NOBODY LISTED. Both halves are fixed lists. "Just cruise it",
 *     "keep it honest", "nice and steady" all pass. The band narrows the
 *     failure mode; a reviewer is still the only thing that closes it.
 *   · A SENTENCE ASSEMBLED AT RUN TIME from clean fragments. No literal ever
 *     exists, so neither the shell gate nor this one sees it.
 *   · WHETHER THE REPLACEMENT IS GOOD COACHING. This proves a swap happened
 *     and the result is well-formed prose in the house voice. It has no
 *     opinion about whether the advice is right.
 *   · A THIRD BLOCK-SCOPED SENTENCE SOMEBODY ADDS ELSEWHERE. The repetition
 *     half checks `applyCourseGuidance`, which is the one site that had the
 *     defect. A new per-row append in another pass is invisible here.
 *   · THE COUNT ITSELF ON A REAL PLAN. This drives the real function with a
 *     synthetic fourteen-week block. It does not read production, and per the
 *     read-only constraint on this work it never will.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  INSTRUCTION_REWRITES,
  renderRunnerInstruction,
  BlockScopedSpeaker,
} from './runner-instruction';
import { scanCopy, scanLayerOne, scanPunctuation, COACH_LEXICON } from '@/lib/faff/coach-lexicon';
import { applyCourseGuidance } from './generate';
import type { CourseTerrain } from './course-profile';

const HERE = path.resolve(__dirname);

/**
 * VERBATIM AUTHORED STRINGS, as they stood at 656f3328 — before this change —
 * across `generate.ts`, `workout-library-static.ts`, `seed-from-onboarding.ts`,
 * `spec-card.ts`, `session-cue.ts`, `run-purpose.ts` and `execution-plan.ts`.
 *
 * These are what `plan_workouts.notes` holds on every plan already composed,
 * which is why the renderer runs at the READ and why the corpus is these
 * strings and not invented ones.
 */
const AUTHORED_BEFORE: readonly string[] = [
  'Conversational. Z2 HR cap.',
  'Conversational. Z2 HR cap. Bulk-volume building block.',
  'Conversational throughout.',
  'Conversational throughout. Build the engine.',
  'Conversational. Maintenance long · holding aerobic base.',
  'Conversational. Standard weekday mid-distance easy.',
  'Conversational. Common second-longest weekday run.',
  'Marathon-block staple. Conversational throughout.',
  'Recovery easy · conversational, no surges.',
  '45 min easy. Conversational effort throughout. Strides optional at end.',
  'First run. Ease in at a conversational pace · the week settles into its rhythm from here.',
  'Long run at easy conversational pace. Duration builds durability; pace is irrelevant today.',
  'Conversational pace · should feel like nothing.',
  'Conversational. Cap the effort and hold form.',
  'Conversational pace. The volume is the workout, not the pace.',
  'Conversational through the middle. Close the last 2 with intent.',
  'Easy jog 1-2 miles (12 min). Conversational, nothing more.',
  // The one that carried the terrain sentence too, exactly as it was found in
  // `_week_note_scrub.test.ts`'s prod corpus.
  'Conversational throughout. Build the engine. Course drops 304 ft. '
  + 'Run at least 60% of this on downhill-similar terrain.',
];

/** Everything the gate calls well-formed, in one place. */
function assertWellFormed(out: string, from: string): void {
  expect(out.length, `emptied: ${from}`).toBeGreaterThan(0);
  expect(out, `stranded section number in: ${out}`).not.toMatch(/[a-z]\.[0-9]/);
  expect(out, `dangling separator in: ${out}`).not.toMatch(/·\s*[.!?]|·\s*$/);
  expect(out, `doubled space in: ${out}`).not.toMatch(/\s{2,}/);
  expect(out, `leading punctuation in: ${out}`).not.toMatch(/^[.,;:·]/);
  expect(out, `unterminated: ${out}`).toMatch(/[.?]$/);
  expect(out, `sentence opens lower-case in: ${out}`).not.toMatch(/(^|[.?]\s)[a-z]/);
  expect(out, `doubled full stop in: ${out}`).not.toMatch(/\.\./);
  // Not a plausible failure mode of a swap, but a runaway replacement loop
  // would show up here and nowhere else.
  expect(out.length, `implausibly long: ${out}`).toBeLessThan(400);
}

describe('RUNNERLANG-1 · the retired phrases are replaced, not deleted', () => {
  it('LIVENESS · the table is real and every entry fires on the real corpus', () => {
    expect(INSTRUCTION_REWRITES.length, 'the rewrite table is empty · this gate is inert')
      .toBeGreaterThan(5);
    const unfired = INSTRUCTION_REWRITES.filter((r) => {
      const re = new RegExp(r.find.source, 'i');
      return !AUTHORED_BEFORE.some((s) => re.test(s));
    }).map((r) => r.id);
    expect(
      unfired,
      'A rewrite matches nothing in the authored corpus. Either the phrase is '
      + 'gone from the repo and the entry should be deleted, or the corpus above '
      + 'is stale · a rule nothing can reach is decoration (Rule 15).',
    ).toEqual([]);
  });

  it('every authored note comes out as a well-formed instruction', () => {
    for (const raw of AUTHORED_BEFORE) {
      const out = renderRunnerInstruction(raw) ?? '';
      assertWellFormed(out, raw);
    }
  });

  it('no retired phrase survives, and the surrounding sentence does', () => {
    for (const raw of AUTHORED_BEFORE) {
      const out = renderRunnerInstruction(raw) ?? '';
      expect(scanCopy(out, ['shorthand']), `shorthand survived in: ${out}`).toEqual([]);
    }
    // The point is losing the shorthand and KEEPING the coaching. Each of
    // these clauses carried real information beside the retired phrase.
    expect(renderRunnerInstruction('Conversational throughout. Build the engine.'))
      .toContain('Build the engine');
    expect(renderRunnerInstruction('Recovery easy · conversational, no surges.'))
      .toContain('no surges');
    expect(renderRunnerInstruction('45 min easy. Conversational effort throughout. Strides optional at end.'))
      .toContain('Strides optional at end');
    expect(renderRunnerInstruction('Conversational. Maintenance long · holding aerobic base.'))
      .toContain('Maintenance long');
    expect(renderRunnerInstruction(
      'Conversational throughout. Build the engine. Course drops 304 ft. '
      + 'Run at least 60% of this on downhill-similar terrain.',
    )).toContain('Course drops 304 ft');
  });

  it('the two named phrases read as instructions a runner can act on', () => {
    // The owner's own examples, quoted as he will read them.
    expect(renderRunnerInstruction('Conversational. Z2 HR cap.')).toBe(
      'Easy enough to talk in full sentences. If the heart rate drifts up, '
      + 'slow down even when the pace still looks right.',
    );
    expect(renderRunnerInstruction('Conversational throughout.')).toBe(
      'Easy the whole way, talking in full sentences.',
    );
    // Mid-sentence position keeps its lower case · a fixed-case replacement
    // would have produced "Recovery easy · Talk in full sentences".
    expect(renderRunnerInstruction('Recovery easy · conversational, no surges.')).toBe(
      'Recovery easy · talk in full sentences, and no surges.',
    );
    // A prepositional form keeps its article · "at a easy enough" is the
    // failure this entry exists to avoid.
    expect(renderRunnerInstruction(
      'First run. Ease in at a conversational pace · the week settles into its rhythm from here.',
    )).toBe(
      'First run. Ease in at a pace you can talk through · the week settles into its rhythm from here.',
    );
  });

  it('is idempotent, and byte-identical on copy that never had the phrase', () => {
    const clean = 'Even splits from the first rep. Do not go out fast expecting to fade.';
    expect(renderRunnerInstruction(clean)).toBe(clean);
    expect(renderRunnerInstruction(renderRunnerInstruction(clean))).toBe(clean);
    for (const raw of AUTHORED_BEFORE) {
      const once = renderRunnerInstruction(raw);
      expect(renderRunnerInstruction(once), `not idempotent: ${raw}`).toBe(once);
    }
  });

  it('a global regex does not skip every other call', () => {
    // The table carries /g. A shared `lastIndex` across calls makes a global
    // regex match on odd invocations and miss on even ones, which in
    // production looks exactly like "it works locally and misses half the
    // rows". Ten identical calls, ten identical answers.
    const raw = 'Conversational. Z2 HR cap.';
    const answers = new Set(Array.from({ length: 10 }, () => renderRunnerInstruction(raw)));
    expect(answers.size, 'the rewrite is stateful across calls').toBe(1);
  });

  it('absent, blank and unrecognised are three different answers (Rule 11)', () => {
    expect(renderRunnerInstruction(null)).toBeNull();
    expect(renderRunnerInstruction(undefined)).toBeNull();
    expect(renderRunnerInstruction('   ')).toBe('');
    // Unrecognised input comes back unchanged. A substitution that can empty
    // its input is the citation-scrub bug again.
    expect(renderRunnerInstruction('Hold the line. Comfortably hard, not racing.'))
      .toBe('Hold the line. Comfortably hard, not racing.');
  });

  it('every replacement string is clean by the lexicon it is exempted from', () => {
    // `runner-instruction.ts` is excluded from `check-coach-voice.sh` because
    // its regexes spell out the banned phrases. This is the payment for that
    // exclusion: the only prose in the file a runner can reach is the `to`
    // column, and it is checked here with the module's own scanners.
    for (const r of INSTRUCTION_REWRITES) {
      expect(scanLayerOne(r.to), `${r.id}: ${r.to}`).toEqual([]);
      expect(scanPunctuation(r.to), `${r.id}: ${r.to}`).toEqual([]);
      expect(r.why.trim().length, `${r.id} has no argued reason`).toBeGreaterThan(25);
    }
  });

  it('the shorthand band exists in the one lexicon and covers both named phrases', () => {
    const terms = COACH_LEXICON.filter((e) => e.band === 'shorthand').map((e) => e.term);
    expect(terms, 'the shorthand band is empty · the shell guard is off').not.toEqual([]);
    expect(terms).toContain('conversational');
    expect(terms).toContain('z2 hr cap');
    // And it fires, which is the half a term list cannot prove about itself.
    expect(scanCopy('Conversational. Z2 HR cap.', ['shorthand']).map((f) => f.term))
      .toEqual(expect.arrayContaining(['conversational', 'z2 hr cap']));
  });

  it('WIRING · the read path still routes plan notes through the renderer', () => {
    // Guards the plumbing, not the helper. An edit that reverted
    // `dayNoteFor` to the scrub alone would leave every test above passing
    // while shipping the retired phrases to the phone again. Same posture as
    // `_week_note_scrub.test.ts`'s own wiring assertion.
    const src = readFileSync(path.join(HERE, 'week-loader.ts'), 'utf8');
    expect(src).toMatch(/renderRunnerInstruction\(stripResearchCitations\(raw\)\)/);
    expect(src).not.toMatch(/const scrubbed = stripResearchCitations\(raw\)\.trim\(\);/);
  });
});

// ───────────────────────────────────────────────────────────────────────────

/** A composed block, reduced to the two fields `applyCourseGuidance` reads. */
function block(weeks: number, raceISO: string, startISO: string) {
  const addDays = (iso: string, n: number) => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // The race day is a ROW in the last week, not a field on the block:
  // `raceDayISO` walks backwards for a race-week carrying a `type: race` day.
  // A fixture without one makes the whole pass return early, which is how the
  // first run of this gate reported zero terrain sentences and looked like a
  // pass for the wrong reason.
  const raceDow = new Date(raceISO + 'T12:00:00Z').getUTCDay();
  return {
    weeks: Array.from({ length: weeks }, (_, i) => {
      const last = i === weeks - 1;
      return {
        startISO: addDays(startISO, i * 7),
        isRaceWeek: last,
        phase: 'BUILD',
        days: last
          ? [{ dow: raceDow, type: 'race', distanceMi: 26.2, isLong: false, isQuality: true, notes: '' }]
          : [{ dow: 0, type: 'long', distanceMi: 16, isLong: true, isQuality: false, notes: 'Easy the whole way, talking in full sentences.' }],
      };
    }),
  } as never;
}

const CIM: CourseTerrain = {
  shape: 'net_downhill',
  netFt: -304,
  gainFt: 1031,
  lossFt: 1335,
  vertPer10Mi: 393,
  provenance: 'geometry',
  confidence: 'high',
  trusted: true,
} as unknown as CourseTerrain;

describe('RULE 17 · a block sentence is said once, not once per row', () => {
  it('BlockScopedSpeaker says an id once and two ids independently', () => {
    const s = new BlockScopedSpeaker();
    expect(s.say('a', ' A.')).toBe(' A.');
    expect(s.say('a', ' A.')).toBe('');
    expect(s.say('a', ' A.')).toBe('');
    // A different instruction is a different fact and is not swallowed.
    expect(s.say('b', ' B.')).toBe(' B.');
    expect(s.say('b', ' B.')).toBe('');
    expect(s.spoken().slice().sort()).toEqual(['a', 'b']);
  });

  it('the terrain instruction lands on ONE long run in a fourteen-week block', () => {
    // The measured defect: the owner's CIM block carried this sentence on
    // every non-race-week long run. The count is what changed; the decision,
    // the elevation and the doctrine dose did not.
    const composed = block(14, '2026-12-06', '2026-09-07');
    applyCourseGuidance(composed, CIM, 26.2);

    const notes = (composed as unknown as { weeks: { days: { notes: string }[] }[] })
      .weeks.flatMap((w) => w.days).map((d) => d.notes);

    // BEFORE this change the block carried the terrain sentence on all twelve
    // non-race-week long runs. After, it carries TWO sentences in total, each
    // exactly once, because they are two different facts: find the terrain
    // through the build, and stop running it hard once the taper starts.
    const findTerrain = notes.filter((n) => /Run at least 60% of your long-run miles/.test(n));
    const lateTaper = notes.filter((n) => /stays short and easy/.test(n));
    expect(findTerrain.length, 'the terrain instruction repeats · Rule 17').toBe(1);
    expect(lateTaper.length, 'the late-taper instruction repeats · Rule 17').toBe(1);
    expect(
      notes.filter((n) => /Course drops/.test(n)).length,
      'a block says at most one terrain sentence per distinct instruction',
    ).toBe(2);

    // And it is still SAID · a dedupe that says it zero times has replaced one
    // defect with a worse one. The measured elevation survives verbatim.
    expect(findTerrain[0]).toContain('Course drops 304 ft');
  });

  it('the late-taper instruction is its own fact and is also said once', () => {
    // A block short enough that every long run sits inside the fourteen-day
    // late-taper window, so only that id is ever spoken.
    const composed = block(3, '2026-09-20', '2026-09-07');
    applyCourseGuidance(composed, CIM, 26.2);
    const notes = (composed as unknown as { weeks: { days: { notes: string }[] }[] })
      .weeks.flatMap((w) => w.days).map((d) => d.notes);
    const taper = notes.filter((n) => /stays short and easy/.test(n));
    expect(taper.length, 'the late-taper line repeats').toBe(1);
  });

  it('an untrusted or flat course still says nothing at all', () => {
    // The gate that already existed, re-asserted so the dedupe cannot be
    // mistaken for it: elevation that is not trusted may be SHOWN but may not
    // move a prescription, and a flat course has no terrain instruction.
    for (const t of [
      { ...CIM, trusted: false } as CourseTerrain,
      { ...CIM, shape: 'flat' } as CourseTerrain,
    ]) {
      const composed = block(14, '2026-12-06', '2026-09-07');
      applyCourseGuidance(composed, t, 26.2);
      const notes = (composed as unknown as { weeks: { days: { notes: string }[] }[] })
        .weeks.flatMap((w) => w.days).map((d) => d.notes);
      expect(notes.filter((n) => /Course drops/.test(n)).length).toBe(0);
    }
  });

  it('WIRING · the course pass asks the speaker rather than appending per row', () => {
    const src = readFileSync(path.join(HERE, 'generate.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function applyCourseGuidance('));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('new BlockScopedSpeaker()');
    expect(body).toMatch(/speaker\.say\('course\.find-the-terrain'/);
    expect(body).toMatch(/speaker\.say\('course\.late-taper'/);
  });
});
