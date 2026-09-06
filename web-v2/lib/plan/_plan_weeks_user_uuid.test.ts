/**
 * PLANWEEKSUUID-1 (2026-09-06) · every plan_weeks/plan_phases writer stamps
 * user_uuid on INSERT.
 *
 * CLAUDE.md Rule 14 names `plan_weeks.user_uuid` by name as a NULL-prone
 * column: migration 143 (2026-06-10) added it, denormalized from
 * `training_plans.user_uuid`, backfilled it once, and left a "Phase 2
 * (separate, later): teach the writers to stamp user_uuid on INSERT" note
 * that nothing ever picked up. Measured against production 2026-09-06:
 * `plan_weeks` 88/672 NULL, `plan_phases` 25/222 NULL — every row created
 * since the one-time backfill, because `generate.ts`, `injury-builder.ts`
 * and `seed-from-onboarding.ts` all stamp `user_uuid` on their `plan_workouts`
 * row (0/4742 NULL in production) and never did on the two tables above it
 * in the same function.
 *
 * The read side stays on the `plan_id` join regardless (defense in depth,
 * per the migration's own comment) — this gate is about the WRITE side only,
 * so a future backfill of the historical NULLs stays fixed rather than
 * drifting again on the next plan any of these three functions author.
 *
 * Source scan, not a behavioural test, for the same reason
 * `_no_strength_rows.test.ts` next door is one: every emission site here is
 * inside a DB-bound builder, and a behavioural test would need a database to
 * run in CI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Every file that writes a plan_weeks or plan_phases row, source with
 *  comments stripped so an INSERT statement embedded in a comment (like this
 *  file's own header) never counts as a writer. */
function rowWriters(table: 'plan_weeks' | 'plan_phases'): string[] {
  return [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))]
    .filter((f) => code(f).includes(`INSERT INTO ${table}`))
    .map((f) => f.slice(ROOT.length + 1));
}

/** The column list of an `INSERT INTO <table> (...)` statement, whitespace
 *  collapsed so a multi-line statement matches the same as a one-liner. */
function insertColumnLists(src: string, table: string): string[] {
  const flat = src.replace(/\s+/g, ' ');
  const re = new RegExp(`INSERT INTO ${table} \\(([^)]*)\\)`, 'g');
  return [...flat.matchAll(re)].map((m) => m[1]);
}

describe('PLANWEEKSUUID-1 · plan_weeks and plan_phases writers stamp user_uuid', () => {
  it('finds the plan_weeks writers at all (the scan is not silently empty)', () => {
    const writers = rowWriters('plan_weeks');
    expect(writers.length).toBeGreaterThanOrEqual(3);
    expect(writers).toContain('lib/plan/generate.ts');
    expect(writers).toContain('lib/plan/injury-builder.ts');
    expect(writers).toContain('lib/plan/seed-from-onboarding.ts');
  });

  it('finds the plan_phases writers at all (the scan is not silently empty)', () => {
    const writers = rowWriters('plan_phases');
    expect(writers.length).toBeGreaterThanOrEqual(3);
  });

  for (const table of ['plan_weeks', 'plan_phases'] as const) {
    it(`every INSERT INTO ${table} names user_uuid in its column list`, () => {
      const offenders: string[] = [];
      for (const rel of rowWriters(table)) {
        const lists = insertColumnLists(code(join(ROOT, rel)), table);
        for (const cols of lists) {
          if (!/\buser_uuid\b/.test(cols)) offenders.push(`${rel} · (${cols.trim()})`);
        }
      }
      expect(
        offenders,
        `a ${table} INSERT does not stamp user_uuid, which is how 88/672 plan_weeks and `
        + '25/222 plan_phases rows went NULL in production (measured 2026-09-06) — every '
        + 'plan authored after the one-time 2026-06-10 backfill and before this gate.',
      ).toEqual([]);
    });
  }
});
