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
 *   · It reads the watch sources at `legacy/native/…`, which is where they
 *     live; `native-v2/Faff/FaffWatch Watch App` is a tracked SYMLINK to that
 *     directory, not a second copy (see SECOND-OWNER-10 below). EXECSEM-5d
 *     asserts the link, because the day it becomes a real directory this whole
 *     file starts grading a tree that does not ship — and would stay green.
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
  type PhaseVerdict,
  type SessionClass,
} from './execution-semantics';
// CEIL-SLACK-1 · the SERVER'S real entry point, not a local reimplementation.
// A gate that reimplements the thing it is checking proves only that the gate
// agrees with itself.
import { gradeStoredPhases } from '@/lib/execution/verdict';
import { expandSpecToPhases } from './expand-spec';

const ROOT = path.resolve(__dirname, '..', '..', '..');

/* ── SECOND-OWNER-10 (2026-09-02) · THE "WRONG COPY" FINDING WAS NOT REAL ───
 *
 * An ownership audit reported that this gate binds to
 * `legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift` while the
 * shipping target is `native-v2/`, that the two were byte-identical, and that
 * the gate was therefore "one edit away from proving nothing". Its evidence
 * was `diff -q` between the two paths returning 0.
 *
 * THERE IS ONLY ONE FILE. `native-v2/Faff/FaffWatch Watch App` is a TRACKED
 * GIT SYMLINK (mode 120000, blob `../../legacy/native/Faff/FaffWatch Watch
 * App`) — `native-v2/project.yml` says so at the watch target: "sources live
 * in legacy/ for now, symlinked in by scripts/ship-testflight-v2.sh". The
 * `diff -q` compared a symlink with its own target, which cannot differ, and
 * the "two byte-identical 159,455-byte copies" were one file counted twice.
 *
 * So the paths below are UNCHANGED and deliberately so: `legacy/native/...` is
 * the canonical, tracked, only copy of the watch grading engine, and pointing
 * this gate at the symlink instead would make it depend on a link resolving
 * rather than on a file existing — strictly more fragile, for no gain.
 *
 * What WAS missing is the assertion that keeps that true. If anyone ever
 * replaces the symlink with a real directory, the second copy the audit feared
 * comes into existence for real and this gate silently starts grading the one
 * that does not ship. EXECSEM-5d below asserts the link, so that day fails
 * loudly instead.
 */
const ENGINE = path.join(ROOT, 'legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift');
const MODELS = path.join(ROOT, 'legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift');
/** The path the shipping Xcode project compiles. A symlink, not a copy. */
const SHIPPED_WATCH_DIR = path.join(ROOT, 'native-v2/Faff/FaffWatch Watch App');
const SHIPPED_WIDGETS_DIR = path.join(ROOT, 'native-v2/Faff/FaffWatch Widgets');

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

/* ═══ SECOND-OWNER-10 · the file this gate grades IS the file that ships ═══ */

