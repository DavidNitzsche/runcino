/**
 * EXECSEM-1 · there is ONE grading tolerance, and every consumer calls it.
 *
 * THE BUG CLASS. On 2026-09-01 the owner ran `4×1 mi @ T pace · 1 min jog` at
 * 422 / 429 / 422 / 419 s/mi against a 430 target, on a slight negative split,
 * with 61 / 64 / 64 s recoveries against a prescribed 60. The app returned
 * drifted, drifted, drifted, missed — and graded the cool-down "missed" too.
 *
 * No single line was wrong. FIVE tolerances were live at once, none of them
 * shared, and the phone and the wrist did not even agree on which CLASS a
 * session was (`workout_spec.kind` on the wrist, `strictPrescriptionType` on
 * the phone: 21 live plan rows where one said ±8 and the other ±20). A
 * behavioural test cannot catch that — every one of the five produced a
 * perfectly legal verdict. The defect is only visible in the LITERALS.
 *
 * So this is a SCANNER, the same shape as ACTIVEPLAN-1 and the normal-window
 * scan, and for the same stated reason.
 *
 * ── WHAT IT CANNOT FAIL ON (Rule 22) ────────────────────────────────────────
 *
 *   · A consumer that calls `sessionToleranceSec` and then adds five to the
 *     result. It checks that the owner is CALLED, not that the answer is used
 *     unmodified.
 *   · A tolerance written as a named constant in another module and imported.
 *     The regexes below look for numeric literals in tolerance-shaped
 *     positions; `const T = 8` two files away and passed in reads clean. That
 *     is deliberate — a named, documented constant is not the failure mode
 *     this gate exists for — but it is a hole and it is stated here.
 *   · Anything about whether the WIDTH is right. Doctrine's own ±3 for T is
 *     narrower than the 8 this app ships, argued in `execution-semantics.ts`'s
 *     header. This gate enforces one answer, not the right one.
 *   · The Swift side. `WorkoutEngine.swift` grades on the wrist and no
 *     TypeScript scanner can see it; `_watch_grader_parity.test.ts` is the
 *     check that covers that seam.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * The files that judge a pace against a target, and therefore must route
 * through `lib/training/execution-semantics.ts`.
 *
 * Every one of these carried its own literal before 2026-09-01; the comment
 * beside each names the number it carried, so a reviewer can see what the gate
 * is holding back rather than trusting that it is holding anything.
 */
const CONSUMERS: readonly string[] = [
  'app/api/v5/today/route.ts',          // was: threshold||intervals ? 8 : race ? 12 : 20
  'lib/training/spec-card.ts',          // was: input.toleranceSec ?? 8
  'lib/watch/build-workout.ts',         // was: threshold||interval ? 8 : race ? 12 : 20
  'lib/training/goal-projection.ts',    // was: type === 'long' ? 40 : 10, and a bare 15
  'lib/coach/run-state.ts',             // was: heatAdjustedStatus default 10, and a bare 8
  'lib/coach/training-influence.ts',    // was: type === 'long' ? 18 : 12
];

const OWNER = 'lib/training/execution-semantics.ts';

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Strip block and line comments — a tolerance quoted in a docblock is
 *  documentation of the old defect, not a live literal. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * A numeric literal reaching a tolerance-shaped position.
 *
 * Matching on `tolerance = 8` alone is NOT enough, and this gate was falsified
 * to prove it: restoring `const tolerance = input.type === 'long' ? 18 : 12`
 * in `training-influence.ts` passed a first version of this scanner, because
 * the digit did not sit immediately after the `=`. So the rule is: find any
 * binding or property whose NAME says tolerance, take its whole right-hand
 * side, and fail on a bare integer anywhere inside it.
 *
 * A bare integer means one not glued to an identifier — so
 * `EASY_PHASE_TOLERANCE_S_PER_MI` and `z4` do not trip it, and `12` does.
 */
const TOLERANCE_BINDING = /\btolerance[A-Za-z_]*\s*(?:=|\?\?|:)\s*([^;\n]{0,160})/gi;
/** The 4th positional argument of the shared verdict comparator. */
const HEAT_STATUS_ARG = /\bheatAdjustedStatus\s*\(([^)]*)\)/gi;
/** A digit run not glued to an identifier or a decimal point. */
const BARE_INT = /(?<![A-Za-z_0-9.])\d+(?![A-Za-z_0-9.])/;

interface Finding { file: string; snippet: string }

/**
 * The ratchet. It may SHRINK, never grow, and a stale entry fails until it is
 * deleted (the third `it` below is what enforces that half). Every entry
 * carries an argued reason, never "we might need it".
 */
