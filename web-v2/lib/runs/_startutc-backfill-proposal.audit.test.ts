/**
 * lib/runs/_startutc-backfill-proposal.audit.test.ts · READ-ONLY. Writes nothing.
 *
 * Emits the exact UPDATE statements that would give every legacy run row an
 * absolute `data.startUtc`, for David to approve or refuse. Gated on
 * DATABASE_URL_RO, leading `_`, so `npm test` skips it.
 *
 * WHY THIS AND NOT A SOURCE-STRIP RULE
 *
 * `16281282` reverted a per-source Z-strip, and the revert message says exactly
 * why it cannot work: the same source used BOTH conventions for the same run.
 * On 2026-05-22 two `apple_health` rows describe one 7.78 mi run — one reads
 * `10:00:31Z` (a Pacific wall clock wearing a Z) and the other `17:00:31Z` (the
 * true UTC instant). No rule keyed on `source` can mean both "strip" and
 * "trust". The revert logged the real fix: canonicalize every startLocal to a
 * true UTC instant, after which Z is uniformly trustworthy.
 *
 * THE DECISION PROCEDURE
 *
 * Per source is undecidable. Per CLUSTER is not. Each affected day already
 * holds a row whose convention is unambiguous — a bare wall clock from the
 * device that recorded the run — and the existing `mergedIntoId` flags already
 * record which rows are the same run (those groupings are what the day totals
 * are computed from today, and David confirmed two of them by hand).
 *
 *   1 · Group the day's rows by the mergedIntoId flags already on them.
 *   2 · In each group find an ANCHOR: a bare-wall-clock row from a device
 *       source. Its instant is that wall clock read in the runner's zone.
 *   3 · For every other row in the group, test its two candidate readings
 *       (Z-as-UTC, Z-as-local) against the anchor. Exactly one lands within
 *       15 minutes → that is its true instant.
 *   4 · Ambiguous or anchorless groups are SKIPPED and listed, not guessed.
 *
 * WHAT IT BUYS
 *
 * Those groupings are currently frozen: the engine no longer agrees with them,
 * so a re-merge pass over any of the eight affected days would UNDO the merge
 * and double the day. Measured: +49.64 mi across seven days. Stamping the
 * instant makes the engine re-derive the same grouping the flags already hold,
 * so the day stops depending on nobody ever touching it again.
 *
 * Run:  npx vitest run --root web-v2 lib/runs/_startutc-backfill-proposal.audit.test.ts \
 *         --silent=false --disable-console-intercept
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { clusterRuns, planMergeOps, type RunRow } from './identity';

function roUrl(): string | undefined {
  if (process.env.DATABASE_URL_RO) return process.env.DATABASE_URL_RO;
  for (const f of ['.env.audit.local', '.env.local', 'web-v2/.env.audit.local', 'web-v2/.env.local']) {
    try {
      const m = /^DATABASE_URL_RO=(.+)$/m.exec(readFileSync(f, 'utf8'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* next */ }
  }
  return undefined;
}
const RO = roUrl();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TZ = 'America/Los_Angeles';
const TOLERANCE_MS = 15 * 60 * 1000;

/** Sources that write a wall clock stamped by the device that recorded the run. */
const DEVICE_LOCAL = new Set(['apple_watch', 'watch', 'treadmill', 'manual']);

const dayOf = (r: RunRow) => String(r.data?.date ?? String(r.data?.startLocal ?? '').slice(0, 10));
const src = (r: RunRow) => String(r.data?.source ?? '');
const mid = (r: RunRow) => (r.data?.mergedIntoId != null ? String(r.data.mergedIntoId) : null);
const distMi = (r: RunRow) => Number(r.data?.distanceMi ?? 0);

function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

/** A bare wall clock, read in `tz`, as an absolute instant. */
function wallInTz(wall: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(wall);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  return guess - tzOffsetMs(guess, tz);
}

/** Every instant this row's stored startLocal could mean, with a label. */
function candidates(r: RunRow, tz: string): Array<{ ms: number; reading: string }> {
  const s = String(r.data?.startLocal ?? '');
  if (!s) return [];
  if (/[+-]\d{2}:?\d{2}$/.test(s)) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? [{ ms, reading: 'explicit-offset' }] : [];
  }
  if (s.endsWith('Z')) {
    const asUtc = Date.parse(s);
    const asLocal = wallInTz(s.slice(0, -1), tz);
    const out: Array<{ ms: number; reading: string }> = [];
    if (Number.isFinite(asUtc)) out.push({ ms: asUtc, reading: 'Z-as-true-UTC' });
    if (asLocal != null && asLocal !== asUtc) out.push({ ms: asLocal, reading: 'Z-as-local-wall-clock' });
    return out;
  }
  const ms = wallInTz(s, tz);
  return ms != null ? [{ ms, reading: 'bare-wall-clock' }] : [];
}

