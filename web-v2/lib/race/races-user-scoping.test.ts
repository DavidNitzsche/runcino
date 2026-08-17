/**
 * lib/race/races-user-scoping.test.ts
 *
 * 2026-08-17 · races PRIMARY KEY (slug) → PRIMARY KEY (slug, user_uuid).
 *
 * Today `slug` is globally unique, so a query may match a races row on slug
 * alone and still be correct by accident. After the PK swap that accident
 * ends: slug identifies a row PER USER, and any races access that filters or
 * joins on slug without also matching user_uuid silently reaches across
 * tenants — reading another runner's race date, or fanning a one-row join
 * into one row per user holding that slug.
 *
 *   F1  a plan → races join with a shared slug returns ONLY the caller's
 *       race (evaluated against the ON clauses the app really emits)
 *       and drops to zero rows if the owner predicate is ever removed
 *   F2  every races JOIN in app/ + lib/ carries an owner predicate in its
 *       own ON clause — not in a sibling WHERE a later edit could move
 *   F3  every races SQL statement mentions user_uuid at all
 *   F4  both upsert sites target the composite key (slug, user_uuid)
 *   F5  pre-migration, a foreign-owned slug raises 23505 against the
 *       still-present races_pkey (slug) rather than filtering to rowCount
 *       0 — the suffix retry must fire on BOTH signals so this code is
 *       safe to deploy before the DDL runs
 *   F6  course_library's ON CONFLICT (slug) is a DIFFERENT table and must
 *       stay single-column
 *
 * Mock style: vi.mock pool with query-text dispatch, same as
 * slug-claim.test.ts / races-state.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/auth/session', async () => ({
  requireUserId: vi.fn().mockResolvedValue('abcdef12-3456-7890-abcd-ef1234567890'),
}));
vi.mock('@/lib/coach/cache', () => ({ bustBriefingCacheForEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/plan/generate', () => ({ generatePlan: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/coach/settings', () => ({ patchSettings: vi.fn().mockResolvedValue(undefined) }));

import { pool } from '@/lib/db/pool';
import { POST } from '@/app/api/race/route';

const USER_A = 'abcdef12-3456-7890-abcd-ef1234567890';
const USER_B = '99999999-0000-0000-0000-000000000000';
const USER8 = 'abcdef12';

// ───────────────────────────── source scan ──────────────────────────────

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ((p.endsWith('.ts') || p.endsWith('.tsx')) && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** Strip `-- …` SQL comments so prose inside a query can't match. */
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, ' ');

const RACES_REF = /\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM)\s+races\b/i;

/** Every backtick template literal in app/ + lib/ that is races SQL. */
function racesStatements(): Array<{ file: string; sql: string }> {
  const out: Array<{ file: string; sql: string }> = [];
  for (const dir of ['app', 'lib']) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/`([^`]*)`/g)) {
        const sql = stripSqlComments(m[1]);
        if (!RACES_REF.test(sql)) continue;
        out.push({ file: path.relative(ROOT, file), sql });
      }
    }
  }
  return out;
}

/** ON clauses of `[LEFT] JOIN races <alias>` across the codebase. */
function racesJoins(): Array<{ file: string; alias: string; on: string }> {
  const out: Array<{ file: string; alias: string; on: string }> = [];
  const re = /\b(?:LEFT\s+|INNER\s+)?JOIN\s+races\s+(\w+)\s+ON\b([\s\S]*?)(?=\bWHERE\b|\bORDER\b|\bGROUP\b|\bLIMIT\b|\bJOIN\b|\)|$)/gi;
  for (const { file, sql } of racesStatements()) {
    for (const m of sql.matchAll(re)) out.push({ file, alias: m[1], on: m[2] });
  }
  return out;
}

/** Does this ON clause bind the race's owner to the driving row's owner? */
const ownerScoped = (on: string, alias: string) =>
  new RegExp(`\\b${alias}\\.user_uuid\\b[\\s\\S]{0,40}?=`, 'i').test(on);

// ─────────────────────── F1 · behavioural join ──────────────────────────

type RaceRow = { slug: string; user_uuid: string; date: string };
type PlanRow = { race_id: string; user_uuid: string };

/** Two runners, same slug — exactly what the composite PK makes legal. */
const RACES: RaceRow[] = [
  { slug: 'boston-2027', user_uuid: USER_A, date: '2027-04-19' },
  { slug: 'boston-2027', user_uuid: USER_B, date: '2099-12-31' },
];
const CALLER_PLAN: PlanRow = { race_id: 'boston-2027', user_uuid: USER_A };

/**
 * Evaluate a real `JOIN races rc ON …` clause against the fixture. Only the
 * two predicate shapes the codebase uses are understood; anything else
 * throws rather than silently passing.
 */
function joinRows(on: string, alias: string, plan: PlanRow): RaceRow[] {
  const slugPred = new RegExp(`${alias}\\.slug\\s*=\\s*tp\\.race_id`, 'i');
  if (!slugPred.test(on)) throw new Error(`unrecognised races join predicate: ${on.trim()}`);
  return RACES.filter(r => {
    if (r.slug !== plan.race_id) return false;
    if (ownerScoped(on, alias)) return r.user_uuid === plan.user_uuid;
    return true; // slug-only join — fans out across every user
  });
}

describe('races composite PK · plan → races joins', () => {
  it('F1 · a slug shared by two runners resolves to the caller\'s race only', () => {
    const joins = racesJoins().filter(j => /tp\.race_id/i.test(j.on));
    expect(joins.length).toBeGreaterThan(0);

    for (const j of joins) {
      const rows = joinRows(j.on, j.alias, CALLER_PLAN);
      expect(rows.length, `${j.file} fanned out across users`).toBe(1);
      expect(rows[0].user_uuid, `${j.file} returned the wrong runner's race`).toBe(USER_A);
      expect(rows[0].date, `${j.file} returned the wrong race date`).toBe('2027-04-19');
    }
  });

  it('F1b · the fixture proves an unscoped join really would fan out', () => {
    const rows = joinRows('rc.slug = tp.race_id', 'rc', CALLER_PLAN);
    expect(rows.length).toBe(2); // guards the test itself against passing vacuously
  });

  it('F2 · every races join carries the owner predicate in its own ON clause', () => {
    const unscoped = racesJoins()
      .filter(j => !ownerScoped(j.on, j.alias))
      .map(j => `${j.file} · JOIN races ${j.alias} ON ${j.on.trim().replace(/\s+/g, ' ')}`);
    expect(unscoped).toEqual([]);
  });

  it('F3 · every races SQL statement is user-scoped', () => {
    const unscoped = racesStatements()
      .filter(s => !/user_uuid/i.test(s.sql))
      .map(s => `${s.file} · ${s.sql.trim().replace(/\s+/g, ' ').slice(0, 120)}`);
    expect(unscoped).toEqual([]);
  });
});

