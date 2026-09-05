/**
 * lib/training/_threshold_owner_scan.test.ts · THRESHOLD-OWNER-1 ·
 * ONE THRESHOLD PACE, ONE OWNER.
 *
 * `docs/BRAIN_CONSTITUTION.md` §5 names the function by name:
 *
 *     "Never `thresholdFromRace()` / `thresholdFromWorkout()` /
 *      `thresholdFromVDOT()` / `thresholdForPlan()` /
 *      `thresholdForPrediction()` all independently returning different
 *      truths. Those may exist internally *as evidence methods*. The
 *      application-level answer comes from `resolveThresholdCapacity()`,
 *      once."
 *
 * It was not once. Measured live on the owner's account, 2026-09-05:
 *
 *     capacity-resolver.resolveThresholdCapacity     430 s/mi   7:10/mi
 *     load-prescription-anchors (Pace Prescription)  430 s/mi   7:10/mi
 *     vdot.resolveCurrentTPace  (legacy cascade)     431 s/mi   7:11/mi
 *     spec-builder.tPaceFromGoal (the GOAL)          394 s/mi   6:34/mi
 *     tPaceFromVdot(anchorVdotFromState 46.6)        440 s/mi   7:20/mi
 *
 * Forty-six seconds per mile between the widest pair, all of them labelled
 * "threshold", all of them live at once. `tPaceFromGoal` is the worst of them
 * and not merely a duplicate: it is a stated GOAL reaching a training pace,
 * which Constitution §4 lists as a forbidden side door and
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §6 requires be made
 * structurally impossible rather than conventionally avoided. It is deleted.
 *
 * THIS FILE IS THE PART THAT OUTLIVES THE FIX. A behavioural test cannot catch
 * a NEW second owner appearing next year; only a scan can.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ─────────────────────────────────
 *
 *   · IT IS A TEXT SCAN OVER NAMED SYMBOLS. A threshold re-derived from
 *     arithmetic that never mentions `tPaceFromVdot` — `vdot * -3.2 + 620`, a
 *     copied Daniels row, a pace read out of a cached column — is invisible to
 *     it. The structural defences are elsewhere and stay elsewhere:
 *     `capacity-resolver.ts` section 0 makes a goal argument on any capacity
 *     resolver a COMPILE error, and `check-goal-pace-leak.sh` scans the same
 *     trees for the goal half.
 *   · IT CANNOT JUDGE WHETHER A NUMBER IS RIGHT. Every owner below could
 *     return the same wrong pace and this file would report clean. It asks
 *     "how many places answer this question", never "is the answer good".
 *   · IT CANNOT SEE ACROSS THE WIRE. `native-v2` is Swift. A threshold
 *     recomputed on the phone or the watch from a VDOT the API happens to send
 *     is out of reach by construction, and Constitution §22 (a surface
 *     CONSUMES the prescription) is the only thing holding there.
 *   · IT CANNOT TELL AN EVIDENCE METHOD FROM AN AUTHORITY BY READING THE CALL.
 *     §6 permits many systems to DERIVE threshold evidence and one to resolve
 *     it, and both look like `tPaceFromVdot(x)`. That distinction is carried by
 *     the argued reason on each allowlist entry, which is a human claim this
 *     file records and cannot verify.
 *   · IT IS BIASED TOWARD WHAT ALREADY EXISTS. Every entry below was written
 *     by reading today's tree; a producer shaped unlike any of these five
 *     symbols would not have suggested itself.
 *
 * KNOWN FALSE POSITIVE, AND THE REASON IT IS NOT FIXED. Comments are stripped
 * before matching, STRING LITERALS ARE NOT — so prose that names a producer
 * inside a quoted string reads as a call. It caught its own author within the
 * hour (a `why` field in `shadow-evidence-epoch.ts` that mentioned the forward
 * curve by name). Stripping strings would fix it and would also blind the scan
 * to `lib/runner-state/ownership.ts`, which is ENTIRELY strings and is on the
 * allowlist for exactly that reason — a stale entry there would then fail the
 * ratchet forever. Name a producer in a `//` comment, or allowlist the file.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fixtureTPaceFromGoalPace } from '@/lib/plan/_fixture-goal-tpace';
import { tPaceFromAnchorPace } from '@/lib/training/vdot';

const WEB = path.resolve(__dirname, '..', '..');

/* ══════════════════════════════════════════════════════════════════════════
 * THE SCAN
 * ═══════════════════════════════════════════════════════════════════════ */