const EXEMPT: readonly { file: string; snippet: string; reason: string }[] = [
  {
    file: 'lib/watch/build-workout.ts',
    snippet: 'toleranceSec: Math.round((hi - lo) / 2)',
    reason:
      'NOT A WIDTH — a parse. `parsePaceTarget` is reading an explicit RANGE '
      + 'string ("6:50-7:10") that already states its own half-width, and the 2 '
      + 'is the division that turns a full range into a half-range. A prescribed '
      + 'range beats any table, so this must NOT route through the owner.',
  },
  {
    file: 'lib/watch/build-workout.ts',
    snippet: 'tolerancePaceSPerMi: 12',
    reason:
      'RACE DAY. `buildRaceDayPhases` prices the race band from the race plan '
      + '(`lib/race/pacing.ts`), which is a separate owner (Constitution §J) and '
      + "is out of this change's scope. The value AGREES with "
      + "sessionToleranceSec('race') today and the test below fails the moment "
      + 'it stops agreeing, so the exemption is about who owns the race branch, '
      + 'not licence to diverge.',
  },
  {
    file: 'lib/watch/build-workout.ts',
    snippet: 'tolerancePaceSPerMi: Math.min(race.tolerancePaceSPerMi ?? 12, 12)',
    reason: 'Same race-day branch, clamping one race-plan segment band.',
  },
  {
    file: 'lib/watch/build-workout.ts',
    snippet: 'tolerancePaceSPerMi = Math.min(race.tolerancePaceSPerMi ?? 12, 12)',
    reason: 'Same race-day branch, the in-place clamp of a race-plan segment band.',
  },
];

function isExempt(f: Finding): boolean {
  return EXEMPT.some((e) => e.file === f.file && f.snippet.startsWith(e.snippet));
}

function scanFile(rel: string): Finding[] {
  const src = stripComments(read(rel));
  const out: Finding[] = [];
  const push = (whole: string, rhs: string): void => {
    const m = BARE_INT.exec(rhs);
    // `tolerance: null`, `tolerance: 0` and `?? 0` are absences, not widths.
    if (!m || m[0] === '0') return;
    out.push({ file: rel, snippet: whole.replace(/\s+/g, ' ').slice(0, 90) });
  };
  for (const re of [TOLERANCE_BINDING, HEAT_STATUS_ARG]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) != null) push(m[0], m[1] ?? '');
  }
  return out;
}

describe('EXECSEM-1 · one tolerance owner', () => {
  it('every consumer imports the owner', () => {
    // LIVENESS (Rule 18) · the scanner must be reading real files. A gate that
    // reports clean because it looked at nothing is the worst outcome
    // available, since it also reports confidence.
    expect(CONSUMERS.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const rel of CONSUMERS) {
      const src = read(rel);
      expect(src.length).toBeGreaterThan(500);
      if (!/from '(@\/lib\/training\/execution-semantics|\.\/execution-semantics)'/.test(src)) {
        missing.push(rel);
      }
    }
    expect(missing, `these grade a pace but do not call the owner:\n${missing.join('\n')}`)
      .toEqual([]);
  });

  it('no consumer carries its own tolerance literal', () => {
    const findings = CONSUMERS.flatMap(scanFile).filter((f) => !isExempt(f));
    expect(
      findings,
      `a tolerance literal outside ${OWNER}:\n` +
        findings.map((f) => `  ${f.file} · ${f.snippet}`).join('\n'),
    ).toEqual([]);
  });

  it('no exemption is stale', () => {
    // Rule 18 part 4 · an exemption whose target is now clean FAILS until it is
    // deleted. Without this the allowlist quietly stops meaning anything.
    const all = CONSUMERS.flatMap(scanFile);
    const dead = EXEMPT.filter(
      (e) => !all.some((f) => f.file === e.file && f.snippet.startsWith(e.snippet)),
    );
    expect(
      dead.map((d) => `${d.file} · ${d.snippet}`),
      'these exemptions no longer match anything — delete them',
    ).toEqual([]);
  });

  it('the exempted race width agrees with the owner s race width', async () => {
    // The exemption is about OWNERSHIP of the race branch, not licence to
    // diverge. The moment the two numbers disagree, this fails.
    const { sessionToleranceSec } = await import('./execution-semantics');
    expect(sessionToleranceSec('race')).toBe(12);
  });

  it('the owner itself is the only place the widths are written', () => {
    const src = stripComments(read(OWNER));
    // The table, doctrine's E width, and the two doctrine-cited shares.
    expect(src).toMatch(/threshold:\s*8/);
    expect(src).toMatch(/interval:\s*8/);
    expect(src).toMatch(/race:\s*12/);
    expect(src).toMatch(/easy:\s*EASY_PHASE_TOLERANCE_S_PER_MI/);
    expect(src).toMatch(/EASY_PHASE_TOLERANCE_S_PER_MI\s*=\s*30/);
  });
});

