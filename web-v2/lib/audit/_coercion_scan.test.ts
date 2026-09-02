/**
 * lib/audit/_coercion_scan.test.ts · COERCION-1, the gate behind Rule 11's
 * coercion half.
 *
 * Rule 11 says "don't know", "measured zero" and "the read failed" are three
 * facts, never one — and its own enforcement paragraph says only half of it is
 * gated. `check-swallowed-failure.sh` covers a DATABASE failure becoming a
 * value. This covers the mirror: a VALUE becoming an absence, and a failure
 * ONE INDIRECTION out of that scanner's reach.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT THIS GATE CANNOT FAIL ON · Rule 22, and read it before citing a green run
 *
 * `coercion-scan.ts`'s header carries the full list. The three that matter most
 * when you are deciding what a passing run proves:
 *
 *   · IT SEES READERS, NOT CONSUMERS. Whether an erased zero goes on to disable
 *     a safety mechanism or to blank a caption is not a syntactic property. The
 *     load-bearing / peripheral split is a PROXY for blast radius, not a
 *     measurement of it. Green means no NEW collapse crossed an engine
 *     boundary. It does not mean the engine can say "I don't know".
 *   · IT SEES TWO STATES, NOT THREE. Nothing here distinguishes "the read
 *     failed" from "there is no data" — both arrive as null.
 *   · IT SEES EXPRESSIONS, NOT STATEMENTS. `let x = null; if (n > 0) x = n;` is
 *     the identical collapse and is invisible. So is a parenthesised test:
 *     `(weekly?.length ?? 0) > 0 ? … : null` does not match, because the
 *     matcher anchors on an identifier. That is a real hole and it is named
 *     here rather than left for someone to discover by shipping through it.
 *
 * And the DISTRIBUTION question Rule 22 asks. This gate is one-sided by
 * construction: every assertion below fires on a collapse that makes the engine
 * MORE confident, and there is no assertion anywhere that fires when the engine
 * refuses too readily. That imbalance is deliberate — over-refusal is a real
 * failure mode and this gate would not catch it — so it is written down rather
 * than presented as coverage.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  scanSource, scanTree, isArithmeticGuard, ternaryColon,
  alternateIsAbsence, crossesBoundary, findBlindIndirect, maskSource,
} from './coercion-scan';
import {
  COERCION_ARGUED, HANDED_BACK, HANDED_BACK_FAILS, HANDED_BACK_KNOWN,
  LOAD_BEARING_KNOWN, PERIPHERAL_BASELINE, SCAN_FLOORS,
} from './coercion-registry';

// Same resolution the sibling gate uses, deliberately — two audit tests
// disagreeing about where the tree is would be a very silly way to scan zero
// files and report clean.
const ROOT = path.join(__dirname, '..', '..');
const result = scanTree(ROOT);
const loadBearing = result.sites.filter((s) => s.severity === 'load-bearing');
const peripheral = result.sites.filter((s) => s.severity === 'peripheral');

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD 0 · LIVENESS. A scanner that opens nothing reports clean AND reports
 * confidence, which is the worst outcome available and is the same bug this
 * gate exists to catch, one level up. This repo has shipped a check that ran
 * `mkdir -p` on the tree it audited and passed three guards over zero files.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('GUARD 0 · the scanner actually read the codebase', () => {
  it('opened enough files to be scanning anything', () => {
    expect(result.filesScanned).toBeGreaterThanOrEqual(SCAN_FLOORS.files);
  });

  it('parsed enough conditional expressions for the ternary matcher to be alive', () => {
    expect(result.ternariesSeen).toBeGreaterThanOrEqual(SCAN_FLOORS.ternaries);
  });

  it('parsed enough catch handlers for the blind-indirect matcher to be alive', () => {
    expect(result.catchesSeen).toBeGreaterThanOrEqual(SCAN_FLOORS.catches);
  });

  it('exonerated some arithmetic guards, so the classifier is not rejecting everything', () => {
    // If this ever hits zero the structural exoneration has stopped matching
    // and every `den > 0 ? n / den : null` in the codebase is about to be
    // reported as a violation — which is how a gate gets suppressed wholesale.
    expect(result.guardsExonerated).toBeGreaterThan(10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * POSITIVE CONTROLS · Rule 18. Break it on purpose and watch the gate name it.
 * Every fixture below is a shape that was found in this codebase for real.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('positive controls · the shapes that produced the incident', () => {
  it('catches the recentQualityPerWeek collapse verbatim', () => {
    const src = `
      export function composeForUserInternal(recentQualityPW: number) {
        return { recentQualityPerWeek: recentQualityPW > 0 ? recentQualityPW : undefined };
      }`;
    const { sites } = scanSource('lib/plan/fixture.ts', src);
    const hit = sites.find((s) => s.kind === 'zero-erasure');
    expect(hit).toBeTruthy();
    expect(hit!.test).toBe('recentQualityPW');
    expect(hit!.severity).toBe('load-bearing');
  });

  it('catches the ceiling collapse that made a zero bound infinite', () => {
    const src = `
      export function sizeDay(longMi: number) {
        return { ceilingMi: longMi > 0 ? longMi : null };
      }`;
    const { sites } = scanSource('lib/plan/fixture.ts', src);
    expect(sites.some((s) => s.test === 'longMi' && s.severity === 'load-bearing')).toBe(true);
  });

  it('catches a blind catch on a HELPER call, which swallow-scan cannot see', () => {
    const src = `
      export async function runnerIsCompromised(u: string) {
        const gap = await detectTrainingGap(u).catch(() => null);
        return { compromised: gap != null };
      }`;
    const { sites } = scanSource('lib/plan/fixture.ts', src);
    const hit = sites.find((s) => s.kind === 'blind-indirect');
    expect(hit).toBeTruthy();
    expect(hit!.symbol).toBe('runnerIsCompromised');
  });

  it('catches ?? 0 applied to a statistic reader', () => {
    const src = `
      export function f(mi: number[], d: number) {
        return { base: weeklyAvgFromWindow(mi, d, 28) ?? 0 };
      }`;
    const { sites } = scanSource('lib/plan/fixture.ts', src);
    expect(sites.some((s) => s.kind === 'absent-as-zero')).toBe(true);
  });

  it('resolves a ternary whose consequent contains a nested ternary', () => {
    const masked = maskSource('const x = n > 0 ? (m > 0 ? a : b) : null;');
    const q = masked.indexOf('?');
    const colon = ternaryColon(masked, q);
    expect(alternateIsAbsence(masked, colon)).toBe('null');
  });

  it('is not fooled by optional chaining or nullish coalescing', () => {
    const src = 'export function f(a: any) { return a?.b ?? null; }';
    const { sites } = scanSource('lib/plan/fixture.ts', src);
    expect(sites.filter((s) => s.kind === 'zero-erasure')).toHaveLength(0);
  });

  it('ignores a collapse written inside a comment', () => {
    // Prose that reads exactly like the bug produced a false positive in the
    // sibling scanner's own sweep. Comments are masked before anything looks.
    const src = `
      // was: recentQualityPerWeek: recentQualityPW > 0 ? recentQualityPW : undefined
      export function f() { return 1; }`;
    const { sites } = scanSource('lib/plan/fixture.ts', src);
    expect(sites).toHaveLength(0);
  });

  it('ignores a collapse written inside a string or template literal', () => {
    const src = 'export function f() { return `n > 0 ? n : null`; }';
    const { sites } = scanSource('lib/plan/fixture.ts', src);
    expect(sites).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * NEGATIVE CONTROLS · the other direction of Rule 18, and the owner's explicit
 * warning: "over-applying this makes the engine refuse to answer questions it
 * can answer, which is its own failure and would be worse than the disease."
 * A gate that flags every `> 0` ternary gets suppressed within a week.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('negative controls · an arithmetic guard is not an erasure', () => {
  it('exonerates a divide-by-zero guard', () => {
    expect(isArithmeticGuard('den', ' Math.round(num / den) ')).toBe(true);
  });

  it('exonerates an index into the tested collection', () => {
    expect(isArithmeticGuard('past.length', ' past[past.length - 1] ')).toBe(true);
  });

  it('exonerates Math.max over a spread of the tested collection', () => {
    expect(isArithmeticGuard('raws.length', ' Math.max(...raws) ')).toBe(true);
  });

  it('exonerates a mean over the tested collection', () => {
    expect(isArithmeticGuard('hrs.length', ' hrs.reduce((a, b) => a + b, 0) / hrs.length ')).toBe(true);
  });

  it('exonerates slice(-n), where zero returns the WHOLE array rather than none', () => {
    expect(isArithmeticGuard('w', ' median(vals.slice(-w)) ')).toBe(true);
  });

  it('does NOT exonerate a consequent that merely returns the tested value', () => {
    expect(isArithmeticGuard('recentQualityPW', ' recentQualityPW ')).toBe(false);
  });

  it('treats a local that never leaves its function as peripheral, not load-bearing', () => {
    const src = `
      export function f(n: number) {
        const x = n > 0 ? n : null;
        return x != null ? x + 1 : 0;
      }`;
    const { sites } = scanSource('lib/plan/fixture.ts', src);
    expect(sites.every((s) => s.severity === 'peripheral')).toBe(true);
  });

  it('does not treat a bare local assignment as crossing a boundary', () => {
    const masked = maskSource('  const x = n > 0 ? n : null;');
    expect(crossesBoundary(masked, masked.indexOf('n > 0'))).toBe(false);
  });

  it('does treat a return as crossing a boundary', () => {
    const masked = maskSource('  return n > 0 ? n : null;');
    expect(crossesBoundary(masked, masked.indexOf('n > 0'))).toBe(true);
  });

  it('leaves req.json().catch(() => null) alone — that is a 400, not a reading', () => {
    const src = 'export async function POST(req: Request) { const b = await req.json().catch(() => null); return b; }';
    const masked = maskSource(src);
    expect(findBlindIndirect('app/api/x/route.ts', src, masked)).toHaveLength(0);
  });

  it('never double-counts a site swallow-scan already owns', () => {
    const src = `
      export async function f(u: string) {
        return await pool.query('SELECT 1').catch(() => []);
      }`;
    const masked = maskSource(src);
    expect(findBlindIndirect('lib/plan/fixture.ts', src, masked)).toHaveLength(0);
  });

  it('leaves a handler that can actually SEE the error alone', () => {
    const src = `
      export async function f(u: string) {
        return await loadThing(u).catch((e) => { logReadFailure('f', e); return null; });
      }`;
    const masked = maskSource(src);
    expect(findBlindIndirect('lib/plan/fixture.ts', src, masked)).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE NAMED RATCHET · fails in BOTH directions, per Rule 18 clause 1.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('load-bearing ratchet · named, so it cannot be traded site-for-site', () => {
  it('no NEW collapse crosses an engine module boundary', () => {
    const known = new Map<string, number>();
    for (const id of LOAD_BEARING_KNOWN) known.set(id, (known.get(id) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const s of loadBearing) seen.set(s.id, (seen.get(s.id) ?? 0) + 1);

    const added: string[] = [];
    for (const [id, n] of seen) {
      const allowed = known.get(id) ?? 0;
      if (n > allowed) {
        const where = loadBearing.filter((s) => s.id === id);
        added.push(
          `${id} · ${n} site(s), ${allowed} allowed\n` +
          where.map((s) => `      ${s.file}:${s.line} [${s.kind}] ${s.expr}`).join('\n'),
        );
      }
    }
    expect(
      added,
      'A measured zero, an absence or a failure is being collapsed into one value at an\n' +
      'engine module boundary. Three fixes, in order of preference:\n' +
      '  1. return the three states distinguishably — a discriminated union whose\n' +
      '     refusal branch carries NO value field, so `.value` does not compile until\n' +
      '     the caller branches (lib/training/normal-window.ts, NormalReading<T>);\n' +
      '  2. fail CLOSED — if a guard cannot run, assume the thing it guards happened;\n' +
      '  3. argue it in COERCION_ARGUED, finishing "absent, measured-zero and failed\n' +
      '     lead to the same outcome for every consumer, because ___" honestly.\n' +
      'Never widen the classifier to swallow it. That is the same move as the\n' +
      'ternary that started this.\n\nNew:\n',
    ).toEqual([]);
  });

  it('no ratchet entry outlives the collapse it names', () => {
    const seen = new Map<string, number>();
    for (const s of loadBearing) seen.set(s.id, (seen.get(s.id) ?? 0) + 1);
    const stale: string[] = [];
    const counted = new Map<string, number>();
    for (const id of LOAD_BEARING_KNOWN) {
      counted.set(id, (counted.get(id) ?? 0) + 1);
      if ((counted.get(id) ?? 0) > (seen.get(id) ?? 0)) stale.push(id);
    }
    expect(
      stale,
      'These ids are on the ratchet but no longer exist in the tree. That means\n' +
      'somebody FIXED them, which is the point — delete the lines, so the list\n' +
      'records the new floor. A stale allowlist is how a gate quietly stops\n' +
      'meaning anything.\n\nDelete:\n',
    ).toEqual([]);
  });

  it('the peripheral count has not risen', () => {
    expect(
      peripheral.length,
      `Peripheral collapses rose to ${peripheral.length} from ${PERIPHERAL_BASELINE}.\n` +
      'This ratchet only moves one way. If you FIXED some, lower PERIPHERAL_BASELINE\n' +
      `to ${peripheral.length} and say so in the registry.`,
    ).toBeLessThanOrEqual(PERIPHERAL_BASELINE);
  });

  it('the peripheral baseline is not left slack after a fix', () => {
    expect(
      peripheral.length,
      `Peripheral collapses fell to ${peripheral.length}. Lower PERIPHERAL_BASELINE to\n` +
      'that number — slack in a ratchet is room for the next one to come back in.',
    ).toBe(PERIPHERAL_BASELINE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ARGUED EXEMPTIONS · every one must still name a real site, and every one
 * must carry an actual argument. Rule 18 clause 4.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('argued exemptions', () => {
  it('every argued id still names a collapse that exists', () => {
    const ids = new Set(result.sites.map((s) => s.id));
    const stale = COERCION_ARGUED.filter((e) => !ids.has(e.id)).map((e) => e.id);
    expect(
      stale,
      'An exemption whose target is now clean is a sentence nobody will re-check.\n' +
      'Delete it — the list can only shrink.\n\nStale:\n',
    ).toEqual([]);
  });

  it('every argued id is also on the ratchet, so nothing is exempt in only one place', () => {
    const known = new Set(LOAD_BEARING_KNOWN);
    const orphans = COERCION_ARGUED
      .filter((e) => loadBearing.some((s) => s.id === e.id) && !known.has(e.id))
      .map((e) => e.id);
    expect(orphans).toEqual([]);
  });

  it('no duplicate argued ids — one of the two would never be read', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const e of COERCION_ARGUED) {
      if (seen.has(e.id)) dupes.push(e.id);
      seen.add(e.id);
    }
    expect(dupes).toEqual([]);
  });

  it('every reason is long enough to contain an argument', () => {
    // 60 characters is roughly a clause with a "because" in it, which is the
    // bar. A one-word reason is a site nobody looked at.
    const thin = COERCION_ARGUED.filter((e) => e.reason.length < 60).map((e) => e.id);
    expect(thin).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * HANDED BACK · printed loudly on every run, ratcheted, and one boolean away
 * from being a hard failure. See the argument in the registry.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('handed back · real violations in files this session could not edit', () => {
  it('prints every one, so they cannot be quietly carried', () => {
    if (HANDED_BACK.length > 0) {
      const lines = HANDED_BACK.map((h) => `  · ${h.id}\n      ${h.reason}`).join('\n');
      // eslint-disable-next-line no-console
      console.warn(
        `\nCOERCION-1 · ${HANDED_BACK.length} known collapse(s) awaiting an owner:\n${lines}\n` +
        'These are NOT exemptions. Route them, fix them, delete the entry, and set\n' +
        'HANDED_BACK_FAILS = true so the next one cannot be carried this way.\n',
      );
    }
    expect(HANDED_BACK.length).toBeGreaterThanOrEqual(0);
  });

  /* ────────────────────────────────────────────────────────────────────────
   * THE FLAG DECIDES SEVERITY. IT DOES NOT DECIDE WHETHER THE CHECK RUNS.
   *
   * This was, verbatim, the anti-pattern Rule 18 names by example:
   *
   *     it('fails the build once HANDED_BACK_FAILS is flipped', () => {
   *       if (!HANDED_BACK_FAILS) return;      // ← above the only assertion
   *       expect(HANDED_BACK.map(h => h.id)).toEqual([]);
   *     });
   *
   * FALSIFIED 2026-09-01 by replacing the assertion body with
   * `expect(1).toBe(2)`: **35 tests passed.** The branch was unreachable dead
   * code, it had never run, and it could not be falsified — which is exactly
   * the mechanism that held F-4's seven live Rule 11 collapses open while the
   * gate printed OK on every build.
   *
   * The assertion below ALWAYS executes. `HANDED_BACK_FAILS` chooses what is
   * allowed, never whether anything is checked:
   *   · false → only the ids on `HANDED_BACK_KNOWN` may be handed back, so a
   *             NEW collapse added to the list fails the build today;
   *   · true  → nothing may be handed back at all.
   * And the ratchet fails in the other direction too: an id on the list that is
   * no longer handed back must be deleted.
   * ──────────────────────────────────────────────────────────────────────── */
  it('no collapse is handed back that is not on the ratchet · the flag sets severity', () => {
    const ids = HANDED_BACK.map((h) => h.id);
    const allowed = HANDED_BACK_FAILS ? [] : HANDED_BACK_KNOWN;
    const notAllowed = ids.filter((id) => !allowed.includes(id));
    expect(
      notAllowed,
      HANDED_BACK_FAILS
        ? '\nHANDED_BACK_FAILS is on and these collapses are still present. Fix them or turn\n'
          + 'the flag back off with a reason — do not delete the entries.\n'
        : '\nA collapse was handed back that is not on HANDED_BACK_KNOWN. The list is a\n'
          + 'ratchet and a staging area, not a home: route this to an owner and fix it,\n'
          + 'rather than widening the list. Every id on it is a Rule 11 collapse that is\n'
          + 'LIVE IN PRODUCTION RIGHT NOW.\n',
    ).toEqual([]);
  });

  it('no ratchet entry outlives the collapse it names', () => {
    const ids = new Set(HANDED_BACK.map((h) => h.id));
    const stale = HANDED_BACK_KNOWN.filter((id) => !ids.has(id));
    expect(
      stale,
      '\nThese ids are on HANDED_BACK_KNOWN but no longer appear in HANDED_BACK. Somebody\n'
      + 'fixed them, which is the point — delete the lines. A stale exemption is a licence\n'
      + 'nobody checked (Rule 18 point 4).\n',
    ).toEqual([]);
  });

  it('every handed-back entry names an OWNER, not just a direction', () => {
    // The reason F-4's seven sat for a week: the list recorded WHAT was wrong
    // and never WHO was going to fix it, so "awaiting an owner" was true of all
    // seven forever and nothing distinguished a routed one from an abandoned one.
    const ownerless = HANDED_BACK.filter((h) => !h.owner || h.owner.trim().length < 12).map((h) => h.id);
    expect(
      ownerless,
      '\nA handed-back collapse with no owner is not staged, it is abandoned. Name the\n'
      + 'system that owns the decision (see docs/BRAIN_CONSTITUTION.md\'s ownership table).\n',
    ).toEqual([]);
  });

  it('every handed-back reason states the DIRECTION of the failure', () => {
    // Which way the collapse errs is the whole finding. A guard that fails
    // closed is a nuisance; one that fails open is the bug.
    const undirected = HANDED_BACK
      .filter((h) => !/PERMISSIVE|CONSERVATIVE/.test(h.reason))
      .map((h) => h.id);
    expect(undirected).toEqual([]);
  });
});
