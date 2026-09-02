/**
 * EXECSEM-5 · the wrist and the server grade the same run the same way.
 *
 * `_execution_semantics_owner.test.ts` can scan TypeScript and nothing else,
 * and it says so in its own Rule 22 section: "The Swift side. `WorkoutEngine
 * .swift` grades on the wrist and no TypeScript scanner can see it." This file
 * is that seam.
 *
 * It does two things:
 *
 *   1 · PORTS the wrist's verdict rule — the block in
 *       `WorkoutEngine.recordCurrentPhase` — into TypeScript, line for line,
 *       and asserts the port and `gradePhase` agree on a matrix of phases
 *       including the owner's real 2026-09-01 session. Two implementations of
 *       one rule is a Rule 16 violation by construction, so the port is a
 *       TEST FIXTURE and is named one; nothing in `lib/` imports it.
 *   2 · READS `WorkoutEngine.swift` and asserts the shape the port copies is
 *       still the shape that is there — the average, the ceiling arm, the
 *       recovery abstention, and the absence of the sample-share verdict.
 *       Without (2) the port is a hypothesis: the Swift could be reverted and
 *       this file would stay green forever, which is exactly the failure Rule
 *       18 point 2 is about.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · It does not run Swift. The port agreeing with `gradePhase` proves the
 *     two RULES match, not that the compiled watch executes the port. The
 *     source assertions in EXECSEM-5b are the only thing binding it to the
 *     real file, and they are text matches.
 *   · It says nothing about the LIVE colour on the wrist (`PaceDrift`), only
 *     about the recorded per-phase verdict.
 *   · It cannot see a payload the server never sends. If `build-workout.ts`
 *     stopped shipping `paceShape`, the wrist would fall back to
 *     `WatchPaceShape.legacyDefault` — which this file also ports, precisely
 *     because that fallback is what every already-deployed watch will use.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  gradePhase,
  paceShapeFor,
  phaseToleranceSec,
  EASY_PHASE_TOLERANCE_S_PER_MI,
  type PaceShape,
  type PhaseType,
  type SessionClass,
} from './execution-semantics';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ENGINE = path.join(ROOT, 'legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift');
const MODELS = path.join(ROOT, 'legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift');

/* ════════════ the port · WorkoutEngine.swift, transcribed ════════════════ */

/** `WatchPaceShape.legacyDefault(for:hasTarget:)`, transcribed. */
function swiftLegacyDefaultShape(type: PhaseType, hasTarget: boolean): PaceShape {
  if (!hasTarget) return 'none';
  switch (type) {
    case 'recovery': return 'none';
    case 'warmup':
    case 'cooldown': return 'ceiling';
    default: return 'window';
  }
}

/** The `verdict` closure in `WorkoutEngine.recordCurrentPhase`, transcribed. */
function swiftVerdict(p: {
  paceShape: PaceShape;
  targetPaceSPerMi: number | null;
  tolerancePaceSPerMi: number | null;
  avgPace: number | null;
  completed: boolean;
}): string | null {
  const isPaceGraded = p.paceShape === 'window' || p.paceShape === 'ceiling';
  if (!isPaceGraded || p.targetPaceSPerMi == null || p.avgPace == null) return null;
  if (!p.completed) return 'incomplete';

  if (p.paceShape === 'ceiling') {
    const slack = p.tolerancePaceSPerMi ?? 30;
    return p.avgPace < p.targetPaceSPerMi - slack ? 'fast' : 'hit';
  }

  const tol = p.tolerancePaceSPerMi ?? 10;
  if (p.avgPace < p.targetPaceSPerMi - tol) return 'fast';
  if (p.avgPace > p.targetPaceSPerMi + tol) return 'slow';
  return 'hit';
}

/** The server's verdict, in the wrist's vocabulary (`not_graded` → null). */
function serverVerdict(
  phaseType: PhaseType,
  kind: SessionClass,
  targetSecPerMi: number | null,
  avgSecPerMi: number | null,
  completed = true,
): string | null {
  const v = gradePhase(
    {
      phaseType,
      targetSecPerMi,
      avgSecPerMi,
      toleranceSec: phaseToleranceSec(phaseType, kind, {
        hasTarget: targetSecPerMi != null && targetSecPerMi > 0,
      }),
      completed,
    },
    kind,
  );
  return v === 'not_graded' ? null : v;
}

/* ═════════════════════════ the real session ══════════════════════════════ */