/* ══════════════════════════ doctrine, read at run time ═══════════════════ */

describe('EXECSEM-2 · the widths respect doctrine s own ordering', () => {
  /**
   * Rule 18: read the numbers out of the cited source rather than hardcoding
   * both sides. `Research/01-pace-zones-vdot.md` §"Pace zone width and lock-in
   * rules" states E ±30, M ±5, T ±3, I ±3, R ±1-2 and, one line under the
   * table, the rule that orders them: "the harder the workout, the tighter the
   * lock."
   *
   * The app's widths are WIDER than doctrine's (argued in the owner's header —
   * doctrine's ±3 is a track split, this grades a GPS segment average against
   * a 0.727-confidence anchor). What may NOT drift is the ORDER.
   */
  const DOC = path.resolve(ROOT, '..', 'Research', '01-pace-zones-vdot.md');

  function doctrineWidths(): { E: number; M: number; T: number } {
    const src = fs.readFileSync(DOC, 'utf8');
    const anchor = src.indexOf('## Pace zone width and lock-in rules');
    expect(anchor, 'the cited section is gone from Research/01').toBeGreaterThan(0);
    const table = src.slice(anchor, anchor + 1200);
    const row = (zone: string): number => {
      const m = new RegExp(`\\|\\s*${zone}\\s*\\|\\s*±(\\d+)`).exec(table);
      expect(m, `no ±N row for zone ${zone} in the cited table`).not.toBeNull();
      return Number(m![1]);
    };
    return { E: row('E'), M: row('M'), T: row('T') };
  }

  it('doctrine still states the table this module cites', () => {
    const d = doctrineWidths();
    expect(d.T).toBeGreaterThan(0);
    expect(d.M).toBeGreaterThan(0);
    expect(d.E).toBeGreaterThan(0);
  });

  it('quality is tighter than marathon-effort, which is tighter than easy', async () => {
    const d = doctrineWidths();
    // The doctrine's own ordering, asserted from the doc, not restated here.
    expect(d.T).toBeLessThan(d.M);
    expect(d.M).toBeLessThan(d.E);

    const { sessionToleranceSec, EASY_PHASE_TOLERANCE_S_PER_MI } =
      await import('./execution-semantics');
    // The app's table must respect the same ordering.
    expect(sessionToleranceSec('threshold')).toBeLessThan(sessionToleranceSec('race'));
    expect(sessionToleranceSec('interval')).toBeLessThan(sessionToleranceSec('race'));
    expect(sessionToleranceSec('race')).toBeLessThan(sessionToleranceSec('easy'));
    expect(sessionToleranceSec('easy')).toBeLessThanOrEqual(EASY_PHASE_TOLERANCE_S_PER_MI);
    // And doctrine's own E width is what an easy phase carries, exactly.
    expect(EASY_PHASE_TOLERANCE_S_PER_MI).toBe(d.E);
  });
});

/* ═════════════════════ the 2026-09-01 session, graded ════════════════════ */