/* eslint-disable no-console */
describe.skipIf(!RO)('startUtc backfill proposal · READ-ONLY', () => {
  const pool = new Pool({ connectionString: RO, ssl: { rejectUnauthorized: false }, max: 2 });

  it('emits UPDATE statements, and proves each one settles its day', async () => {
    expect((await pool.query('SELECT current_user')).rows[0].current_user).toBe('faff_readonly');
    const rows = (await pool.query(
      `SELECT id::text AS id, user_uuid::text AS user_uuid, data
         FROM runs WHERE user_uuid = $1 ORDER BY id`, [DAVID])).rows as RunRow[];

    const byDay = new Map<string, RunRow[]>();
    for (const r of rows) { const d = dayOf(r); if (!d) continue; (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r); }

    const statements: string[] = [];
    const skipped: string[] = [];
    let daysSettled = 0, daysStillPending = 0;

    for (const [day, drows] of [...byDay].sort()) {
      // Group by the flags already on the rows: a canonical plus everything
      // pointing at it. A row that points at a canonical on another day, or at
      // nothing, forms its own group.
      const groups = new Map<string, RunRow[]>();
      for (const r of drows) {
        const key = mid(r) ?? r.id;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
      }

      const proposedForDay = new Map<string, { iso: string; reading: string }>();
      for (const [key, group] of groups) {
        if (group.length < 2) continue;   // nothing to reconcile
        const anchor = group.find((r) => {
          const c = candidates(r, TZ);
          return c.length === 1 && c[0].reading === 'bare-wall-clock' && DEVICE_LOCAL.has(src(r));
        });
        if (!anchor) {
          skipped.push(`${day} group=${key} · no unambiguous device anchor · ${group.map((r) => `${r.id}/${src(r) || 'null'}/${r.data?.startLocal}`).join(' ')}`);
          continue;
        }
        const anchorMs = candidates(anchor, TZ)[0].ms;
        for (const r of group) {
          const cands = candidates(r, TZ);
          const fits = cands.filter((c) => Math.abs(c.ms - anchorMs) <= TOLERANCE_MS);
          if (fits.length !== 1) {
            skipped.push(`${day} row=${r.id}/${src(r) || 'null'}/${r.data?.startLocal} · ${fits.length} candidate readings fit the anchor · not proposed`);
            continue;
          }
          proposedForDay.set(r.id, { iso: new Date(fits[0].ms).toISOString(), reading: fits[0].reading });
        }
      }
      if (proposedForDay.size === 0) continue;

      // Prove it: re-run the merge planner over the day WITH the proposed
      // instants and confirm the flags the rows already carry become the flags
      // the engine derives. A day that still disagrees is reported, not shipped.
      const patched = drows.map((r) => {
        const p = proposedForDay.get(r.id);
        return p ? { ...r, data: { ...r.data, startUtc: p.iso } } : r;
      });
      const before = planMergeOps(drows, TZ);
      const after = planMergeOps(patched, TZ);
      const settles = after.clears.length === 0 && after.sets.length === 0;
      const wasPending = before.clears.length > 0 || before.sets.length > 0;
      if (settles) daysSettled++; else daysStillPending++;

      const liveMi = drows.filter((r) => mid(r) == null).reduce((s, r) => s + distMi(r), 0);
      const afterMi = clusterRuns(patched.filter((r) => mid(r) == null), TZ)
        .reduce((s, c) => s + Math.max(...c.map(distMi)), 0);

      console.log(
        `\n-- ${day} · ${drows.length} rows · was ${wasPending ? 'PENDING' : 'settled'} · ` +
        `after backfill: ${settles ? 'SETTLED' : 'STILL DISAGREES'} · ` +
        `visible mileage ${liveMi.toFixed(2)} -> ${afterMi.toFixed(2)}`,
      );
      for (const [id, p] of proposedForDay) {
        const r = drows.find((x) => x.id === id)!;
        console.log(`--   ${id} ${src(r) || 'null-source'} ${r.data?.startLocal} read as ${p.reading}`);
        statements.push(
          `UPDATE runs SET data = jsonb_set(data, '{startUtc}', to_jsonb('${p.iso}'::text)) ` +
          `WHERE id = ${id} AND user_uuid = '${DAVID}' AND NOT (data ? 'startUtc');`,
        );
      }
    }

    console.log(`\n${'='.repeat(78)}`);
    console.log(`-- PROPOSED BACKFILL · ${statements.length} statements · ${daysSettled} days settle, ${daysStillPending} still disagree`);
    console.log(`-- Additive: sets one new key, only on rows that do not already have it. Reversible with:`);
    console.log(`--   UPDATE runs SET data = data - 'startUtc' WHERE user_uuid = '${DAVID}';`);
    console.log('='.repeat(78));
    for (const s of statements) console.log(s);
    if (skipped.length) {
      console.log(`\n-- NOT PROPOSED (${skipped.length}) · left alone rather than guessed:`);
      for (const s of skipped) console.log(`--   ${s}`);
    }

    await pool.end();
  }, 120000);
});
