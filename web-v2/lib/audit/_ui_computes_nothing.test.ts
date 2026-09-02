/**
 * RULE 20 GATE · "UI displays, it never calculates" is a rule only if a check
 * enforces it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The Brain Constitution's ownership table gives row 13 to "how do we tell
 * them", answered: UI displays, never calculates. The 2026-09-02 ownership
 * audit scored that row a PASS **by inspection only**, and said so:
 *
 *     "Per Rule 20 they are hypotheses, and a new v5 route with an inline
 *      `predictRaceTime(` would be caught by nothing. The Race Prediction
 *      gate is a hardcoded six-file list that already cannot see two live
 *      producers."
 *
 * This is that check. It does not refactor anything. It FREEZES the census of
 * routes and components that reach for a canonical coaching primitive, and
 * makes the list a one-way ratchet: it may shrink, never grow.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A RATCHET AND NOT A BAN
 *
 * Some of these are legitimate and some are the finding, and a gate that
 * cannot tell them apart would have to be switched off. Each entry therefore
 * carries a reason, and the reasons are honest about which is which:
 *
 *   · A CRON THAT IS THE PRODUCER is not a UI. `snapshot-projections` exists
 *     to compute the projection series; calling the primitive is its job.
 *   · AN INTERNAL TOOL is not the product. `app/sim/plan` mirrors onboarding
 *     for engineers and is not a runner surface.
 *   · A V5 RUNNER SURFACE reaching for a primitive IS the defect, and those
 *     entries say so. They are here to be deleted, not to be blessed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE CANNOT FAIL ON (Rule 22)
 *
 * It reads static import and call text. It cannot see a primitive reached
 * through a dynamic string, a re-export under another name, or a helper in
 * `lib/` that a route calls to do the same arithmetic one level down — which
 * is the obvious way around it and the reason this gate is a floor, not a
 * proof. It says nothing about whether any of these numbers is CORRECT, only
 * about who computed it. And it cannot tell a legitimate producer from a
 * defect on its own; that judgement lives in the reasons below and a careless
 * entry would launder a real violation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/** The canonical coaching primitives. Reaching for one of these outside `lib/`
 *  means a surface is doing the brain's arithmetic itself. */
const PRIMITIVES = ['predictRaceTime', 'vdotFromRace', 'bestRecentVdot', 'computeZones'] as const;

/**
 * Frozen 2026-09-02. A one-way ratchet: entries may be DELETED as surfaces are
 * migrated onto the canonical resolvers; a new one fails the build.
 */
