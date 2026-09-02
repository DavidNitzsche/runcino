/**
 * VERDICT-1 · one completed workout has ONE verdict, and every consumer reads it.
 *
 * THE BUG CLASS. `execution-semantics.ts` owned the grading RULES from
 * 2026-09-01, and the same run still came back with different verdicts on
 * different screens, because each consumer assembled its own input: run detail
 * graded with no session class (±30 on legacy rows), the win line read the
 * device's stored word (`drifted / missed`), the glance done-state ran its own
 * comparator at ±10, and the recap called ±5 "on the mark". Every one a legal
 * verdict; together, Rule 16 broken on one workout across four surfaces.
 *
 * Three parts:
 *
 *   1 · A SCANNER (same shape as EXECSEM-1 and ACTIVEPLAN-1). Every consumer
 *       that grades a completed workout imports the resolver, carries no local
 *       pace comparator, and never compares the device's stored word to
 *       decide anything. Ratcheted exemptions, argued, stale ones fail.
 *   2 · THE TWELVE-WORKOUT MATRIX. One fixture per workout type the brief
 *       names, pushed through the resolver AND through every consumer, with
 *       the consumers' outputs asserted against the resolver's — the factual
 *       agreement the brief demands (wording may differ; the verdict may not).
 *   3 · THE MANDATORY FIXTURE. The owner's real 2026-09-01 4×1 mi session,
 *       phase for phase off the production row, with the expected outcome the
 *       brief states: hit / hit / hit / fast, jogs ungraded, warm-up and
 *       cool-down under the ceiling — on every consumer.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · A consumer that calls the resolver and then IGNORES its answer. The
 *     scanner checks the import and the absence of a local comparator; the
 *     matrix checks the consumers it drives. A new consumer that is not in
 *     `CONSUMERS` is invisible to both until it is added.
 *   · A fallback written around a named constant (`const T = 10` two files
 *     away). The literal scan catches digits in comparator positions only.
 *   · Whether the WIDTHS are right — EXECSEM-2 owns that.
 *   · The Swift side. `_watch_grader_parity.test.ts` covers the wrist.
 *   · A production row whose stored phases differ in shape from these
 *     fixtures. `_zz_replay_20260901.test.ts` runs the real row.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  fellShortShare,
  gradeStoredPhases,
  resolveWorkoutVerdict,
  testPointVerdictFor,
  type WorkoutVerdict,
} from './verdict';
import { mapWatchPhases } from '@/lib/coach/run-state';
import { deriveWin } from '@/lib/coach/run-win';
import { composeTrainingInfluence } from '@/lib/coach/training-influence';
import { judgeTestPointExecution } from '@/lib/training/goal-projection';
import { actualStimulus, type PlannedRead, type PlannedSession } from './reconstruct';
import { asRunData } from '@/lib/runs/run-shape';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';
import type { WorkoutType } from '@/lib/coach/run-purpose';

const ROOT = path.resolve(__dirname, '..', '..');
const OWNER = 'lib/execution/verdict.ts';

/* ═══════════════════════════ 1 · the scanner ═══════════════════════════ */

/**
 * Every file that grades a completed workout, and the comment names what it
 * graded with before 2026-09-01 so a reviewer can see what is being held back.
 */
const CONSUMERS: readonly string[] = [
  'lib/coach/run-state.ts',              // own three-rung ladder, no class → ±30
  'lib/coach/run-win.ts',                // device's stored word; heatAdjustedStatus at 10
  'lib/coach/glance-state.ts',           // heatAdjustedStatus at 10 over the work phases
  'lib/training/goal-projection.ts',     // heatAdjustedStatus over the work MEAN
  'lib/coach/training-influence.ts',     // pace delta vs 2× tolerance
  'lib/execution/reconstruct.ts',        // device's stored word as `workVerdicts`
  'lib/coach/run-recap.ts',              // ±5 "on the mark" on the work mean
  'app/api/v5/today/route.ts',           // phases handed to the win line with the stored word
  'app/api/runs/[id]/recap/route.ts',    // same
];

/** A consumer must import the resolver, or grade its mean through the rules
 *  owner. `run-recap.ts` and `run-win.ts` grade a MEAN as a work phase, which
 *  is the owner's `gradeWorkPhase` — that is a resolver-consistent read, not a
 *  second verdict, so either import satisfies the check. */
const RESOLVER_IMPORT = /from '(@\/lib\/execution\/verdict|\.\/verdict)'/;
const RULES_IMPORT = /from '(@\/lib\/training\/execution-semantics|\.\/execution-semantics)'/;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * What a second verdict actually looks like in this codebase.
 *
 * NOT "any comparison against a verdict word" — a consumer reading the
 * resolver's own `hit` / `fast` / `slow` is exactly what this gate wants. The
 * signals that a consumer has grown its own answer are narrower and sharper:
 *
 *   · `heatAdjustedStatus(` — the local pace comparator, at whatever width the
 *     call site chose. Four consumers carried one.
 *   · the LEGACY vocabulary, `drifted` and `missed`. No build emits either
 *     word; they exist only on rows already in the database, so a consumer
 *     comparing against one is deciding on the DEVICE'S stored grade.
 *   · `wireVerdictLandedTheWork` / `wireVerdictFellShort` — the two helpers
 *     that read a stored word. Legitimate only on a legacy path with no grade.
 */