// ─────────────────────── F4/F5 · upsert targets ─────────────────────────

function raceReq(): Request {
  return new Request('http://test.local/api/race', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'City Half', date: '2026-10-04', distance_label: 'Half Marathon', priority: 'B' }),
  });
}

/** Per INSERT call: a rowCount, or an Error to reject with. */
function dispatch(inserts: Array<number | Error>): void {
  let i = 0;
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes('INSERT INTO races')) {
      const next = inserts[i++] ?? 0;
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({ rows: [], rowCount: next });
    }
    if (typeof sql === 'string' && sql.includes('FROM training_plans')) {
      return Promise.resolve({ rows: [{ race_id: 'other-race' }] }); // active plan → no auto-generate
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

function insertCalls(): Array<[string, unknown[]]> {
  return (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO races'),
  ) as Array<[string, unknown[]]>;
}

/** node-pg surfaces a unique violation as an Error carrying code 23505. */
function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint "races_pkey"'), {
    code: '23505',
  });
}

beforeEach(() => vi.clearAllMocks());

describe('races composite PK · upsert conflict targets', () => {
  it('F4 · POST /api/race targets ON CONFLICT (slug, user_uuid)', async () => {
    dispatch([1]);
    await POST(raceReq() as never);
    const [sql] = insertCalls()[0];
    expect(sql).toMatch(/ON CONFLICT \(slug, user_uuid\)/);
    expect(sql).not.toMatch(/ON CONFLICT \(slug\)/);
  });

  it('F4b · the onboarding race path targets the composite key too', () => {
    const src = readFileSync(
      path.join(ROOT, 'app', 'api', 'onboarding', 'complete', 'route.ts'), 'utf8',
    );
    expect(src).toMatch(/INSERT INTO races[\s\S]*?ON CONFLICT \(slug, user_uuid\)/);
    expect(src).not.toMatch(/INSERT INTO races[\s\S]*?ON CONFLICT \(slug\)\s/);
  });

  it('F5 · pre-migration 23505 on races_pkey still triggers the suffix retry', async () => {
    // Until the DDL runs, races_pkey (slug) coexists with the composite
    // unique index: a foreign-owned slug does not filter to rowCount 0, it
    // raises a unique violation. Both signals must reach the same retry.
    dispatch([uniqueViolation(), 1]);
    const res = await POST(raceReq() as never);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.slug).toBe(`city-half-2026-10-04-${USER8}`);
    expect(insertCalls().length).toBe(2);
  });

  it('F5b · a non-23505 database error still surfaces, never a silent retry', async () => {
    dispatch([Object.assign(new Error('connection terminated'), { code: '57P01' })]);
    const res = await POST(raceReq() as never);
    expect(res.status).toBe(500);
    expect(insertCalls().length).toBe(1);
  });

  it('F6 · course_library keeps its single-column ON CONFLICT (slug)', () => {
    const src = readFileSync(path.join(ROOT, 'lib', 'courses', 'promote-from-race.ts'), 'utf8');
    expect(src).toMatch(/INSERT INTO course_library[\s\S]*?ON CONFLICT \(slug\) DO NOTHING/);
  });
});