/** Every symbol in this repo that PRODUCES a threshold pace. Deliberately
 *  named rather than pattern-guessed: each one is a real function this app has
 *  shipped, and `tPaceFromGoal` is kept in the list AFTER its deletion so a
 *  reintroduction is caught by name (the shape `weeklyVolWoWMaxPct` uses). */
const PRODUCERS = [
  'tPaceFromVdot',
  'tPaceFromAnchorPace',
  'resolveCurrentTPace',
  'tPaceFromGoal',
  'fixtureTPaceFromGoalPace',
] as const;
const PRODUCER_RE = new RegExp(`\\b(${PRODUCERS.join('|')})\\b`);

/** The trees that have ever priced a threshold. `components/` is excluded for
 *  the same reason `check-goal-pace-leak.sh` excludes it — the web frontend is
 *  paused per CLAUDE.md and nothing there persists a pace. */
const TREES = ['lib', 'app'];

/** A liveness floor, not a target (Rule 18 point 2). Low enough never to fail
 *  on an honest deletion, high enough to notice a tree dropping out: the two
 *  trees held 709 non-test files when this was written, and `lib` alone holds
 *  well over 400. */
const LIVENESS_FLOOR = 400;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('._') || e.name === 'node_modules' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); continue; }
    if (!/\.tsx?$/.test(e.name)) continue;
    if (/\.test\.tsx?$/.test(e.name)) continue;
    out.push(p);
  }
  return out;
}

/** Comments are stripped before matching. A file that DOCUMENTS the deletion —
 *  and several now do, at length — must not be reported as performing it. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

function producerHits(src: string): number {
  return stripComments(src).split('\n').filter((l) => PRODUCER_RE.test(l)).length;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE ALLOWLIST · a ratchet. It may shrink. It may not grow without an
 * argument that survives review, and an entry whose file no longer matches
 * FAILS until it is deleted (Rule 18 point 4).
 * ═══════════════════════════════════════════════════════════════════════ */

type Status = 'OWNER' | 'EVIDENCE' | 'CONVERSION' | 'FIXTURE' | 'OPEN';

interface Entry { path: string; status: Status; reason: string }