const FORBIDDEN: readonly { re: RegExp; what: string }[] = [
  { re: /\bheatAdjustedStatus\s*\(/g, what: 'a local pace comparator (heatAdjustedStatus)' },
  { re: /===?\s*['"](drifted|missed)['"]/g, what: "a decision on the device's legacy stored word" },
  { re: /\bwireVerdict(LandedTheWork|FellShort)\s*\(/g, what: 'a decision on the stored word' },
];

interface Finding { file: string; snippet: string }

/** The ratchet. Shrinks, never grows; a stale entry fails until deleted. */
const EXEMPT: readonly { file: string; snippet: string; reason: string }[] = [
  {
    file: 'lib/training/goal-projection.ts',
    snippet: 'heatAdjustedStatus(targetS!, actualS, heatSlowdownPct, tolerance)',
    reason:
      'The FALLBACK rungs of `judgeTestPointExecution`. A run with no phases '
      + '(Strava, HealthKit, cold start) has no per-rep grade, and the only '
      + 'honest read left is the work-window or blended MEAN. Rung 1 reads the '
      + "resolver; this runs at the owner's width and only when there is no "
      + 'grade, or when the set was mixed and `testPointVerdictFor` asked for '
      + 'the mean itself.',
  },
  {
    file: 'lib/training/goal-projection.ts',
    snippet: 'heatAdjustedStatus(targetS!, overallS, heatSlowdownPct, tolerance)',
    reason: 'Same fallback ladder · the whole-run rung, for a long or race day with no phases.',
  },
  {
    file: 'lib/training/goal-projection.ts',
    snippet: 'heatAdjustedStatus(',
    reason: 'Same fallback ladder · the blended-overall rung (a multi-line call).',
  },
  {
    file: 'lib/coach/run-win.ts',
    snippet: 'wireVerdictFellShort(p.verdict)',
    reason:
      '`winIntervalsFromPhases` is the LEGACY path, for a caller holding only '
      + "the device's payload and no plan row to classify it with. Every live "
      + 'caller now passes `grade` and reaches `winIntervalsFromGrade` first '
      + '(pinned by the "legacy stored-word path is no longer reached" test '
      + 'below). Kept so an older caller degrades to the stored word rather '
      + 'than to silence.',
  },
  {
    file: 'lib/coach/run-win.ts',
    snippet: 'wireVerdictLandedTheWork(p.verdict)',
    reason: 'Same legacy path, the "landed the work" half.',
  },
  {
    file: 'lib/coach/run-win.ts',
    snippet: 'wireVerdictLandedTheWork(s.verdict)',
    reason:
      "`winVerdictHit`'s SPLITS fallback — the tier-1 rung reads the grade "
      + 'first (`input.grade`, asserted below on the real session: four of four '
      + 'where the stored words said three) and only falls to a splits array '
      + 'carrying per-phase words when no grade was resolved. Same argument as '
      + '`winIntervalsFromPhases`: degrade to the device, never to silence.',
  },
  {
    file: 'lib/coach/run-win.ts',
    snippet: 'wireVerdictFellShort(s.verdict)',
    reason: "Same splits fallback in `winVerdictHit`, the \"fell short\" half.",
  },
];

function isExempt(f: Finding): boolean {
  return EXEMPT.some((e) => e.file === f.file && f.snippet.startsWith(e.snippet));
}

function scanFile(rel: string): Finding[] {
  const src = stripComments(read(rel));
  const out: Finding[] = [];
  for (const { re } of FORBIDDEN) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) != null) {
      const tail = src.slice(m.index, m.index + 90).replace(/\s+/g, ' ');
      out.push({ file: rel, snippet: tail });
    }
  }
  return out;
}

describe('VERDICT-1 · one resolver', () => {
  it('every consumer imports the resolver or the rules owner', () => {
    expect(CONSUMERS.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const rel of CONSUMERS) {
      const src = read(rel);
      expect(src.length, `${rel} is suspiciously small`).toBeGreaterThan(500);
      if (!RESOLVER_IMPORT.test(src) && !RULES_IMPORT.test(src)) missing.push(rel);
    }
    expect(missing, `these grade a workout but do not call the owner:\n${missing.join('\n')}`)
      .toEqual([]);
  });

  it('the surfaces that assemble a verdict call the resolver itself', () => {
    // The mean-graders (recap, win) may satisfy the rule through
    // `gradeWorkPhase`; the surfaces that hand a verdict to a runner must call
    // `resolveWorkoutVerdict` / `gradeStoredPhases` directly.
    const mustResolve = [
      'lib/coach/run-state.ts', 'lib/coach/glance-state.ts', 'lib/training/goal-projection.ts',
      'lib/execution/reconstruct.ts', 'app/api/v5/today/route.ts', 'app/api/runs/[id]/recap/route.ts',
    ];
    const missing = mustResolve.filter((rel) => !RESOLVER_IMPORT.test(read(rel)));
    expect(missing, 'these must call the resolver directly').toEqual([]);
  });

  it('no consumer carries a local comparator or decides on the stored word', () => {
    const findings = CONSUMERS.flatMap(scanFile).filter((f) => !isExempt(f));
    expect(
      findings,
      `a second verdict outside ${OWNER}:\n` + findings.map((f) => `  ${f.file} · ${f.snippet}`).join('\n'),
    ).toEqual([]);
  });

  it('no exemption is stale', () => {
    const all = CONSUMERS.flatMap(scanFile);
    const dead = EXEMPT.filter(
      (e) => !all.some((f) => f.file === e.file && f.snippet.startsWith(e.snippet)),
    );
    expect(dead.map((d) => `${d.file} · ${d.snippet}`), 'delete these — they match nothing').toEqual([]);
  });

  it('run detail tells the mapper which session it is grading', () => {
    /* THE BLIND SPOT THIS CLOSES, found by falsifying the gate (Rule 18).
     *
     * Every other test here drives `mapWatchPhases` with a class in hand, so
     * deleting the class at the ONE call site that has to supply it —
     * `loadRunDetail` → `loadPhaseBreakdown` → `mapWatchPhases` — left the
     * whole suite green. That is exactly the defect: with no class, a legacy
     * row's work phase falls to the unnamed-session width (30 s/mi) and the
     * owner's 419-against-430 rep reads "On target" on run detail alone.
     *
     * A behavioural test cannot see it (both answers are legal verdicts on
     * their own inputs), so this reads the wiring. */
    const src = stripComments(read('lib/coach/run-state.ts'));
    expect(src).toMatch(/loadPhaseBreakdown\(\s*userId,\s*day,\s*heatSlowdownPct,\s*\n?\s*classifySession\(/);
    // And the mapper must still ACCEPT one — a signature change that silently
    // dropped the parameter would leave the call site above compiling.
    expect(src).toMatch(/export function mapWatchPhases\([\s\S]{0,240}sessionClass\?: SessionClass/);
  });

  it('the resolver is pure (no database import at any depth of its own file)', () => {
    const src = read(OWNER);
    expect(src).not.toMatch(/@\/lib\/db\//);
    expect(src).not.toMatch(/from 'pg'/);
  });
});

/* ══════════════════════ 2 · the twelve-workout matrix ════════════════════ */

/** A watch completion phase as the device writes it. */
interface P {
  index?: number; type: string; label?: string;
  targetPaceSPerMi?: number | null; tolerancePaceSPerMi?: number | null; paceShape?: string;
  actualPaceSPerMi?: number | null; actualDurationSec?: number | null; actualDistanceMi?: number | null;
  targetDurationSec?: number | null;
  avgHr?: number | null; completed?: boolean; verdict?: string | null; isFinishSegment?: boolean;
}

const wu = (mi: number, ceil: number, pace: number, hr = 140): P =>
  ({ type: 'warmup', label: 'Warm-up', targetPaceSPerMi: ceil, actualPaceSPerMi: pace,
     actualDurationSec: Math.round(mi * pace), actualDistanceMi: mi, avgHr: hr, completed: true });
const cd = (mi: number, ceil: number, pace: number, hr = 150): P =>
  ({ type: 'cooldown', label: 'Cool-down', targetPaceSPerMi: ceil, actualPaceSPerMi: pace,
     actualDurationSec: Math.round(mi * pace), actualDistanceMi: mi, avgHr: hr, completed: true });
const rep = (mi: number, target: number, pace: number, hr: number, extra: Partial<P> = {}): P =>
  ({ type: 'work', label: `Interval · ${mi} mi`, targetPaceSPerMi: target, actualPaceSPerMi: pace,
     actualDurationSec: Math.round(mi * pace), actualDistanceMi: mi, avgHr: hr, completed: true, ...extra });
const jog = (sec: number, pace: number, hr = 157, targetSec = 60): P =>
  ({ type: 'recovery', label: `Jog ${targetSec} s`, targetDurationSec: targetSec, actualDurationSec: sec,
     actualPaceSPerMi: pace, actualDistanceMi: Math.round((sec / pace) * 100) / 100, avgHr: hr, completed: true });

/**
 * THE MANDATORY FIXTURE. `runs` id -258355938987883, 2026-09-01, the owner's
 * `4×1 mi @ T pace · 1 min jog`. Every number was read off the production row
 * (target 430, LTHR 168; see `_zz_replay_20260901.test.ts` for the live replay).
 * The row carries the device's LEGACY words and no `tolerancePaceSPerMi` /
 * `paceShape` — it predates both — so this exercises the legacy path every
 * already-deployed watch sends.
 */
const REAL_4X1: P[] = [
  { ...wu(2.10, 502, 516, 140), actualDurationSec: 1084, verdict: 'hit' },
  { ...rep(1, 430, 422, 158), actualDurationSec: 422, verdict: 'drifted' },
  jog(61, 515, 158),
  { ...rep(1, 430, 429, 161), actualDurationSec: 429, verdict: 'drifted' },
  jog(64, 785, 156),
  { ...rep(1, 430, 422, 164), actualDurationSec: 422, verdict: 'drifted' },
  jog(64, 1034, 157),
  { ...rep(1, 430, 419, 166), actualDurationSec: 419, verdict: 'missed' },
  { ...cd(2.11, 502, 534, 153), actualDurationSec: 1127, verdict: 'missed' },
];

interface Fixture {
  name: string;
  planType: string;
  winType: WorkoutType;
  spec: Record<string, unknown> | null;
  phases: P[];
  plannedPaceSPerMi: number | null;
  plannedMi: number;
  /** EXPECTED, per consumer. */
  expect: {
    work: string[];                       // per-rep verdicts, in order
    session: WorkoutVerdict['session']['verdict'];
    detailStatuses: (string | null)[];    // run detail `status` per phase (all phases)
    glanceShort: boolean;                 // the done-state's negative branch
    testPoint: 'on' | 'fast' | 'slow' | null;
    slipping: boolean;                    // training influence
    winNull: boolean | null;              // win line null? null = not asserted
  };
}

const FIXTURES: Fixture[] = [
  {
    name: 'intervals · 6×800 m VO2, one rep slow',
    planType: 'intervals', winType: 'intervals', spec: { kind: 'intervals', rep_rest_s: 120 },
    plannedPaceSPerMi: 400, plannedMi: 7,
    phases: [
      wu(1.5, 502, 520),
      rep(0.5, 400, 398, 168, { paceShape: 'window', tolerancePaceSPerMi: 8 }), jog(118, 700, 150, 120),
      rep(0.5, 400, 402, 171, { paceShape: 'window', tolerancePaceSPerMi: 8 }), jog(121, 700, 150, 120),
      rep(0.5, 400, 405, 173, { paceShape: 'window', tolerancePaceSPerMi: 8 }), jog(119, 700, 150, 120),
      rep(0.5, 400, 396, 174, { paceShape: 'window', tolerancePaceSPerMi: 8 }), jog(122, 700, 150, 120),
      rep(0.5, 400, 415, 175, { paceShape: 'window', tolerancePaceSPerMi: 8 }), jog(120, 700, 150, 120),
      rep(0.5, 400, 401, 176, { paceShape: 'window', tolerancePaceSPerMi: 8 }),
      cd(1.5, 502, 540),
    ],
    expect: {
      work: ['hit', 'hit', 'hit', 'hit', 'slow', 'hit'], session: 'uneven',
      detailStatuses: ['on', 'on', null, 'on', null, 'on', null, 'on', null, 'slow', null, 'on', 'on'],
      glanceShort: false, testPoint: 'on', slipping: false, winNull: false,
    },
  },
  {
    name: 'threshold · the real 4×1 mi (legacy words, no wire tolerance)',
    planType: 'threshold', winType: 'threshold', spec: { kind: 'threshold', rep_rest_s: 60 },
    plannedPaceSPerMi: 430, plannedMi: 8.5,
    phases: REAL_4X1,
    expect: {
      work: ['hit', 'hit', 'hit', 'fast'], session: 'executed',
      detailStatuses: ['on', 'on', null, 'on', null, 'on', null, 'fast', 'on'],
      glanceShort: false, testPoint: 'on', slipping: false, winNull: false,
    },
  },
  {
    name: 'continuous tempo · 4 mi block',
    planType: 'tempo', winType: 'tempo', spec: { kind: 'tempo' },
    plannedPaceSPerMi: 445, plannedMi: 7,
    phases: [wu(1.5, 502, 518), rep(4, 445, 448, 160, { label: 'Tempo · 4 mi' }), cd(1.5, 502, 545)],
    expect: {
      work: ['hit'], session: 'executed', detailStatuses: ['on', 'on', 'on'],
      glanceShort: false, testPoint: 'on', slipping: false, winNull: false,
    },
  },
  {
    name: 'cutdowns · 3 × descending blocks',
    planType: 'progression', winType: 'progression', spec: { kind: 'threshold' },
    plannedPaceSPerMi: 440, plannedMi: 8,
    phases: [
      wu(1.5, 502, 515),
      rep(2, 460, 458, 152, { label: 'Block 1' }), rep(2, 440, 438, 158, { label: 'Block 2' }),
      rep(2, 420, 425, 164, { label: 'Block 3' }),
      cd(0.5, 502, 560),
    ],
    expect: {
      work: ['hit', 'hit', 'hit'], session: 'executed', detailStatuses: ['on', 'on', 'on', 'on', 'on'],
      glanceShort: false, testPoint: 'on', slipping: false, winNull: null,
    },
  },
  {
    name: 'easy ceiling · run 32 s/mi over the ceiling',
    planType: 'easy', winType: 'easy', spec: { kind: 'easy', hr_cap_bpm: 151 },
    plannedPaceSPerMi: 502, plannedMi: 6,
    phases: [rep(6, 502, 470, 156, { label: 'Easy · 6 mi' })],
    expect: {
      // `fast` past a ceiling is the one thing an easy day can fail on pace;
      // the pace layer records it and the HR reader judges it.
      work: ['fast'], session: 'executed', detailStatuses: ['fast'],
      glanceShort: false, testPoint: 'fast', slipping: false, winNull: null,
    },
  },
  {
    name: 'long run · under the ceiling, no finish',
    planType: 'long', winType: 'long', spec: { kind: 'long' },
    plannedPaceSPerMi: 530, plannedMi: 14,
    phases: [rep(14, 530, 545, 148, { label: 'Long · 14 mi' })],
    expect: {
      work: ['hit'], session: 'executed', detailStatuses: ['on'],
      glanceShort: false, testPoint: 'on', slipping: false, winNull: null,
    },
  },
  {
    name: 'marathon-specific · 16 mi with 4 mi @ M finish (mixed shapes)',
    planType: 'long', winType: 'long', spec: { kind: 'long', finish_mi: 4, finish_pace_s_per_mi: 475 },
    plannedPaceSPerMi: 530, plannedMi: 16,
    phases: [
      rep(12, 530, 540, 150, { label: 'Long · 12 mi', paceShape: 'ceiling', tolerancePaceSPerMi: 30 }),
      rep(4, 475, 478, 162, { label: 'Finish · 4 mi @ M', paceShape: 'window', tolerancePaceSPerMi: 8, isFinishSegment: true }),
    ],
    expect: {
      work: ['hit', 'hit'], session: 'executed', detailStatuses: ['on', 'on'],
      glanceShort: false, testPoint: 'on', slipping: false, winNull: null,
    },
  },
  {
    name: 'race · 10K in four segments at ±12',
    planType: 'race', winType: 'race', spec: { kind: 'long' },
    plannedPaceSPerMi: 429, plannedMi: 6.2,
    phases: [
      rep(1.5, 429, 426, 170, { label: 'Opening', tolerancePaceSPerMi: 12, paceShape: 'window' }),
      rep(1.6, 429, 430, 174, { label: 'Middle', tolerancePaceSPerMi: 12, paceShape: 'window' }),
      rep(1.6, 429, 433, 176, { label: 'Climb', tolerancePaceSPerMi: 12, paceShape: 'window' }),
      rep(1.5, 429, 418, 179, { label: 'Run-in', tolerancePaceSPerMi: 12, paceShape: 'window' }),
    ],
    expect: {
      work: ['hit', 'hit', 'hit', 'hit'], session: 'executed', detailStatuses: ['on', 'on', 'on', 'on'],
      glanceShort: false, testPoint: 'on', slipping: false, winNull: null,
    },
  },
  {
    name: 'recovery · a slow jog is a correct recovery',
    planType: 'recovery', winType: 'recovery', spec: { kind: 'recovery' },
    plannedPaceSPerMi: 560, plannedMi: 4,
    phases: [rep(4, 560, 595, 138, { label: 'Recovery · 4 mi' })],
    expect: {
      work: ['hit'], session: 'executed', detailStatuses: ['on'],
      glanceShort: false, testPoint: 'on', slipping: false, winNull: null,
    },
  },
  {
    name: 'incomplete · stopped inside rep 3 of 4',
    planType: 'threshold', winType: 'threshold', spec: { kind: 'threshold', rep_rest_s: 60 },
    plannedPaceSPerMi: 430, plannedMi: 8.5,
    phases: [
      wu(2, 502, 515),
      rep(1, 430, 428, 160), jog(61, 600),
      rep(1, 430, 431, 163), jog(62, 600),
      { ...rep(0.35, 430, 445, 168), completed: false, actualDurationSec: 156 },
    ],
    expect: {
      work: ['hit', 'hit', 'incomplete'], session: 'incomplete',
      detailStatuses: ['on', 'on', null, 'on', null, null],
      glanceShort: true, testPoint: 'on', slipping: true, winNull: null,
    },
  },
  {
    name: 'modified · 3×2000 m run in place of 5×1000 m, at the pace',
    planType: 'intervals', winType: 'intervals', spec: { kind: 'intervals', rep_count: 5, rep_rest_s: 120 },
    plannedPaceSPerMi: 405, plannedMi: 7.5,
    phases: [
      wu(1.5, 502, 520),
      rep(1.24, 405, 404, 170, { label: 'Interval · 2 km' }), jog(150, 650, 150, 120),
      rep(1.24, 405, 407, 172, { label: 'Interval · 2 km' }), jog(148, 650, 150, 120),
      rep(1.24, 405, 403, 174, { label: 'Interval · 2 km' }),
      cd(1.5, 502, 545),
    ],
    expect: {
      // The verdict grades what was RUN, rep for rep. Whether 3×2 km IS the
      // 5×1 km stimulus is `interpretExecution`'s question (EQUIVALENT), asked
      // below on the reconstruction, never here.
      work: ['hit', 'hit', 'hit'], session: 'executed',
      detailStatuses: ['on', 'on', null, 'on', null, 'on', 'on'],
      glanceShort: false, testPoint: 'on', slipping: false, winNull: false,
    },
  },
  {
    name: 'sensor-limited · no target, no GPS distance, a bad HR sentinel',
    planType: 'threshold', winType: 'threshold', spec: { kind: 'threshold' },
    plannedPaceSPerMi: 430, plannedMi: 8,
    phases: [
      // A payload from a run the instruments could not describe: durations
      // recorded, no distance (so no pace), no target on the phase, and an
      // HR sentinel outside anything a heart produces.
      { type: 'warmup', actualDurationSec: 600, avgHr: null },
      { type: 'work', actualDurationSec: 1720, avgHr: 250 },
      { type: 'cooldown', actualDurationSec: 600, avgHr: null },
    ],
    expect: {
      // Rule 11 · nothing is graded, and that is a stated third state rather
      // than a pass or a failure. No surface may invent a verdict here, and
      // the bad HR is dropped rather than averaged into a reading.
      work: ['not_graded'], session: 'not_graded', detailStatuses: [null, null, null],
      glanceShort: false, testPoint: null, slipping: false, winNull: null,
    },
  },
];

/** The planned read `actualStimulus` compares against, minimal. */
function plannedFor(f: Fixture): PlannedRead {
  const domain = f.planType === 'intervals' ? 'interval'
    : f.planType === 'race' ? 'race'
    : f.planType === 'long' ? (f.spec && Number(f.spec.finish_mi) > 0 ? 'marathon' : 'easy')
    : f.planType === 'easy' || f.planType === 'recovery' ? 'easy'
    : 'threshold';
  return {
    basis: 'expanded-spec',
    workTargetSPerMi: f.plannedPaceSPerMi,
    stimulus: { domain, workMinutes: 28, workMi: 4, meanWorkPaceSPerMi: f.plannedPaceSPerMi, recoveryIntent: 'incomplete' },
  };
}
function sessionFor(f: Fixture): PlannedSession {
  return {
    dateISO: '2026-09-01', type: f.planType, isQuality: true, isLong: f.planType === 'long',
    distanceMi: f.plannedMi, paceTargetSPerMi: f.plannedPaceSPerMi, spec: (f.spec ?? null) as unknown as WorkoutSpec,
  };
}

describe('VERDICT-2 · the twelve workout types, every consumer agreeing', () => {
  // LIVENESS · the matrix must actually cover the twelve the brief names.
  it('covers the twelve types the brief names', () => {
    expect(FIXTURES.length).toBe(12);
    const names = FIXTURES.map((f) => f.name.split(' · ')[0]);
    for (const want of ['intervals', 'threshold', 'continuous tempo', 'cutdowns', 'easy ceiling', 'long run',
      'marathon-specific', 'race', 'recovery', 'incomplete', 'modified', 'sensor-limited']) {
      expect(names, `no fixture for ${want}`).toContain(want);
    }
  });

  for (const f of FIXTURES) {
    describe(f.name, () => {
      const grade = resolveWorkoutVerdict({ type: f.planType, spec: f.spec, phases: f.phases });
      const workVerdicts = grade.phases.filter((p) => p.type === 'work').map((p) => p.verdict);

      it('the resolver', () => {
        expect(workVerdicts).toEqual(f.expect.work);
        expect(grade.session.verdict).toBe(f.expect.session);
        expect(grade.session.workVerdicts).toEqual(workVerdicts);
        // Recoveries and ceilings never grade.
        for (const p of grade.phases) {
          if (p.type === 'recovery') expect(p.verdict).toBe('not_graded');
          if (p.shape === 'ceiling') expect(p.verdict).not.toBe('slow');
        }
      });

      it('run detail · phase panel statuses', () => {
        const mapped = mapWatchPhases(f.phases, 0, grade.sessionClass);
        expect(mapped.map((m) => m.status)).toEqual(f.expect.detailStatuses);
        // Phase for phase, the panel IS the resolver.
        for (let i = 0; i < mapped.length; i++) {
          const g = grade.phases[i]!;
          const want = g.verdict === 'hit' ? 'on' : g.verdict === 'fast' ? 'fast' : g.verdict === 'slow' ? 'slow' : null;
          expect(mapped[i]!.status, `phase ${i}`).toBe(want);
          expect(mapped[i]!.status_label, `phase ${i}`).toBe(g.statusLabel);
          expect(mapped[i]!.pace_shape, `phase ${i}`).toBe(g.shape);
          expect(mapped[i]!.tolerance_pace_sec, `phase ${i}`).toBe(g.toleranceSec);
        }
      });

      it('glance · the done-state s negative branch', () => {
        const share = fellShortShare(grade);
        const short = grade.work.incomplete || (share != null && share >= 0.34);
        expect(short).toBe(f.expect.glanceShort);
      });

      it('targets · the test point', () => {
        const tp = judgeTestPointExecution({
          type: f.planType, targetS: f.plannedPaceSPerMi,
          watchWorkS: grade.work.paceSPerMi, overallS: null,
          rawSplits: null, splitsUnreliable: false,
          spec: (f.spec ?? null) as unknown as WorkoutSpec,
          plannedDistanceMi: f.plannedMi, actualDistanceMi: f.plannedMi,
          vdot: null, heatSlowdownPct: 0, grade,
        });
        expect(tp.verdict).toBe(f.expect.testPoint);
        // And never contradicts the session: an executed session is not `slow`,
        // an off-target one is not `on`.
        if (grade.session.verdict === 'executed') expect(tp.verdict).not.toBe('slow');
        if (grade.session.verdict === 'off_target') expect(tp.verdict).toBe('slow');
        expect(testPointVerdictFor(grade, () => 'on')).toBe(
          grade.work.graded === 0 ? null
            : grade.session.verdict === 'executed' ? (grade.session.fasts === grade.session.graded ? 'fast' : 'on')
            : grade.session.verdict === 'off_target' ? 'slow' : 'on');
      });

      it('training influence · slipping only when the session says so', () => {
        if (!['intervals', 'tempo', 'threshold', 'long'].includes(f.planType)) return;
        const infl = composeTrainingInfluence({
          type: f.planType, spec: f.spec, plannedPaceSec: f.plannedPaceSPerMi,
          donePaceSec: grade.work.paceSPerMi, doneAvgHr: grade.work.hrAvg, sameTypeStreak: 1,
          wasAdapted: false, wasRestored: false, phaseLabel: 'BUILD', raceDistanceMi: 26.2,
          hrOnPaceDelta: null, grade,
        });
        expect(infl?.kind === 'slipping').toBe(f.expect.slipping);
      });

      it('execution reconstruction · the same rep verdicts', () => {
        const a = actualStimulus(asRunData({ phases: f.phases, status: 'completed' }), plannedFor(f), sessionFor(f), { vdot: 48 });
        expect(a?.basis).toBe('watch-phases');
        expect(a?.workVerdicts).toEqual(workVerdicts);
      });

      it('win line · reads the grade, never the stored word', () => {
        if (f.expect.winNull == null) return;
        const win = deriveWin({
          type: f.winType, phase: 'BUILD', plannedMi: f.plannedMi, plannedPaceSPerMi: f.plannedPaceSPerMi,
          plannedHrCap: null, actualMi: f.plannedMi, actualPaceSPerMi: 480, actualAvgHr: grade.work.hrAvg,
          splits: undefined, verdict: 'Reps done.', grade,
          phases: f.phases.map((p) => ({ type: p.type, verdict: p.verdict ?? null,
            actualPaceSPerMi: p.actualPaceSPerMi ?? null, targetPaceSPerMi: p.targetPaceSPerMi ?? null })),
        });
        expect(win == null).toBe(f.expect.winNull);
        // A session where most reps fell short may not be sold as a win.
        if (grade.session.verdict === 'off_target') expect(win).toBeNull();
      });
    });
  }
});

/* ═══════════════════════ 3 · the mandatory fixture ═══════════════════════ */

describe('VERDICT-3 · the owner s 2026-09-01 4×1 mi, on every consumer', () => {
  const grade = resolveWorkoutVerdict({ type: 'threshold', spec: { kind: 'threshold', rep_rest_s: 60 }, phases: REAL_4X1 });

  it('hit / hit / hit / fast, jogs ungraded, warm-up and cool-down under the ceiling', () => {
    const byType = (t: string) => grade.phases.filter((p) => p.type === t);
    expect(byType('work').map((p) => p.verdict)).toEqual(['hit', 'hit', 'hit', 'fast']);
    expect(byType('work').map((p) => p.statusLabel)).toEqual(['On target', 'On target', 'On target', 'Quicker than target']);
    expect(byType('recovery').map((p) => p.verdict)).toEqual(['not_graded', 'not_graded', 'not_graded']);
    expect(byType('recovery').map((p) => p.statusLabel)).toEqual([null, null, null]);
    expect(byType('warmup')[0]!.verdict).toBe('hit');
    expect(byType('warmup')[0]!.statusLabel).toBe('Under the ceiling');
    expect(byType('cooldown')[0]!.verdict).toBe('hit');
    expect(byType('cooldown')[0]!.statusLabel).toBe('Under the ceiling');
    expect(grade.session.verdict).toBe('executed');
    expect(grade.session.recoveriesHonest).toBe(true);
    expect(grade.session.lateCollapse).toBe(false);
    // The device's words survive as a stored fact and decide nothing.
    expect(byType('work').map((p) => p.storedVerdict)).toEqual(['drifted', 'drifted', 'drifted', 'missed']);
    // The work numbers every surface prints beside the verdict.
    expect(grade.work.paceSPerMi).toBe(423);
    expect(grade.work.hrAvg).toBe(162);
    // The work distance is the fixture's own four one-mile reps. The resolver
    // does not carry it (see `WorkSummary`), so this sums the graded phases.
    expect(grade.phases.filter((p) => p.type === 'work')
      .reduce((a, p) => a + (p.actualDistanceMi ?? 0), 0)).toBe(4);
  });

  it('the win line says the set landed', () => {
    const win = deriveWin({
      type: 'threshold', phase: 'BUILD', plannedMi: 8.5, plannedPaceSPerMi: 430, plannedHrCap: null,
      actualMi: 8.5, actualPaceSPerMi: 483, actualAvgHr: 154, splits: undefined, verdict: 'Tempo done.', grade,
    });
    // `winVerdictHit` is the highest rung and is type-agnostic, so a
    // structured session answers there: FOUR of four, off the canonical
    // verdicts. The device's stored words would have made it three (see the
    // legacy test below) — one rep "missed" for being quicker than asked.
    expect(win).toBe('Hit target band on 4 of 4 reps · clean execution.');
    const winReps = deriveWin({
      type: 'intervals', phase: 'BUILD', plannedMi: 8.5, plannedPaceSPerMi: 430, plannedHrCap: null,
      actualMi: 8.5, actualPaceSPerMi: 483, actualAvgHr: 154, splits: undefined, verdict: 'Reps done.', grade,
    });
    expect(winReps).toBe('Hit target band on 4 of 4 reps · clean execution.');
  });

  it('the tempo composer, reached when the session is one continuous block', () => {
    // One work phase, so `winVerdictHit` abstains (it needs two reps) and the
    // type composer answers. 423 against 430 is inside the ±8 window: the line
    // used to read "just off target", which reads as SLOWER to a runner who
    // was seven seconds a mile quicker.
    const single = resolveWorkoutVerdict({
      type: 'tempo', spec: { kind: 'tempo' },
      phases: [wu(1.5, 502, 518), rep(4, 430, 423, 162, { label: 'Tempo · 4 mi' }), cd(1.5, 502, 545)],
    });
    expect(deriveWin({
      type: 'tempo', phase: 'BUILD', plannedMi: 7, plannedPaceSPerMi: 430, plannedHrCap: null,
      actualMi: 7, actualPaceSPerMi: 483, actualAvgHr: 162, splits: undefined,
      verdict: 'Tempo done.', grade: single,
    })).toBe('Held the line · 7:03 inside the window');
  });

  it('the legacy stored-word path would have said something else — and is no longer reached', () => {
    // The defect, reproduced on purpose: with no grade, the interval win line
    // counts the device's words and calls three of four "on target".
    const legacy = deriveWin({
      type: 'intervals', phase: 'BUILD', plannedMi: 8.5, plannedPaceSPerMi: 430, plannedHrCap: null,
      actualMi: 8.5, actualPaceSPerMi: 483, actualAvgHr: 154, splits: undefined, verdict: 'Reps done.',
      phases: REAL_4X1.map((p) => ({ type: p.type, verdict: p.verdict ?? null,
        actualPaceSPerMi: p.actualPaceSPerMi ?? null, targetPaceSPerMi: p.targetPaceSPerMi ?? null })),
    });
    expect(legacy).toBe('3 of 4 reps on target.');
  });

  it('run detail, the done-state, the test point and the reconstruction agree', () => {
    expect(mapWatchPhases(REAL_4X1, 0, 'threshold').map((m) => m.status))
      .toEqual(['on', 'on', null, 'on', null, 'on', null, 'fast', 'on']);
    // Run detail WITHOUT the class — the defect this gate exists for — is now
    // the unnamed-session read, and rep four reads "on" at ±30. That path is
    // no longer reachable from run detail (`loadRunDetail` passes the class),
    // and this line pins what it would say so the difference is visible.
    expect(mapWatchPhases(REAL_4X1).map((m) => m.status)[7]).toBe('on');
    expect(fellShortShare(grade)).toBe(0);
    expect(judgeTestPointExecution({
      type: 'threshold', targetS: 430, watchWorkS: 423, overallS: 483, rawSplits: null, splitsUnreliable: false,
      spec: { kind: 'threshold' } as unknown as WorkoutSpec, plannedDistanceMi: 8.5, actualDistanceMi: 8.5,
      vdot: null, heatSlowdownPct: 0, grade,
    }).verdict).toBe('on');
    const a = actualStimulus(asRunData({ phases: REAL_4X1, status: 'completed' }), {
      basis: 'expanded-spec', workTargetSPerMi: 430,
      stimulus: { domain: 'threshold', workMinutes: 28.7, workMi: 4, meanWorkPaceSPerMi: 430, recoveryIntent: 'incomplete' },
    }, { dateISO: '2026-09-01', type: 'threshold', isQuality: true, isLong: false, distanceMi: 8.5, paceTargetSPerMi: 430,
         spec: { kind: 'threshold' } as unknown as WorkoutSpec }, { vdot: 48 });
    expect(a?.workVerdicts).toEqual(['hit', 'hit', 'hit', 'fast']);
  });

  it('gradeStoredPhases on the legacy row uses the class table, not the unnamed width', () => {
    expect(gradeStoredPhases(REAL_4X1, 'threshold').phases[7]!.toleranceSec).toBe(8);
    expect(gradeStoredPhases(REAL_4X1, 'other').phases[7]!.toleranceSec).toBe(30);
  });
});