/** `runs` id -258355938987883 · 2026-09-01, `4×1 mi @ T pace · 1 min jog`. */
const SESSION_2026_09_01: Array<{
  phaseType: PhaseType; target: number | null; actual: number; label: string;
}> = [
  { phaseType: 'warmup',   target: 502,  actual: 516,  label: 'Warm-up 2.10 mi' },
  { phaseType: 'work',     target: 430,  actual: 422,  label: 'Interval 1' },
  { phaseType: 'recovery', target: null, actual: 515,  label: 'Jog 1 min · 61 s' },
  { phaseType: 'work',     target: 430,  actual: 429,  label: 'Interval 2' },
  { phaseType: 'recovery', target: null, actual: 785,  label: 'Jog 1 min · 64 s' },
  { phaseType: 'work',     target: 430,  actual: 422,  label: 'Interval 3' },
  { phaseType: 'recovery', target: null, actual: 1034, label: 'Jog 1 min · 64 s' },
  { phaseType: 'work',     target: 430,  actual: 419,  label: 'Interval 4' },
  { phaseType: 'cooldown', target: 502,  actual: 534,  label: 'Cool-down 2.11 mi' },
];

describe('EXECSEM-5 · the wrist port and the server agree', () => {
  it('on the owner s real 2026-09-01 session, phase for phase', () => {
    const kind: SessionClass = 'threshold';
    const rows = SESSION_2026_09_01.map((p) => {
      const hasTarget = p.target != null && p.target > 0;
      const shape = paceShapeFor(p.phaseType, kind, { hasTarget });
      const tol = phaseToleranceSec(p.phaseType, kind, { hasTarget });
      return {
        label: p.label,
        wrist: swiftVerdict({
          paceShape: shape,
          targetPaceSPerMi: p.target,
          tolerancePaceSPerMi: tol,
          avgPace: p.actual,
          completed: true,
        }),
        server: serverVerdict(p.phaseType, kind, p.target, p.actual),
      };
    });
    for (const r of rows) expect(r.wrist, r.label).toBe(r.server);

    // And the answers themselves. Before 2026-09-01 this row read
    // drifted / drifted / drifted / missed, with the cool-down missed too.
    expect(rows.map((r) => r.wrist)).toEqual([
      'hit',   // warm-up 516 vs a 502 ceiling · slower than a ceiling is fine
      'hit',   // 422
      null,    // jog · no prescribed pace, never graded
      'hit',   // 429
      null,
      'hit',   // 422
      null,
      'fast',  // 419 · three seconds quicker than the fast edge, and SAID so
      'hit',   // cool-down 534 vs a 502 ceiling · a correct cool-down
    ]);
    expect(rows.map((r) => r.wrist)).not.toContain('slow');
    expect(rows.map((r) => r.wrist)).not.toContain('missed');
    expect(rows.map((r) => r.wrist)).not.toContain('drifted');
  });

  it('across a matrix of shapes, sessions and paces', () => {
    const kinds: SessionClass[] = ['threshold', 'interval', 'race', 'easy', 'long', 'other'];
    const types: PhaseType[] = ['warmup', 'work', 'recovery', 'cooldown'];
    const targets: Array<number | null> = [null, 430, 502];
    const actuals = [380, 400, 419, 422, 430, 438, 445, 470, 502, 516, 534, 600];
    let compared = 0;
    for (const kind of kinds) {
      for (const type of types) {
        for (const target of targets) {
          for (const actual of actuals) {
            for (const completed of [true, false]) {
              const hasTarget = target != null && target > 0;
              const shape = paceShapeFor(type, kind, { hasTarget });
              const tol = phaseToleranceSec(type, kind, { hasTarget });
              const wrist = swiftVerdict({
                paceShape: shape,
                targetPaceSPerMi: target,
                tolerancePaceSPerMi: tol,
                avgPace: actual,
                completed,
              });
              const server = serverVerdict(type, kind, target, actual, completed);
              expect(wrist, `${kind}/${type}/${target}/${actual}/${completed}`).toBe(server);
              compared += 1;
            }
          }
        }
      }
    }
    // LIVENESS (Rule 18) · a matrix that compared nothing would pass silently.
    expect(compared).toBeGreaterThan(1500);
  });

  it('a deployed watch with no paceShape on the wire still gets it right', () => {
    // Every watch in the field today decodes a payload that has no
    // `paceShape` key, so `WatchPaceShape.legacyDefault` is what actually
    // runs. It must agree with the server on the two shapes that were
    // unambiguously wrong before: a recovery and a warm-up/cool-down.
    for (const kind of ['threshold', 'interval', 'race'] as SessionClass[]) {
      for (const type of ['warmup', 'work', 'recovery', 'cooldown'] as PhaseType[]) {
        for (const hasTarget of [true, false]) {
          expect(
            swiftLegacyDefaultShape(type, hasTarget),
            `${kind}/${type}/hasTarget=${hasTarget}`,
          ).toBe(paceShapeFor(type, kind, { hasTarget }));
        }
      }
    }
  });
});

/* ═══════ the port is bound to the real file, not to a memory of it ═══════ */