describe('EXECSEM-5d · one grading engine, one physical copy', () => {
  /**
   * WHY THIS EXISTS
   *
   * Everything above reads `legacy/native/Faff/FaffWatch Watch App/`. The
   * Xcode target that produces the watch binary lists its sources as
   * `Faff/FaffWatch Watch App` under `native-v2/`. Those are the same bytes
   * ONLY because the second path is a symlink to the first — a tracked one
   * (git mode 120000), so it exists in a fresh clone and in CI, not just where
   * `ship-testflight-v2.sh` has run.
   *
   * That is a load-bearing fact nothing checked. Replace the symlink with a
   * real directory — a `cp -R` during a merge is enough — and there are
   * suddenly two copies of the grading engine, this suite grades the one that
   * does not ship, and it stays green while the wrist diverges. That is the
   * defect an ownership audit reported as already present; it was not, because
   * of the link, and this is the assertion that keeps it not-present.
   *
   * WHAT THIS CANNOT FAIL ON (Rule 22, stated not implied):
   *   · It checks the LINK, not the build. It cannot tell whether xcodegen
   *     actually compiled these sources, or whether the archive that reached
   *     TestFlight contains them.
   *   · It cannot fail on a checkout where git materialised the symlink as a
   *     text file (`core.symlinks=false`, some Windows clones). It reports
   *     that case as a failure with the reason, which is the honest outcome,
   *     but the underlying tree is not actually broken there.
   *   · It says nothing about the WIDGETS sources beyond the same link check —
   *     no parity port exists for those.
   */
  it('the shipping watch source path is a SYMLINK into the graded tree', () => {
    for (const [linkPath, wantTarget] of [
      [SHIPPED_WATCH_DIR, '../../legacy/native/Faff/FaffWatch Watch App'],
      [SHIPPED_WIDGETS_DIR, '../../legacy/native/Faff/FaffWatch Widgets'],
    ] as const) {
      const rel = path.relative(ROOT, linkPath);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(linkPath);
      } catch {
        throw new Error(
          `${rel} does not exist. The shipping Xcode target lists it as its source path ` +
            '(native-v2/project.yml, target "FaffWatch Watch App"), so the watch cannot build ' +
            'without it and this suite would be grading a tree nothing compiles.',
        );
      }
      expect(
        st.isSymbolicLink(),
        `${rel} is no longer a symlink. It is now a SECOND PHYSICAL COPY of the watch ` +
          'sources, and everything above this line grades ' +
          `${path.relative(ROOT, ENGINE)} — the other one. Restore the link ` +
          `(\`ln -s "${wantTarget}" "${rel}"\`) or re-point this whole file at whichever copy ` +
          'actually ships. Two copies of the grading engine is a Rule 16 violation either way.',
      ).toBe(true);
      // RELATIVE, and pointing where this suite reads. An ABSOLUTE link
      // resolves to whichever checkout minted it, which is the bug
      // `ship-testflight-v2.sh`'s own comment records having been bitten by
      // from a git worktree.
      const target = fs.readlinkSync(linkPath);
      expect(
        target,
        `${rel} points at "${target}". It must be the relative path into the tree this suite ` +
          'grades; an absolute link compiles some other checkout\'s watch sources.',
      ).toBe(wantTarget);
    }
  });

  it('the link resolves to the exact file the port is checked against', () => {
    // Assert the RESULT, not the absence of a defect (Rule 13 point 3): read
    // the engine through the shipping path and require it to be byte-identical
    // to what EXECSEM-5b read. This is the only assertion here that would also
    // catch a link that is well-formed but points somewhere else entirely.
    const throughShippingPath = path.join(SHIPPED_WATCH_DIR, 'WorkoutEngine.swift');
    const shipped = fs.readFileSync(throughShippingPath);
    const graded = fs.readFileSync(ENGINE);
    expect(shipped.length).toBeGreaterThan(50_000);
    expect(
      shipped.equals(graded),
      `the watch source reached through the shipping path (${path.relative(ROOT, throughShippingPath)}) ` +
        `is not the file this suite grades (${path.relative(ROOT, ENGINE)}). ` +
        `${shipped.length} bytes vs ${graded.length}.`,
    ).toBe(true);
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

  /* CEIL-SLACK-1 (2026-09-02) · AND THEY USE THE PHASE'S OWN SLACK WHEN IT HAS
   * ONE, which the assertion above could not see.
   *
   * The wrist reads `p.tolerancePaceSPerMi ?? 30`; the server read nothing and
   * always took the 30. The two therefore agreed only where the phase's own
   * tolerance WAS 30 — warm-up and cool-down — and disagreed on every easy day
   * (tolerance 20) and every long run (18). A gate that asserts two fallbacks
   * match is structurally incapable of failing on the data (Rule 22), and this
   * one had been green over a ten-second-a-mile divergence since the day it
   * was written.
   *
   * These are the owner's real authored tolerances, off `pln_9a57561debb776e5`
   * as of 2026-09-02. */
  const CEILING_CASES: Array<{ what: string; target: number; tol: number; avg: number; expect: PhaseVerdict }> = [
    // easy 2026-09-04 · band 502-542, centre 522, half-width 20.
    { what: 'easy 8:15/mi against a 502 fast edge', target: 522, tol: 20, avg: 495, expect: 'fast' },
    { what: 'easy 8:25/mi, inside the band', target: 522, tol: 20, avg: 505, expect: 'hit' },
    // long 2026-09-06 · band 502-537, centre 520, half-width 18.
    { what: 'long 8:10/mi against a 502 fast edge', target: 520, tol: 18, avg: 490, expect: 'fast' },
    { what: 'long 8:40/mi, slower than the ceiling, which is not a miss', target: 520, tol: 18, avg: 520, expect: 'hit' },
    // warm-up · the case that already agreed, kept so a fix cannot break it.
    { what: 'warm-up 8:36/mi under a 502 ceiling', target: 502, tol: 30, avg: 516, expect: 'hit' },
    { what: 'warm-up 7:40/mi, well through the ceiling', target: 502, tol: 30, avg: 460, expect: 'fast' },
  ];

  it('the server grades a ceiling at the phase s own slack, exactly as the wrist does', () => {
    for (const c of CEILING_CASES) {
      const phases = [{
        index: 0, type: 'work', label: c.what, completed: true,
        targetPaceSPerMi: c.target, tolerancePaceSPerMi: c.tol,
        actualPaceSPerMi: c.avg, actualDistanceMi: 5, actualDurationSec: Math.round(5 * c.avg),
        paceShape: 'ceiling',
      }];
      const graded = gradeStoredPhases(phases, 'easy');
      expect(graded.phases[0].verdict, c.what).toBe(c.expect);
      // And the wrist's own rule, run over the same numbers.
      const wrist = c.avg < c.target - c.tol ? 'fast' : 'hit';
      expect(graded.phases[0].verdict, `${c.what} · wrist said ${wrist}`).toBe(wrist);
    }
  });

  it('LIVENESS · these cases actually reached the ceiling arm', () => {
    // A ceiling case that silently graded as a window would satisfy the
    // assertions above on four of the six rows by coincidence.
    const phases = CEILING_CASES.map((c, i) => ({
      index: i, type: 'work', completed: true,
      targetPaceSPerMi: c.target, tolerancePaceSPerMi: c.tol,
      actualPaceSPerMi: c.avg, actualDistanceMi: 5, actualDurationSec: Math.round(5 * c.avg),
      paceShape: 'ceiling',
    }));
    const graded = gradeStoredPhases(phases, 'easy');
    expect(graded.phases).toHaveLength(CEILING_CASES.length);
    for (const p of graded.phases) expect(p.shape).toBe('ceiling');
    // A ceiling has no slow edge, ever.
    expect(graded.phases.some((p) => p.verdict === 'slow')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * CEIL-MEANING-1 (2026-09-02) · `targetPaceSPerMi` MEANS TWO THINGS, AND THE
 * TWO CURRENTLY AGREE BY COINCIDENCE.
 *
 * Under one `paceShape: 'ceiling'` the field carries:
 *
 *   WARM-UP / COOL-DOWN   the ceiling ITSELF (`WU/CD-CEIL-1`, 2026-09-01),
 *                         paired with doctrine's E width, 30.
 *   EASY / LONG WORK      the band CENTRE, paired with the band's own
 *                         half-width — `expandEasy`/`expandLong` encode a band
 *                         as centre plus half-width so `target +/- tolerance`
 *                         reconstructs the authored band exactly, which is what
 *                         `_watch_anchor_split.test.ts` asserts from the other
 *                         side.
 *
 * Every reader — `PaceDrift.swift`, `WorkoutEngine.swift`, and now
 * `gradeStoredPhases` — computes the effective ceiling as `target - tolerance`,
 * so both encodings land on the same number today. That is one quantity under
 * one name meaning two things, held together by a coincidence, and it is the
 * shape that bites the day somebody changes a tolerance for an unrelated
 * reason. This does not unify the field: it PINS the coincidence, on the
 * owner's real authored specs, so the build says so the moment it stops
 * holding.
 *
 * ── WHAT IT CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *   · It cannot tell you either encoding is RIGHT. It asserts they agree.
 *   · It reads specs captured from production on 2026-09-02, not live rows, so
 *     a future authoring change is invisible until someone recaptures them.
 *   · It says nothing about phases with no target, which are correctly not
 *     graded at all.
 * ════════════════════════════════════════════════════════════════════════ */
describe('CEIL-MEANING-1 · the two ceiling encodings still land on one number', () => {
  /* THE REAL EXPANDER, NOT ARITHMETIC WRITTEN HERE.
   *
   * The first draft of this pin recomputed `mid` and `halfWidth` locally and
   * asserted `mid - halfWidth === lo`. That is true of every symmetric band by
   * construction — it passed a deliberate falsification (widening a band by 4
   * s/mi) without blinking, because it was a tautology wearing a test's
   * clothes. Rule 18: a check that hardcodes both sides only proves the test
   * agrees with itself.
   *
   * So it runs `expandSpecToPhases` over the owner's real authored specs and
   * asserts what comes OUT. It fails if `bandToleranceSec` stops returning the
   * band's own half-width, if the centre is computed differently, or if either
   * rounding changes — which is exactly the class of unrelated edit that would
   * quietly separate the two encodings. */
  const REAL_SPECS: Array<{ day: string; spec: Record<string, unknown>; mi: number; ceiling: number }> = [
    // Read at `faff_readonly` off `pln_9a57561debb776e5`, 2026-09-02.
    { day: '2026-09-02 easy', mi: 5, ceiling: 502,
      spec: { kind: 'easy', pace_target_s_per_mi_lo: 502, pace_target_s_per_mi_hi: 542 } },
    { day: '2026-09-04 easy', mi: 5.5, ceiling: 502,
      spec: { kind: 'easy', pace_target_s_per_mi_lo: 502, pace_target_s_per_mi_hi: 542 } },
    { day: '2026-09-06 long', mi: 15, ceiling: 502,
      spec: { kind: 'long', pace_target_s_per_mi_lo: 502, pace_target_s_per_mi_hi: 537 } },
    // An ODD-width band, where the symmetric wire cannot carry the half-width
    // exactly. `bandToleranceSec` errs WIDE by one second on purpose; if that
    // ever errs tight instead, the reconstructed ceiling moves and this says so.
    { day: 'odd-width long 517-552', mi: 13, ceiling: 517,
      spec: { kind: 'long', pace_target_s_per_mi_lo: 517, pace_target_s_per_mi_hi: 552 } },
  ];

  it('the band-centre encoding reconstructs the authored ceiling through the real expander', () => {
    for (const r of REAL_SPECS) {
      const phases = expandSpecToPhases({ spec: r.spec as never, totalMi: r.mi, easyPaceSec: 522, toleranceSec: 20 });
      const work = (phases ?? []).find((p) => p.type === 'work');
      expect(work, r.day).toBeTruthy();
      const target = work!.targetPaceSPerMi!;
      const tol = work!.tolerancePaceSPerMi!;
      // The one subtraction every reader performs: PaceDrift.swift's off-target
      // edge, WorkoutEngine.swift's `target - slack`, and gradeCeilingPhase's.
      expect(target - tol, `${r.day} · effective ceiling`).toBe(r.ceiling);
    }
  });

  it('the ceiling-itself encoding carries the SAME number, from the same specs', () => {
    for (const r of REAL_SPECS) {
      // A threshold day's warm-up on the same easy ceiling. `WU/CD-CEIL-1`
      // puts the ceiling in `targetPaceSPerMi` directly, so the field means
      // something different here than it does above — and both must name the
      // same ceiling, which is the coincidence being pinned.
      const phases = expandSpecToPhases({
        spec: { kind: 'threshold', warmup_mi: 2, cooldown_mi: 2, rep_count: 2, rep_distance_mi: 1, rep_pace_s_per_mi: 430 } as never,
        totalMi: 6, easyPaceSec: 522, easyCeilingSec: r.ceiling, toleranceSec: 8,
      });
      const wu = (phases ?? []).find((p) => p.type === 'warmup');
      expect(wu, r.day).toBeTruthy();
      expect(wu!.targetPaceSPerMi, `${r.day} · warm-up states the ceiling directly`).toBe(r.ceiling);
    }
  });

  it('and the server grades both encodings through that same subtraction', () => {
    for (const r of REAL_SPECS) {
      const phases = expandSpecToPhases({ spec: r.spec as never, totalMi: r.mi, easyPaceSec: 522, toleranceSec: 20 });
      const work = (phases ?? []).find((p) => p.type === 'work')!;
      const target = work.targetPaceSPerMi!;
      const tol = work.tolerancePaceSPerMi!;
      const cases: Array<[number, PhaseVerdict]> = [
        [r.ceiling + 5, 'hit'],   // slower than the ceiling is never a miss
        [r.ceiling - 5, 'fast'],  // through it, past the slack
      ];
      for (const [avg, want] of cases) {
        const asBand = gradeStoredPhases([{
          index: 0, type: 'work', completed: true, paceShape: 'ceiling',
          targetPaceSPerMi: target, tolerancePaceSPerMi: tol,
          actualPaceSPerMi: avg, actualDistanceMi: 5, actualDurationSec: 5 * avg,
        }], 'easy').phases[0].verdict;
        expect(asBand, `${r.day} · band encoding at ${avg}`).toBe(want);
      }
    }
  });

  it('LIVENESS · the expander actually produced a graded ceiling phase', () => {
    // A spec that expanded to nothing, or to a phase with no target, would
    // satisfy nothing above and report clean.
    let seen = 0;
    for (const r of REAL_SPECS) {
      const phases = expandSpecToPhases({ spec: r.spec as never, totalMi: r.mi, easyPaceSec: 522, toleranceSec: 20 });
      const work = (phases ?? []).find((p) => p.type === 'work');
      if (work?.targetPaceSPerMi != null && work.tolerancePaceSPerMi != null) seen += 1;
    }
    expect(seen).toBe(REAL_SPECS.length);
  });
});