describe('EXECSEM-3 · the owner s real 2026-09-01 threshold session', () => {
  /**
   * The production row, `runs` id -258355938987883, phase for phase. Every
   * number here was read off the live canonical row, not constructed.
   */
  const PHASES = [
    { phaseType: 'warmup'   as const, targetSecPerMi: 502, avgSecPerMi: 516 },
    { phaseType: 'work'     as const, targetSecPerMi: 430, avgSecPerMi: 422 },
    { phaseType: 'recovery' as const, targetSecPerMi: null, avgSecPerMi: 515 },
    { phaseType: 'work'     as const, targetSecPerMi: 430, avgSecPerMi: 429 },
    { phaseType: 'recovery' as const, targetSecPerMi: null, avgSecPerMi: 785 },
    { phaseType: 'work'     as const, targetSecPerMi: 430, avgSecPerMi: 422 },
    { phaseType: 'recovery' as const, targetSecPerMi: null, avgSecPerMi: 1034 },
    { phaseType: 'work'     as const, targetSecPerMi: 430, avgSecPerMi: 419 },
    { phaseType: 'cooldown' as const, targetSecPerMi: 502, avgSecPerMi: 534 },
  ];
  const RECOVERIES = [
    { prescribedSec: 60, actualSec: 61 },
    { prescribedSec: 60, actualSec: 64 },
    { prescribedSec: 60, actualSec: 64 },
  ];

  it('no rep grades slow, drifted or missed', async () => {
    // The heart of Finding 2. Three of these came back "drifted" and the
    // fourth "missed" — and "missed" reads as TOO SLOW to a runner who was in
    // fact three seconds a mile quick on his last and fastest rep, having been
    // told by the watch to "run it at the pace of the first."
    const { gradePhase, phaseVerdictLabel, paceShapeFor } = await import('./execution-semantics');
    const reps = PHASES.filter((p) => p.phaseType === 'work');
    const verdicts = reps.map((p) => gradePhase(p, 'threshold'));
    expect(verdicts).toEqual(['hit', 'hit', 'hit', 'fast']);
    expect(verdicts).not.toContain('slow');
    expect(verdicts).not.toContain('incomplete');
    const shape = paceShapeFor('work', 'threshold');
    expect(verdicts.map((v) => phaseVerdictLabel(v, shape))).toEqual([
      'On target', 'On target', 'On target', 'Quicker than target',
    ]);
  });

  it('the cool-down is under the ceiling, not missed', async () => {
    const { gradePhase, phaseVerdictLabel, paceShapeFor } = await import('./execution-semantics');
    const cd = PHASES[8];
    const v = gradePhase(cd, 'threshold');
    expect(v).toBe('hit');
    expect(phaseVerdictLabel(v, paceShapeFor('cooldown', 'threshold'))).toBe('Under the ceiling');
  });

  it('the recovery jogs are not pace-graded at all', async () => {
    const { gradePhase } = await import('./execution-semantics');
    const jogs = PHASES.filter((p) => p.phaseType === 'recovery');
    expect(jogs.map((p) => gradePhase(p, 'threshold')))
      .toEqual(['not_graded', 'not_graded', 'not_graded']);
  });

  it('the session reads as executed', async () => {
    const { gradeSession } = await import('./execution-semantics');
    const g = gradeSession(PHASES, 'threshold', { recoveries: RECOVERIES });
    expect(g.verdict).toBe('executed');
    expect(g.hits).toBe(3);
    expect(g.fasts).toBe(1);
    expect(g.graded).toBe(4);
    expect(g.lateCollapse).toBe(false);
    expect(g.recoveriesHonest).toBe(true);
  });

  it('the doctrine s own counter-example still reads as NOT executed', async () => {
    // `ADAPTATION_PROGRESSION_DOCTRINE.md` §"Compare intended stimulus vs
    // actual execution": 6:30/6:32/6:45/7:10 finishing destroyed is not
    // evidence threshold should get faster. Rule 22 — a gate that can only
    // pass the good case proves nothing.
    const { gradeSession } = await import('./execution-semantics');
    const bad = [
      { phaseType: 'work' as const, targetSecPerMi: 410, avgSecPerMi: 390 },
      { phaseType: 'work' as const, targetSecPerMi: 410, avgSecPerMi: 392 },
      { phaseType: 'work' as const, targetSecPerMi: 410, avgSecPerMi: 405 },
      { phaseType: 'work' as const, targetSecPerMi: 410, avgSecPerMi: 430 },
    ];
    const g = gradeSession(bad, 'threshold');
    expect(g.verdict).not.toBe('executed');
    expect(g.lateCollapse).toBe(true);
  });

  it('a genuinely slow rep still grades slow', async () => {
    const { gradePhase } = await import('./execution-semantics');
    expect(gradePhase(
      { phaseType: 'work', targetSecPerMi: 430, avgSecPerMi: 470 }, 'threshold',
    )).toBe('slow');
  });

  it('an easy run sprinted well under its ceiling still grades fast', async () => {
    // The one thing a ceiling CAN fail, and the finding that actually matters
    // on an easy day.
    const { gradePhase } = await import('./execution-semantics');
    expect(gradePhase(
      { phaseType: 'work', targetSecPerMi: 502, avgSecPerMi: 440 }, 'easy',
    )).toBe('fast');
  });
});

/* ═════════════════ the phone/wrist classification fork ═══════════════════ */

describe('EXECSEM-4 · one classification, both surfaces', () => {
  it('a tempo row is the same class and the same width on both surfaces', async () => {
    // F-1: 21 live plan rows where `plan_workouts.type = 'tempo'` and
    // `workout_spec.kind = 'threshold'`. The wrist read the spec and graded at
    // 8; the phone read `strictPrescriptionType` and printed 20.
    const { classifySession, sessionToleranceSec } = await import('./execution-semantics');
    expect(classifySession('tempo', { kind: 'threshold' })).toBe('threshold');
    expect(classifySession('tempo', { kind: 'tempo' })).toBe('threshold');
    expect(classifySession('tempo', null)).toBe('threshold');
    expect(sessionToleranceSec(classifySession('tempo', { kind: 'threshold' }))).toBe(8);
    expect(sessionToleranceSec(classifySession('tempo', null))).toBe(8);
  });

  it('a race-week tune-up is a threshold session', async () => {
    const { classifySession } = await import('./execution-semantics');
    expect(classifySession('race_week_tuneup', { kind: 'threshold' })).toBe('threshold');
    expect(classifySession('race_week_tuneup', null)).toBe('threshold');
  });
});