describe('EXECSEM-5b · the Swift still has the shape this file ports', () => {
  it('reads the real WorkoutEngine.swift', () => {
    // LIVENESS · a source assertion over a file that does not exist would
    // otherwise throw a confusing error rather than a clear one.
    expect(fs.existsSync(ENGINE), `${ENGINE} is gone — did the watch source move?`).toBe(true);
    expect(fs.statSync(ENGINE).size).toBeGreaterThan(50_000);
  });

  it('grades a phase only when its shape says it is pace-graded', () => {
    const src = fs.readFileSync(ENGINE, 'utf8');
    expect(src).toMatch(/guard p\.paceShape\.isPaceGraded/);
  });

  it('a ceiling phase has no slow edge', () => {
    const src = fs.readFileSync(ENGINE, 'utf8');
    expect(src).toMatch(/if p\.paceShape == \.ceiling \{/);
    // The ceiling arm returns exactly two words, and neither is a miss for
    // being slow.
    const arm = src.slice(src.indexOf('if p.paceShape == .ceiling {'));
    const body = arm.slice(0, arm.indexOf('\n            }'));
    expect(body).toMatch(/return avgPace < target - slack \? "fast" : "hit"/);
  });

  it('the sample-share verdict is gone', () => {
    const src = fs.readFileSync(ENGINE, 'utf8');
    // The exact expression that produced drifted / drifted / drifted / missed
    // on a near-flawless session. It must not come back.
    expect(src).not.toMatch(/pctInBand >= 0\.7/);
    expect(src).not.toMatch(/return "drifted"/);
    expect(src).not.toMatch(/avgInBand/);
  });

  it('the tolerance counters still ship, because raggedness is still real', () => {
    // Rule 11 · the sample share stopped being a VERDICT. It did not stop
    // being a measurement, and `winTimeInTolerance` renders it.
    const src = fs.readFileSync(ENGINE, 'utf8');
    expect(src).toMatch(/timeInToleranceSec/);
    expect(src).toMatch(/timeOutOfToleranceSec/);
  });

  it('the model carries paceShape both ways on the wire', () => {
    const src = fs.readFileSync(MODELS, 'utf8');
    expect(src).toMatch(/enum WatchPaceShape: String, Codable/);
    // Decoded leniently, encoded too — RESTAMP-2: `persistSnapshot` round
    // trips the workout through JSON, so a field dropped on the way OUT is a
    // field a crash-resumed run does not have.
    expect(src).toMatch(/decodeIfPresent\(WatchPaceShape\.self, forKey: \.paceShape\)/);
    expect(src).toMatch(/try c\.encode\(paceShape, forKey: \.paceShape\)/);
    expect(src).toMatch(/case type, label, durationSec, targetPaceSPerMi, tolerancePaceSPerMi, paceShape,/);
  });

  it('the bail evaluates its own metric', () => {
    // C-1 · the board fired on `milesAdrift >= 2` and printed HR-worded
    // evidence over it. Rule 16: gate the sentence on the measurement.
    const src = fs.readFileSync(ENGINE, 'utf8');
    expect(src).toMatch(/if rule\.metric == "hr" \{/);
    expect(src).toMatch(/func noteRuleMetric\(hrBpm: Int, tickSec: Int\)/);
    expect(src).toMatch(/noteRuleMetric\(hrBpm: tracker\?\.heartRate \?\? 0/);
  });

  it('a race abort draws a board', () => {
    // Rule 21 · authored, persisted, shipped, decoded and inert, on a SAFETY
    // stop, is the worst place for this codebase's signature failure.
    const src = fs.readFileSync(ENGINE, 'utf8');
    expect(src).toMatch(/\?\? workout\.rules\?\.first\(where: \{ \$0\.isAbort \}\)/);
    const models = fs.readFileSync(MODELS, 'utf8');
    expect(models).toMatch(/var isAbort: Bool \{ kind == "abort" \}/);
    // And the stale comment that described the defect as the design is gone.
    expect(models).not.toMatch(/Only `bail` draws a board\.\n/);
  });

  it('a ceiling phase does not buzz the runner for going slow', () => {
    const drift = fs.readFileSync(
      path.join(ROOT, 'legacy/native/Faff/FaffWatch Watch App/PaceDrift.swift'), 'utf8',
    );
    expect(drift).toMatch(/paceShape == \.ceiling && delta > 0/);
  });
});

/* ══════════════════ the doctrine width, once, on both sides ══════════════ */

describe('EXECSEM-5c · the ceiling slack is doctrine s E width on both sides', () => {
  it('server and wrist fall back to the same number', () => {
    const src = fs.readFileSync(ENGINE, 'utf8');
    // The wrist's fallback when the wire carries no tolerance.
    expect(src).toMatch(/let slack = p\.tolerancePaceSPerMi \?\? 30/);
    expect(EASY_PHASE_TOLERANCE_S_PER_MI).toBe(30);
  });
});