const CENSUS: Record<string, Record<string, string>> = {
  predictRaceTime: {
    'app/api/cron/snapshot-projections/route.ts': 'PRODUCER · this cron exists to compute the projection series.',
    'app/api/race/result/route.ts': 'PRODUCER · converts a submitted chip time into an evidence-grade result.',
    'app/api/targets/projection/route.ts': 'PRODUCER · the projection surface, migrated onto resolveRaceExponent 2026-09-02.',
    'app/api/v5/race/[slug]/route.ts': 'DEFECT · a runner surface computing a prediction. Should read lib/race/race-outlook.ts.',
    'app/api/v5/races/route.ts': 'DEFECT · same. Audit row 10 names the second CIM projection this produces.',
    'app/sim/plan/page.tsx': 'INTERNAL TOOL · the plan simulator, not a runner surface.',
    'components/faff-app/seed.ts': 'WEB FRONTEND · paused product surface (CLAUDE.md), not shipped to runners.',
    'components/faff-app/views/GapPanel.tsx': 'WEB FRONTEND · the paused web product surface, not shipped to any runner.',
  },
  vdotFromRace: {
    'app/api/race/result/route.ts': 'PRODUCER · inverts a submitted chip time into a VDOT, which is the evidence this app is built on.',
    'app/api/race/route.ts': 'PRODUCER · race authoring seeds a VDOT from a stated prior result.',
    'app/api/targets/projection/route.ts': 'PRODUCER · the projection surface itself, migrated onto resolveRaceExponent on 2026-09-02.',
    'app/sim/plan/page.tsx': 'INTERNAL TOOL · the plan simulator mirrors onboarding for engineers and ships to no runner.',
  },
  bestRecentVdot: {
    'app/api/coach/read/route.ts': 'DEAD ROUTE · has no callers; audit row 13 names it for deletion.',
    'app/api/cron/plan-drift/route.ts': 'PRODUCER · drift detection is this job.',
    'app/api/cron/snapshot-projections/route.ts': 'PRODUCER · this cron exists to compute and persist the projection series.',
    'app/api/targets/projection/route.ts': 'PRODUCER · the projection surface itself, migrated onto resolveRaceExponent on 2026-09-02.',
    'app/api/v5/races/route.ts': 'DEFECT · audit row 3. Should read lib/training/capacity-resolver.ts.',
    'app/api/v5/today/route.ts': 'DEFECT · audit row 3; returns 47.7 where the canonical resolver says 47.8.',
    'app/sim/plan/page.tsx': 'INTERNAL TOOL · the plan simulator mirrors onboarding for engineers and ships to no runner.',
  },
  computeZones: {
    'app/api/ingest/workout/route.ts': 'PRODUCER · stamps zone shares at ingest.',
    'app/api/v5/today/route.ts': 'DEFECT · audit row 7; HR derivation has no single owner yet.',
    'app/api/watch/workouts/complete/route.ts': 'PRODUCER · grades a completed session.',
  },
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

const FILES = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))];
const rel = (p: string) => p.slice(ROOT.length + 1);

describe('Rule 20 · surfaces do not compute coaching numbers', () => {
  it('LIVENESS · the scanner reads a non-zero number of surface files', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  for (const sym of PRIMITIVES) {
    it(`RATCHET · no NEW surface reaches for ${sym}`, () => {
      const found = FILES.filter((f) => new RegExp(`\\b${sym}\\b`).test(readFileSync(f, 'utf8'))).map(rel).sort();
      const allowed = Object.keys(CENSUS[sym]).sort();
      const added = found.filter((f) => !allowed.includes(f));
      expect(added, `${sym}: a surface must not compute this. Read the canonical `
        + `resolver instead (lib/race/race-outlook.ts, lib/training/capacity-resolver.ts, `
        + `lib/training/load-prescription-anchors.ts). If it is genuinely a producer, `
        + `add it to CENSUS with a reason that says why.`).toEqual([]);
    });

    it(`RATCHET · every ${sym} entry is still real (a migrated surface must be deleted from the list)`, () => {
      const found = FILES.filter((f) => new RegExp(`\\b${sym}\\b`).test(readFileSync(f, 'utf8'))).map(rel);
      const stale = Object.keys(CENSUS[sym]).filter((f) => !found.includes(f));
      expect(stale, `${sym}: these no longer reach for it. Delete them from CENSUS — `
        + `a stale allowlist is how a gate stops meaning anything.`).toEqual([]);
    });
  }

  it('every census entry carries a reason that classifies it', () => {
    for (const [sym, files] of Object.entries(CENSUS)) {
      for (const [f, why] of Object.entries(files)) {
        expect(why, `${sym} · ${f}`).toMatch(/^(PRODUCER|DEFECT|INTERNAL TOOL|WEB FRONTEND|DEAD ROUTE) ·/);
        expect(why.length, `${sym} · ${f} needs a real reason`).toBeGreaterThan(24);
      }
    }
  });

  it('records how many entries are DEFECTs, so the number has to move deliberately', () => {
    const defects = Object.values(CENSUS)
      .flatMap((files) => Object.entries(files))
      .filter(([, why]) => why.startsWith('DEFECT ·'));
    // 2026-09-02 · five runner surfaces compute a coaching number themselves.
    // Lower this as they migrate. It may not rise.
    expect(defects.length).toBeLessThanOrEqual(5);
  });
});