const ALLOWLIST: Entry[] = [
  {
    path: 'lib/training/capacity-resolver.ts',
    status: 'OWNER',
    reason:
      'THE canonical owner. Constitution §5 names resolveThresholdCapacity as the '
      + 'one application-level answer, and §16\'s fallback ladder lives inside it. '
      + 'It CALLS resolveCurrentTPace for rungs 2-4 rather than reimplementing the '
      + 'cascade, which is §24 (writing a second cascade to avoid touching the '
      + 'legacy one is how two answers appear).',
  },
  {
    path: 'lib/training/vdot.ts',
    status: 'OWNER',
    reason:
      'THE DEFINITION SITE of the Daniels T column (tPaceFromVdot, doctrine-bound '
      + 'by PACE.threshold-anchor) and of the legacy cascade the canonical resolver '
      + 'calls. Deleting resolveCurrentTPace would delete the owner\'s own rungs '
      + '2-4. It resolves no runner: it takes a VDOT or an anchor pace and returns '
      + 'the curve\'s value, with no database and no user.',
  },
  {
    path: 'lib/training/load-prescription-anchors.ts',
    status: 'OWNER',
    reason:
      'The Pace Prescription layer\'s DB shell over the four capacity resolvers. '
      + 'It holds no formula — delete it and the answers do not change, only the '
      + 'plumbing does. Listed so the owner set is written down in one place; it '
      + 'matches no producer symbol today and is asserted separately below.',
  },
  {
    path: 'lib/training/self-reported-pr.ts',
    status: 'EVIDENCE',
    reason:
      'AN EVIDENCE METHOD, which Constitution §6 explicitly permits: "Many '
      + 'systems may derive evidence ... They produce THRESHOLD EVIDENCE. They do '
      + 'not individually define THE RUNNER\'S THRESHOLD." It converts a typed PR '
      + 'to a pace for the resolver\'s own bottom rung and has exactly one '
      + 'consumer, composeThresholdCapacity.',
  },
  {
    path: 'lib/training/zone-stimulus.ts',
    status: 'CONVERSION',
    reason:
      'A PURE INVERSION of the published table — "what VDOT does this zone-pace '
      + 'sit at" — used to read a PRESCRIBED pace backwards, never to resolve a '
      + 'runner. §3 allows pure conversion utilities by name. Doctrine-gated by '
      + 'PACE.zone-stimulus-inversion, which asserts the round trip.',
  },
  {
    path: 'lib/plan/pace-zones.ts',
    status: 'CONVERSION',
    reason:
      'The design-18a before/after rows. It evaluates the SAME bound curve at two '
      + 'given VDOTs to show a per-zone delta; it does not decide which VDOT the '
      + 'runner has. Doctrine-gated by PACE.zone-reanchor-uses-bound-curve-'
      + 'functions, which fails if it collapses the three rows into one delta.',
  },
  {
    path: 'lib/adaptation/adaptation-engine.ts',
    status: 'CONVERSION',
    reason:
      'A STEP CEILING, not a belief. phaseStep converts the phase\'s own '
      + 'PRESCRIBED pace to a VDOT, adds the doctrine-quantised one point '
      + '(Research/01 §"Triggers to retest"), and converts back to bound the size '
      + 'of a move. The capacity it moves toward arrives from the resolver.',
  },
  {
    path: 'lib/doctrine/registry.ts',
    status: 'CONVERSION',
    reason:
      'THE GATE READING THE CURVE IT GUARDS. PACE.threshold-anchor parses the HM '
      + 'offset out of Research/01 at run time and compares tPaceFromVdot against '
      + 'it; a claim that could not call the engine could only prove it agrees '
      + 'with itself (Rule 18 point 4).',
  },
  {
    path: 'lib/runner-state/ownership.ts',
    status: 'CONVERSION',
    reason:
      'STRINGS, NOT CALLS. The runner-state registry NAMES this violation in its '
      + 'THRESHOLD_PACE row — canonical, competing, verdict OPEN. Its symbol names '
      + 'are quoted text; it imports nothing from vdot.ts and computes no pace.',
  },
  {
    path: 'lib/plan/authoring-shadow-compare.ts',
    status: 'CONVERSION',
    reason:
      'SHADOW ONLY, and the last place the pre-migration derivation exists. A '
      + 'comparison that does not reproduce the legacy cascade cannot measure the '
      + 'gap it exists to measure. No runtime importer, declared in '
      + 'MODULE_ORPHANS, persists nothing. Deleted the day the migration report '
      + 'stops needing a before.',
  },
  {
    path: 'lib/plan/_fixture-goal-tpace.ts',
    status: 'FIXTURE',
    reason:
      'THE FIXTURE THAT REPLACED tPaceFromGoal. A synthetic archetype ASSERTS its '
      + 'own threshold from the goal its author invented, which is what a fixture '
      + 'is for; it is not an inference about a real runner. The test below fails '
      + 'if any production module imports it.',
  },
  {
    path: 'lib/race/_race_outlook_fixture.ts',
    status: 'FIXTURE',
    reason:
      'A race-outlook fixture builder, same convention and same argument. Not '
      + 'reachable from any production module (asserted below).',
  },
  {
    path: 'lib/plan/seed-from-onboarding.ts',
    status: 'OPEN',
    reason:
      'lib/plan/seed-from-onboarding.ts:564 · COLD START, BEFORE ANY BELIEF '
      + 'EXISTS. The very first plan is seeded inside the onboarding transaction, '
      + 'for a runner whose runs the resolver cannot yet read; '
      + '_null_anchor_reachability.test.ts records that the capacity resolver\'s '
      + 'rungs "are for once the first plan is authored". Genuinely a second '
      + 'answer, kept because migrating it means resolving capacity mid-'
      + 'transaction for a user with no rows. The anchor it writes is stamped '
      + 'provisional_mileage and reanchorActivePlan replaces it within days.',
  },
  {
    path: 'lib/training/goal-projection.ts',
    status: 'OPEN',
    reason:
      'lib/training/goal-projection.ts:956 and :1202 · TWO SITES, BOTH REAL. :956 '
      + 'derives the T-pace a test point is PASSED against (T + 10); :1202 '
      + '(easyPaceForBlend) derives the easy band as T + 100 for the projection\'s '
      + 'blended basis and for plannedStimulus. Both take a raw vdot argument '
      + 'threaded from the caller, so migrating them means changing every caller\'s '
      + 'signature to carry PrescribedPaceAnchors — the same change '
      + 'lib/execution/load.ts just made for actualStimulus, and the obvious next '
      + 'one. Left rather than half-done: a projection that priced its pass '
      + 'criteria off one threshold and its easy band off another would be worse '
      + 'than the single divergence it has now.',
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * THE TESTS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('THRESHOLD-OWNER-1 · one threshold pace, one owner', () => {
  const files = TREES.flatMap((t) => walk(path.join(WEB, t)));
  const rel = (p: string) => path.relative(WEB, p);

  it('0 · LIVENESS · the scan reads the app', () => {
    // Rule 18 point 2. Reporting clean because it looked at nothing is the
    // worst outcome available, since it also reports confidence.
    expect(files.length).toBeGreaterThanOrEqual(LIVENESS_FLOOR);
  });

  it('0b · CONTROLS · the matcher fires on a leak and not on canonical pricing', () => {
    // Rule 18 point 1, run before any finding is reported. Falsify the check
    // itself: a matcher that cannot see the shape it was handed is not
    // evidence about the codebase.
    expect(producerHits('const t = tPaceFromVdot(ctx.vdot);')).toBe(1);
    expect(producerHits('const t = tPaceFromGoal(goalSec, distMi);')).toBe(1);
    expect(producerHits('const t = resolveCurrentTPace(v, a, mi, f);')).toBe(1);
    // The canonical read must NOT be flagged, or the gate is unusable.
    expect(producerHits('const t = anchors.thresholdSecPerMi;')).toBe(0);
    expect(producerHits('const c = await resolveThresholdCapacity(userId, today);')).toBe(0);
    // Comments are stripped, so an epitaph is not a resurrection.
    expect(producerHits('// this used to call tPaceFromVdot(v)')).toBe(0);
    expect(producerHits('/* tPaceFromGoal is deleted */')).toBe(0);
  });

  it('1 · no production file produces a threshold pace outside the allowlist', () => {
    const allowed = new Set(ALLOWLIST.map((e) => e.path));
    const unexplained: string[] = [];
    for (const f of files) {
      if (producerHits(fs.readFileSync(f, 'utf8')) === 0) continue;
      if (allowed.has(rel(f))) continue;
      unexplained.push(rel(f));
    }
    expect(
      unexplained,
      'A second answer to "what can this runner hold at threshold" appeared. '
      + 'Read it from resolveThresholdCapacity (Runner Model) or, if you need a '
      + 'prescribed target, resolvePrescribedPaceAnchors().anchors.'
      + 'thresholdSecPerMi (Pace Prescription). If it is genuinely an evidence '
      + 'method or a pure conversion, add an ARGUED entry to ALLOWLIST in '
      + 'lib/training/_threshold_owner_scan.test.ts.',
    ).toEqual([]);
  });

  it('2 · RATCHET · a stale allowlist entry fails until it is deleted', () => {
    const stale: string[] = [];
    for (const e of ALLOWLIST) {
      const abs = path.join(WEB, e.path);
      if (!fs.existsSync(abs)) { stale.push(`${e.path} (file is gone)`); continue; }
      // `load-prescription-anchors.ts` is listed for documentation and matches
      // nothing; every other entry must still match or it has been fixed.
      if (e.path === 'lib/training/load-prescription-anchors.ts') continue;
      if (producerHits(fs.readFileSync(abs, 'utf8')) === 0) {
        stale.push(`${e.path} (no longer produces a threshold pace — DELETE the entry)`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('2b · every allowlist entry carries an argued reason', () => {
    for (const e of ALLOWLIST) {
      expect(e.reason.length, `${e.path} has no argued reason`).toBeGreaterThan(80);
    }
  });

  it('3 · RATCHET · the OPEN set may shrink, never grow', () => {
    // Two files, four call sites, both named with file:line in their reasons.
    // Raising this number is a decision, not a refactor.
    const open = ALLOWLIST.filter((e) => e.status === 'OPEN').map((e) => e.path);
    expect(open.sort()).toEqual([
      'lib/plan/seed-from-onboarding.ts',
      'lib/training/goal-projection.ts',
    ]);
  });

  it('4 · GUARDED AS REMOVED · tPaceFromGoal does not come back', () => {
    const spec = fs.readFileSync(path.join(WEB, 'lib/plan/spec-builder.ts'), 'utf8');
    expect(/^export function tPaceFromGoal\b/m.test(spec)).toBe(false);
    // And nothing anywhere re-declares it under the old name.
    const redeclared = files.filter((f) =>
      /^\s*export (function|const) tPaceFromGoal\b/m.test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(redeclared.map(rel)).toEqual([]);
  });

  it('5 · the fixture is unreachable from production', () => {
    // The whole argument for keeping the goal→pace arithmetic alive is that it
    // is a FIXTURE input. If a production module imports it, that argument is
    // false and the side door is open again under a new name.
    // IMPORT SYNTAX ONLY, not any mention of the path. `lib/audit/generated-
    // content-registry.ts` carries `_race_outlook_fixture`'s path as a KEY and
    // argues in prose that "runtime code must never import it" — a registry
    // saying so is the opposite of a violation, and a scan that cannot tell a
    // citation from an import fires on the wrong one.
    const IMPORTS_FIXTURE =
      /(?:from|import)\s*\(?\s*['"][^'"]*(?:_fixture-goal-tpace|_race_outlook_fixture)['"]/;
    const importers = files
      .filter((f) => IMPORTS_FIXTURE.test(stripComments(fs.readFileSync(f, 'utf8'))))
      .map(rel)
      // The fixture modules themselves.
      .filter((r) => !r.includes('_fixture-goal-tpace') && !r.includes('_race_outlook_fixture'));
    expect(importers).toEqual([]);
    // FALSIFIED IN PLACE (Rule 18 point 1): the matcher must see a real import
    // and must not see the registry's prose citation of the same path.
    expect(IMPORTS_FIXTURE.test("import { x } from '@/lib/plan/_fixture-goal-tpace';")).toBe(true);
    expect(IMPORTS_FIXTURE.test("await import('./_race_outlook_fixture')")).toBe(true);
    expect(IMPORTS_FIXTURE.test("  'web-v2/lib/race/_race_outlook_fixture.ts':")).toBe(false);
  });

  it('6 · the fixture reproduces the deleted function exactly', () => {
    // Not "the fixture returns a number" — the shape of the RESULT (Rule 13
    // point 3). The four distance tiers and the ultra cutoff, checked against
    // the ONE surviving copy of the offset table (tPaceFromAnchorPace), so
    // this cannot pass by agreeing with a literal it also wrote.
    const cases: Array<[number, number]> = [
      [10800, 26.2188],  // marathon · the owner's own 3:00 CIM goal
      [5400, 13.1094],   // half
      [2400, 6.2137],    // 10K
      [1200, 3.1069],    // 5K
      [1500, 5.0],       // the 10K tier's lower edge
    ];
    for (const [sec, mi] of cases) {
      expect(fixtureTPaceFromGoalPace(sec, mi)).toBe(
        tPaceFromAnchorPace({ finishSeconds: sec, distanceMi: mi, paceSPerMi: sec / mi }),
      );
    }
    // The number this whole change is about, stated so a silent change to
    // either side is visible in the diff.
    expect(fixtureTPaceFromGoalPace(10800, 26.2188)).toBe(394);
    // Ultra returns null, exactly as the deleted function did (PACE-5).
    expect(fixtureTPaceFromGoalPace(6 * 3600, 31.0688)).toBeNull();
    // No goal, no number.
    expect(fixtureTPaceFromGoalPace(null, 26.2188)).toBeNull();
    expect(fixtureTPaceFromGoalPace(10800, null)).toBeNull();
    // The one deliberate divergence from the deleted function, pinned so it
    // is a decision rather than a surprise: a "goal" under a minute is not a
    // time, and `anchorPaceFrom` refuses it where `tPaceFromGoal` would have
    // priced it. Argued in the fixture's own header.
    expect(fixtureTPaceFromGoalPace(59, 3.1069)).toBeNull();
    expect(fixtureTPaceFromGoalPace(61, 3.1069)).not.toBeNull();
  });

  it('7 · the canonical owner is WIRED, not merely present', () => {
    // A deletion with nothing in its place passes every absence check above.
    // Assert the replacement is actually called at each site that used to hold
    // a second answer.
    const read = (p: string) => fs.readFileSync(path.join(WEB, p), 'utf8');

    expect(read('lib/training/load-prescription-anchors.ts'))
      .toContain('resolveThresholdCapacity(userId, today)');

    for (const site of [
      'lib/plan/recompute-paces.ts',
      'lib/plan/reanchor-plan.ts',
      'lib/plan/adapt.ts',
      'lib/execution/load.ts',
    ]) {
      expect(stripComments(read(site)), `${site} no longer resolves the canonical anchors`)
        .toContain('resolvePrescribedPaceAnchors');
    }

    // adapt.ts's single-row rebuild specifically: the function that used to
    // take a raceId and hand its goal to tPaceFromGoal.
    const adapt = stripComments(read('lib/plan/adapt.ts'));
    expect(adapt).toContain('async function deriveTPaceSecForRebuild(userId: string)');
    expect(adapt).not.toContain('tPaceFromGoal');

    // the executed-run grader takes the canonical threshold rather than
    // re-deriving one from a VDOT.
    const rec = stripComments(read('lib/execution/reconstruct.ts'));
    expect(rec).toContain('tPaceSecPerMi');
    expect(rec).not.toContain('tPaceFromVdot');
    expect(stripComments(read('lib/execution/load.ts')))
      .toContain('tPaceSecPerMi: anchors?.thresholdSecPerMi ?? null');
  });
});
