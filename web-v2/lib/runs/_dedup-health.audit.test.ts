/**
 * lib/runs/_dedup-health.audit.test.ts · READ-ONLY dedup health check (2026-06-09).
 *
 * One-off diagnostic (leading `_`, gated on DATABASE_URL_RO so `npm test` skips it).
 * Opens its OWN faff_readonly pool — never the shared superuser pool, never writes.
 * Imports the REAL clusterRuns/pickCanonical/planMergeOps/isSameRun (zero logic drift)
 * so the numbers it reports ARE what volume.ts/merge.ts would produce.
 *
 * Answers the 2026-06-09 health-check questions for David's last 30 days:
 *   Q1 · canonical run count + total mileage + any duplicate (multi-row) clusters
 *   Q2 · dual-ingest dedup race: circular pairs, chained/dangling flags, and
 *        physical runs with >1 UNFLAGGED row (= multiple canonical-eligible rows)
 *   Q4 · avgHr chimera: how many rows carry a non-whole_run avgHr in the field the
 *        VDOT/quality gate reads, and would any clear the 85%·maxHR gate
 *
 * Run:  set -a; source .env.local; set +a; npx vitest run lib/runs/_dedup-health.audit.test.ts
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { clusterRuns, pickCanonical, planMergeOps, isTrustworthy, type RunRow } from './identity';

const RO = process.env.DATABASE_URL_RO;
const DAVID = process.env.AUDIT_USER_UUID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = process.env.AUDIT_TODAY ?? '2026-06-09';
const FROM = process.env.AUDIT_FROM ?? '2026-05-10'; // last 30 days
const TO = process.env.AUDIT_TO ?? TODAY;
const EFF_MAX = Number(process.env.AUDIT_EFF_MAX ?? 181); // David's resolved max HR (ledger)

const distMi = (r: RunRow): number => Number(r.data?.distanceMi ?? 0);
const durSec = (r: RunRow): number =>
  Number(r.data?.durationSec ?? r.data?.movingTimeS ?? r.data?.elapsedTimeS ?? 0);
const dayOf = (r: RunRow): string =>
  String(r.data?.date ?? String(r.data?.startLocal ?? '').slice(0, 10));
const src = (r: RunRow): string => String(r.data?.source ?? '?');
const mid = (r: RunRow): string | null =>
  r.data?.mergedIntoId != null ? String(r.data.mergedIntoId) : null;

function groupByDay(rows: RunRow[]): Map<string, RunRow[]> {
  const m = new Map<string, RunRow[]>();
  for (const r of rows) {
    const d = dayOf(r);
    if (!d) continue;
    (m.get(d) ?? m.set(d, []).get(d)!).push(r);
  }
  return m;
}

/* eslint-disable no-console */
describe.skipIf(!RO)('dedup health check · READ-ONLY (DATABASE_URL_RO)', () => {
  const pool = new Pool({ connectionString: RO, ssl: { rejectUnauthorized: false }, max: 2 });
  let rows: RunRow[] = [];

  it('connects as faff_readonly (RO guard)', async () => {
    const who = (await pool.query('SELECT current_user')).rows[0].current_user;
    const when = (await pool.query(
      `SELECT to_char(now() AT TIME ZONE 'America/Los_Angeles','YYYY-MM-DD HH24:MI:SS') AS t`,
    )).rows[0].t;
    console.log(`\n[audit] connected as: ${who}  · server wall-clock (PT): ${when}`);
    console.log(`[audit] user ${DAVID.slice(0, 8)} · window ${FROM}..${TO} · effMaxHr=${EFF_MAX}`);
    expect(who).toBe('faff_readonly');
  });

  it('loads the window UNFILTERED (one query, reused)', async () => {
    rows = (await pool.query(
      `SELECT id::text AS id, user_uuid::text AS user_uuid, data
         FROM runs
        WHERE user_uuid = $1
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3`,
      [DAVID, FROM, TO],
    )).rows as RunRow[];
    console.log(`[audit] raw rows in window: ${rows.length}`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('Q1 · canonical run count + total mileage + duplicate rows', () => {
    const byDay = groupByDay(rows);
    let canonMi = 0, canonRuns = 0;
    let fragileMi = 0, fragileRuns = 0;
    const dupes: string[] = [];

    for (const day of [...byDay.keys()].sort()) {
      const dr = byDay.get(day)!;
      // Canonical identity reader (flags IGNORED — true physical-run dedup).
      for (const c of clusterRuns(dr)) {
        const { canonical } = pickCanonical(c);
        canonMi += distMi(canonical);
        canonRuns++;
        if (c.length > 1) {
          dupes.push(
            `  ${day}  ${c.length} rows → canonical=${src(canonical)} ${distMi(canonical).toFixed(2)}mi  ` +
            `[${c.map((r) => `${src(r)}:${distMi(r).toFixed(2)}mi/${Math.round(durSec(r))}s${mid(r) ? `→merged` : `·UNFLAGGED`}`).join(', ')}]`,
          );
        }
      }
      // Fragile reader (what a NOT-mergedIntoId SQL filter sees today).
      const visible = dr.filter((r) => mid(r) == null);
      for (const c of clusterRuns(visible)) {
        fragileMi += distMi(pickCanonical(c).canonical);
        fragileRuns++;
      }
    }

    console.log(`\n=== Q1 · last-30d volume (David) ===`);
    console.log(`  canonical (identity reader):  ${canonRuns} runs · ${canonMi.toFixed(2)} mi`);
    console.log(`  fragile (NOT mergedIntoId):   ${fragileRuns} runs · ${fragileMi.toFixed(2)} mi`);
    console.log(`  agreement: ${canonRuns === fragileRuns && Math.abs(canonMi - fragileMi) < 0.05 ? 'IDENTICAL ✓' : `DIVERGENT — Δruns=${fragileRuns - canonRuns} Δmi=${(fragileMi - canonMi).toFixed(2)}`}`);
    console.log(`  multi-row physical-run clusters (duplicates): ${dupes.length}`);
    if (dupes.length) console.log(dupes.join('\n'));
    // Health invariant: the fragile reader must never exceed the canonical reader
    // (it can only under-count via over-merge, never over-count, if flags are sane).
    expect(fragileMi).toBeLessThanOrEqual(canonMi + 0.05);
  });

  it('Q2 · dual-ingest race · circular / chained / unflagged-multi-canonical', () => {
    // (a) circular pairs A→B AND B→A
    const target = new Map(rows.map((r) => [r.id, mid(r)] as const));
    const cycles: string[] = [];
    for (const [id, into] of target) {
      if (into && target.get(into) === id && id < into) cycles.push(`${id}↔${into}`);
    }

    // (b) chained (loser→loser) and dangling (target not in window) flags
    const chained: string[] = [];
    const dangling: string[] = [];
    for (const [id, into] of target) {
      if (!into) continue;
      if (!target.has(into)) { dangling.push(`${id}→${into} (target out of window)`); continue; }
      if (target.get(into) != null) chained.push(`${id}→${into}→${target.get(into)}`);
    }

    // (c) physical runs with >1 UNFLAGGED row = multiple canonical-eligible rows
    //     for one run = the dual-ingest double-count window.
    const byDay = groupByDay(rows);
    const multiCanonical: string[] = [];
    for (const day of [...byDay.keys()].sort()) {
      for (const c of clusterRuns(byDay.get(day)!)) {
        const unflagged = c.filter((r) => mid(r) == null);
        if (unflagged.length > 1) {
          multiCanonical.push(
            `  ${day}  ${unflagged.length} unflagged rows for one run: ` +
            `[${unflagged.map((r) => `${src(r)}:${distMi(r).toFixed(2)}mi`).join(', ')}]`,
          );
        }
      }
    }

    // (d) would the write-time invariant propose any repair right now?
    let clears = 0, sets = 0;
    for (const day of byDay.keys()) {
      const ops = planMergeOps(byDay.get(day)!);
      clears += ops.clears.length;
      sets += ops.sets.length;
    }

    console.log(`\n=== Q2 · dedup-race integrity ===`);
    console.log(`  circular pairs (A↔B):              ${cycles.length ? cycles.join(', ') : '(none) ✓'}`);
    console.log(`  chained flags (loser→loser):       ${chained.length ? chained.join(', ') : '(none) ✓'}`);
    console.log(`  dangling flags (target gone):      ${dangling.length ? dangling.join(' | ') : '(none) ✓'}`);
    console.log(`  multi-canonical (unflagged dupes): ${multiCanonical.length || '(none) ✓'}`);
    if (multiCanonical.length) console.log(multiCanonical.join('\n'));
    console.log(`  planMergeOps proposes: ${clears} clears + ${sets} sets ${clears + sets === 0 ? '→ CLEAN ✓' : '→ REPAIR NEEDED'}`);

    expect(cycles.length).toBe(0); // circular merge (CRITICAL #4) must be absent
  });

  it('Q1b · forensics on every flagged row vs its target (stale vs real)', async () => {
    const { isSameRun } = await import('./identity');
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const flagged = rows.filter((r) => mid(r) != null);
    const byDay = groupByDay(rows);
    const daySizeOf = (r: RunRow): number => {
      const dr = byDay.get(dayOf(r)) ?? [];
      for (const c of clusterRuns(dr)) if (c.some((x) => x.id === r.id)) return c.length;
      return 1;
    };

    let staleFlags = 0, consistentFlags = 0;
    const detail: string[] = [];
    for (const a of flagged) {
      const b = byId.get(mid(a)!);
      const clusterSize = daySizeOf(a);
      const same = b ? isSameRun(a, b) : false;
      // A flag is "consistent" when A actually clusters with its target B (size>1
      // and isSameRun true). A flag on a SINGLETON whose target doesn't cluster
      // with it is STALE (planMergeOps would clear it).
      const isStale = clusterSize === 1;
      if (isStale) staleFlags++; else consistentFlags++;
      detail.push(
        `  ${dayOf(a)} ${src(a)} ${distMi(a).toFixed(2)}mi/${Math.round(durSec(a))}s → ` +
        `${b ? `${src(b)} ${distMi(b).toFixed(2)}mi/${Math.round(durSec(b))}s [${dayOf(b)}]` : 'MISSING'} · ` +
        `isSameRun=${same} · A-clusterSize=${clusterSize} · ${isStale ? 'STALE (singleton)' : 'consistent'}`,
      );
    }
    console.log(`\n=== Q1b · flagged-row forensics ===`);
    console.log(`  total flagged rows in window: ${flagged.length}`);
    console.log(`  consistent (A clusters with target): ${consistentFlags}`);
    console.log(`  STALE (A is a singleton, flag orphaned): ${staleFlags}`);
    console.log(detail.join('\n'));
  });

  it('Q1c · root-cause the stale pairs (timestamp frame mismatch)', async () => {
    const { isSameRun } = await import('./identity');
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const byDay = groupByDay(rows);
    const isSingleton = (r: RunRow): boolean => {
      const dr = byDay.get(dayOf(r)) ?? [];
      for (const c of clusterRuns(dr)) if (c.some((x) => x.id === r.id)) return c.length === 1;
      return true;
    };
    const fmt = (r: RunRow): string =>
      `${src(r)} startLocal=${JSON.stringify(r.data?.startLocal ?? null)} tz=${JSON.stringify(r.data?.timezone ?? null)} trust=${isTrustworthy(r)}`;

    console.log(`\n=== Q1c · stale-pair timestamp forensics ===`);
    const seen = new Set<string>();
    for (const a of rows.filter((r) => mid(r) != null && isSingleton(r))) {
      const b = byId.get(mid(a)!);
      if (!b) continue;
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  ${dayOf(a)} ${distMi(a).toFixed(2)}mi  isSameRun=${isSameRun(a, b)}`);
      console.log(`    A: ${fmt(a)}`);
      console.log(`    B: ${fmt(b)}`);
    }
  });

  it('Q4 · avgHr chimera in the VDOT/quality-gate field', () => {
    const present = rows.filter((r) => r.data?.avgHr != null);
    const kind = (r: RunRow): string => String(r.data?.avgHrKind ?? '(unlabeled)');
    const tally = new Map<string, number>();
    for (const r of present) tally.set(kind(r), (tally.get(kind(r)) ?? 0) + 1);

    // Chimera risk: a non-whole_run value sitting in `avgHr` (the field the
    // gate reads), AND it clears the 85%·maxHR threshold → would falsely
    // count as a whole-run quality/VDOT signal.
    const gate = Math.round(EFF_MAX * 0.85);
    const riskRows = present.filter(
      (r) => kind(r) !== 'whole_run' && Number(r.data?.avgHr) >= gate,
    );
    // Watch rows where the two HR definitions actually diverge.
    const diverge = present.filter(
      (r) => r.data?.avgHrRaw != null && Number(r.data.avgHr) !== Number(r.data.avgHrRaw),
    );

    console.log(`\n=== Q4 · avgHr chimera (gate = 85%·${EFF_MAX} = ${gate}bpm) ===`);
    console.log(`  rows with avgHr present: ${present.length}`);
    console.log(`  avgHrKind tally: ${[...tally].map(([k, n]) => `${k}=${n}`).join(' · ')}`);
    console.log(`  whole_run vs work_weighted divergence (watch): ${diverge.length}`);
    for (const r of diverge) {
      console.log(`    ${dayOf(r)} ${src(r)}: avgHr=${r.data.avgHr} (whole) vs avgHrRaw=${r.data.avgHrRaw} (work) · kind=${kind(r)}`);
    }
    console.log(`  CHIMERA-RISK rows (non-whole_run avgHr ≥ ${gate}, gate-readable): ${riskRows.length}`);
    for (const r of riskRows) {
      console.log(`    ${dayOf(r)} ${src(r)}: avgHr=${r.data.avgHr} kind=${kind(r)} dist=${distMi(r).toFixed(2)}mi trustworthy=${isTrustworthy(r)}`);
    }
  });
});
/* eslint-enable no-console */
