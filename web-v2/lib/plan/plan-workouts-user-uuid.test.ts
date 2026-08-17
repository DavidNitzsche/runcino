/**
 * lib/plan/plan-workouts-user-uuid.test.ts
 *
 * 2026-08-17 · multi-user hygiene invariant. Migration 143 added the
 * denormalized plan_workouts.user_uuid but its "Phase 2" (teach the
 * writers to stamp it) never landed — 112,496 of 116,372 rows were NULL
 * at audit. This suite locks the fix as a repo-wide invariant:
 *
 *   EVERY `INSERT INTO plan_workouts` statement in lib/ + app/ must list
 *   user_uuid in its column set.
 *
 * Static source scan on purpose: the four writers (generate.ts,
 * seed-from-onboarding.ts, injury-builder.ts, today/reschedule) are too
 * heavy to drive end-to-end in a unit test, and a scan also catches the
 * FIFTH insert site somebody adds next month without user_uuid.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd(); // vitest runs from web-v2/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Every INSERT INTO plan_workouts (...) column list in the file. */
function planWorkoutInsertColumnLists(src: string): string[] {
  const lists: string[] = [];
  const re = /INSERT INTO plan_workouts\s*\(([^)]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) lists.push(m[1]);
  return lists;
}

describe('plan_workouts INSERT sites stamp user_uuid', () => {
  const files = [...walk(path.join(ROOT, 'lib')), ...walk(path.join(ROOT, 'app'))];
  const sites: Array<{ file: string; columns: string }> = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (!src.includes('INSERT INTO plan_workouts')) continue;
    for (const columns of planWorkoutInsertColumnLists(src)) {
      sites.push({ file: path.relative(ROOT, f), columns });
    }
  }

  it('finds the four known writer files (sanity: the scan actually scans)', () => {
    const writerFiles = new Set(sites.map((s) => s.file));
    expect(writerFiles).toContain('lib/plan/generate.ts');
    expect(writerFiles).toContain('lib/plan/seed-from-onboarding.ts');
    expect(writerFiles).toContain('lib/plan/injury-builder.ts');
    expect(writerFiles).toContain(path.join('app', 'api', 'today', 'reschedule', 'route.ts'));
    expect(sites.length).toBeGreaterThanOrEqual(4);
  });

  it('every INSERT INTO plan_workouts column list includes user_uuid', () => {
    const missing = sites.filter((s) => !/\buser_uuid\b/.test(s.columns));
    expect(missing, `plan_workouts INSERT without user_uuid in: ${missing.map((s) => s.file).join(', ')}`).toEqual([]);
  });
});
