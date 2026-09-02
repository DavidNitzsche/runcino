/**
 * RULE 20 GATE · the Adaptation Engine's shadow-only claim, and the thing that
 * has to be true before it stops being shadow-only.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BLOCKER THIS CLOSES
 *
 * The 2026-09-02 ownership audit scored "should training change" a FAIL and
 * was precise about why it is not the obvious reason:
 *
 *     "Three legacy paths mutate; the claimed owner is shadow-only. This is a
 *      documented staging posture and is not itself a defect — but NOTHING
 *      ANYWHERE ASSERTS THAT THE LEGACY PATH STOPS WRITING WHEN THE NEW ENGINE
 *      IS PROMOTED, and that missing assertion is the defect."
 *
 * `load-adaptation-engine.ts` states in its own header: "SHADOW MODE. Nothing
 * calls this on a live path and it writes nothing." Rule 20's corollary is
 * explicit that a header comment asserting an invariant is documentation, not
 * enforcement — gate the claim or delete the sentence. This gates it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE SECOND HALF MATTERS
 *
 * Promotion is the moment two engines could both write. Today that cannot
 * happen because the new one writes nothing; the danger is a future change
 * that switches it on WITHOUT retiring the three paths that already mutate,
 * leaving a runner's plan with two authors and no way to tell which moved it.
 *
 * So the legacy mutators are NAMED here. The gate cannot know when someone
 * decides to promote, but it can guarantee the list is accurate on the day
 * they do, and that switching the engine on trips this file rather than
 * passing silently.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE CANNOT FAIL ON (Rule 22)
 *
 * It reads static source text, so a write reached through a helper in another
 * module, a raw pool call assembled from a template string, or a dynamic
 * import is invisible to it. It cannot verify that the legacy mutators are
 * CORRECT, only that they are the ones we think exist. And it cannot tell a
 * deliberate promotion from an accidental one — it can only make either of
 * them fail here first, which is the point.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const ENGINE = join(__dirname, 'load-adaptation-engine.ts');

/**
 * Every path that mutates a runner's training today. Named by the audit,
 * verified present below. A ratchet in one direction: when the engine is
 * promoted these must be retired, and until then the list must stay honest.
 */
const LEGACY_MUTATORS: Record<string, string> = {
  'lib/plan/adapt.ts': 'reschedules, downgrades and drops sessions on the live plan.',
  'lib/plan/adaptive-ramp.ts': 'proposes the volume bump, the one upward lever that exists; the write lands through mutatePlan, so this file only reads.',
  'app/api/cron/plan-drift/route.ts': 'fires fireAutoRebuild, which re-authors the whole block.',
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ((p.endsWith('.ts') || p.endsWith('.tsx')) && !p.includes('.test.')) out.push(p);
  }
  return out;
}

/** Source with comments removed — a claim about CODE must not be satisfied,
 *  or broken, by prose describing the code. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('Rule 20 · the adaptation engine is shadow-only, and says what promotion costs', () => {
  it('LIVENESS · the engine file exists and is substantial', () => {
    expect(existsSync(ENGINE)).toBe(true);
    expect(readFileSync(ENGINE, 'utf8').length).toBeGreaterThan(3000);
  });

  it('the engine still CLAIMS shadow mode in its header', () => {
    // If someone deletes the sentence, this gate must be revisited rather than
    // quietly continuing to enforce a claim nobody makes any more.
    expect(readFileSync(ENGINE, 'utf8')).toMatch(/SHADOW MODE/);
  });

  it('and the claim is TRUE · the engine writes nothing', () => {
    const src = code(readFileSync(ENGINE, 'utf8'));
    for (const verb of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i]) {
      expect(src, `the engine performs a write (${verb}). It is documented as writing `
        + `nothing. Either it is no longer shadow-only — in which case retire the `
        + `LEGACY_MUTATORS below first — or the write is a mistake.`).not.toMatch(verb);
    }
  });

  it('and the claim is TRUE · nothing calls it on a live path', () => {
    const importers = walk(join(ROOT, 'lib'))
      .concat(walk(join(ROOT, 'app')))
      .filter((f) => f !== ENGINE)
      .filter((f) => /from ['"][^'"]*load-adaptation-engine['"]/.test(code(readFileSync(f, 'utf8'))))
      .map((f) => f.slice(ROOT.length + 1));
    // The shadow comparator is the only permitted caller. It is what produces
    // the production rows that a promotion review would read.
    expect(importers.sort(), 'a new caller of the adaptation engine. If this is '
      + 'promotion, retire every path in LEGACY_MUTATORS in the same change; two '
      + 'engines writing one plan is exactly what this gate exists to stop.')
      .toEqual(['lib/adaptation/shadow-compare.ts']);
  });

  it('every legacy mutator named here still exists (the list stays honest)', () => {
    for (const [rel, why] of Object.entries(LEGACY_MUTATORS)) {
      expect(existsSync(join(ROOT, rel)), `${rel} is named as a legacy mutator but `
        + `no longer exists — delete it from LEGACY_MUTATORS`).toBe(true);
      expect(why.length).toBeGreaterThan(20);
    }
  });

  it('every legacy path is still LIVE — reachable from a route or a cron', () => {
    // The property that matters for promotion is not "does this file contain a
    // write" but "can training still change through here". `adaptive-ramp.ts`
    // is the case that taught this gate the difference: it PROPOSES the bump
    // and performs no write of its own, and an earlier draft of this test
    // wrongly reported it as having stopped mutating.
    const entryPoints = walk(join(ROOT, 'app', 'api'));
    const unreachable = Object.keys(LEGACY_MUTATORS).filter((rel) => {
      if (rel.startsWith('app/api/')) return !existsSync(join(ROOT, rel));
      const modulePath = rel.replace(/^lib\//, '').replace(/\.ts$/, '');
      return !entryPoints.some((f) =>
        code(readFileSync(f, 'utf8')).includes('@/lib/' + modulePath));
    });
    expect(unreachable, 'a legacy path is no longer reachable from any route or '
      + 'cron. That is progress — delete it from LEGACY_MUTATORS rather than '
      + 'leaving the list claiming a live writer that is not.').toEqual([]);
  });
});
