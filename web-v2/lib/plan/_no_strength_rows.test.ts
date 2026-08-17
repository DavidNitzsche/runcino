/**
 * STRENGTH-3 · a generated plan contains running and rest. Nothing else.
 *
 * David, 2026-08-17: "lets also remove anything about strength training.
 * Right now it adds a level of complication and I am handling that
 * elsewhere", and on cross-training, "remove it too". The governing
 * principle he gave with it: "This is a coaching platform at its core...
 * Less is more at this stage. Lets get the core working, lets get the
 * plans working."
 *
 * The data survives — `strength_sessions`, `cross_training_sessions` and
 * the HealthKit background sync are all untouched, so history keeps
 * accruing and the decision is reversible. What must not come back on its
 * own is the PRESCRIPTION: a plan row typed `strength` or `cross`, or a
 * rest day relabelled into a bike/pool/gym session.
 *
 * This file is that gate. It is deliberately a source scan rather than a
 * behavioural test, because the emission sites are `INSERT INTO
 * plan_workouts` statements inside DB-bound builders — a behavioural test
 * would need a database and would therefore not run in CI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { resolveInjuryProtocol } from './injury-protocols';
import { injuryWeekShape } from './injury-builder';

const ROOT = join(__dirname, '..', '..');

/**
 * Files that still emit a strength or cross row and are owned by another
 * agent's in-flight change, so this pass could not edit them.
 *
 * Same posture as the doctrine registry's `exempt` maps: an exemption is
 * an admission with a name on it, and it is checked for staleness below —
 * fix the file and this gate makes you delete the entry.
 */
/** Empty since 2026-08-17: generate.ts's strength companion rows and the
 *  crossModes rest-day relabel were removed, so the scan below now covers
 *  every plan-row writer with no exemptions. Adding an entry here is an
 *  admission with a name on it. */
const PENDING_ROUTE: readonly string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Source with block and line comments stripped, so prose about the
 *  removal never trips the scan. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Every file in lib/ or app/ that writes a plan_workouts row. */
function planRowWriters(): string[] {
  return [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))]
    .filter((f) => readFileSync(f, 'utf8').includes('INSERT INTO plan_workouts'))
    .map((f) => f.slice(ROOT.length + 1));
}

// A bare 'strength' / 'cross' string literal inside a plan-row writer is
// how every emission site in this codebase has ever been written — as the
// `type` column value, or as the sub_label the runner reads.
const FORBIDDEN = /(['"`])(strength|cross|cross-train|cross_train|CROSS-TRAIN|STRENGTH)\1/;

describe('STRENGTH-3 · no strength or cross row reaches a generated plan', () => {
  it('finds the plan-row writers at all (the scan is not silently empty)', () => {
    const writers = planRowWriters();
    expect(writers.length).toBeGreaterThan(2);
    expect(writers).toContain('lib/plan/injury-builder.ts');
    expect(writers).toContain('lib/plan/generate.ts');
  });

  it('no plan-row writer emits a strength or cross-training row', () => {
    const offenders: string[] = [];
    for (const rel of planRowWriters()) {
      if (PENDING_ROUTE.includes(rel)) continue;
      const m = code(join(ROOT, rel)).match(FORBIDDEN);
      if (m) offenders.push(`${rel} · ${m[0]}`);
    }
    expect(
      offenders,
      'faff prescribes running. A plan_workouts writer named a strength or '
      + 'cross-training session (David 2026-08-17). If this is a legitimate '
      + 'read of legacy rows rather than an emission, narrow the read instead '
      + 'of adding an exemption.',
    ).toEqual([]);
  });

  // ── Exemption staleness ────────────────────────────────────────────
  // The moment the routed edit lands in generate.ts, this fails and makes
  // whoever landed it delete the PENDING_ROUTE entry — at which point the
  // scan above starts covering the file for real.
  it('every PENDING_ROUTE entry still actually has the problem', () => {
    for (const rel of PENDING_ROUTE) {
      const src = code(join(ROOT, rel));
      expect(
        FORBIDDEN.test(src),
        `${rel} no longer emits a strength or cross row. Delete it from `
        + 'PENDING_ROUTE so this gate covers it.',
      ).toBe(true);
    }
  });

  // ── The injury path, which is where cross-training was doctrine ─────
  // Research/05:60-69 makes non-impact aerobic work the substitute during
  // a return-to-run block, so this is the one place removal costs
  // something real. The plan must still be coherent: no running when the
  // protocol says no running, and no bike/pool prescription either.
  it('an injury week prescribes no session that is not running', () => {
    const cases: Array<[string, string | null]> = [
      ['foot', 'navicular stress fracture'],   // clearance-gated, zero running
      ['shin', 'possible stress reaction'],    // suspected BSI
      ['achilles', null],                      // walk-run ladder from week 2
      ['knee', null],                          // keeps running throughout
      ['lower back', null],                    // conservative fallback
    ];
    for (const [site, notes] of cases) {
      const r = resolveInjuryProtocol({ site, notes, returnProtocol: null, severity: 'moderate' });
      for (let wi = 0; wi < r.planWeeks; wi++) {
        for (const d of injuryWeekShape(wi, r, 6, null)) {
          expect(['easy', 'rest'], `${site} week ${wi}`).toContain(d.type);
          expect(d.subLabel).not.toMatch(/strength|cross/i);
          expect(
            `${d.subLabel} ${d.notes}`,
            `${site} week ${wi} · faff no longer prescribes non-running work`,
          ).not.toMatch(/pool run|flotation|ergometer|elliptical|\bbike\b|cycling|\bswim\b|cross.?train/i);
        }
      }
    }
  });

  // A rehab week that renders as seven blank rest rows is a regression of
  // a different kind — the runner is told nothing. The monitored off-days
  // are what carry the doctrine's own reason for the day (Research/05:17,
  // and the "five consecutive pain-free days" BSI gate).
  it('a clearance-gated week is not silently an empty week', () => {
    const r = resolveInjuryProtocol({
      site: 'foot', notes: 'navicular stress fracture', returnProtocol: null, severity: 'moderate',
    });
    expect(r.clearanceRequired).toBe(true);
    for (let wi = 0; wi < r.planWeeks; wi++) {
      const days = injuryWeekShape(wi, r, 6, null);
      expect(days.filter((d) => d.type !== 'rest')).toEqual([]);
      const spoken = days.filter((d) => d.notes.trim().length > 40);
      expect(spoken.length, 'the week has to say what it is doing').toBeGreaterThan(3);
    }
  });
});
