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
 *   2 · List every instant each row's stored startLocal COULD mean — one for a
 *       bare wall clock or an explicit offset, two for a `Z` (as UTC, or as a
 *       wall clock wearing a Z).
 *   3 · Keep the instants EVERY row in the group can mean. One run has one
 *       start, so exactly one should survive. That is the answer.
 *   4 · Groups where none or several survive are SKIPPED and listed with the
 *       reason, not guessed. Two rows carrying the identical string are the
 *       common case: nothing in the data distinguishes their readings.
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

        // CONSENSUS. Every row in the group describes ONE run, so exactly one
        // instant should be readable from all of them. Take each row's
        // candidate readings, keep the instants every row can produce, and
        // require that exactly one survives.
        //
        // This is strictly stronger than anchoring on a device row, and it is
        // what makes the `apple_health` pairs decidable: on 2026-05-15 the
        // null-source row reads 12:11:34Z (either 12:11 UTC or 12:11 Pacific)
        // and the apple_health row reads 19:11:34Z (either 19:11 UTC or 19:11
        // Pacific). The only instant both can mean is 19:11:34Z. Neither row's
        // SOURCE says which convention it used — which is exactly why the
        // per-source strip in 846f3509 had to be reverted — but the pair says.
        //
        // Two rows carrying the IDENTICAL string produce identical candidate
        // sets, so two instants survive and the group is correctly refused:
        // nothing in the data distinguishes the readings.
        const perRow = group.map((r) => ({ r, cands: candidates(r, TZ) }));
        if (perRow.some((x) => x.cands.length === 0)) {
          skipped.push(`${day} group=${key} · a row has no readable start · ${group.map((r) => `${r.id}/${src(r) || 'null'}/${r.data?.startLocal}`).join(' ')}`);
          continue;
        }
        const consensus = perRow[0].cands.filter((c) =>
          perRow.every((x) => x.cands.some((o) => Math.abs(o.ms - c.ms) <= TOLERANCE_MS)));
        // Collapse near-duplicates so a pair minutes apart counts once.
        const distinct: number[] = [];
        for (const c of consensus) {
          if (!distinct.some((m) => Math.abs(m - c.ms) <= TOLERANCE_MS)) distinct.push(c.ms);
        }
        if (distinct.length !== 1) {
          const why = distinct.length === 0
            ? 'no instant every row can mean'
            : `${distinct.length} instants every row can mean · nothing in the data picks between them`;
          skipped.push(`${day} group=${key} · ${why} · ${group.map((r) => `${r.id}/${src(r) || 'null'}/${r.data?.startLocal}`).join(' ')}`);
          continue;
        }
        const agreed = distinct[0];
        // Prefer a device-stamped bare wall clock as the reported witness when
        // one is present — it is the reading a human can check against.
        const witness = perRow.find((x) => DEVICE_LOCAL.has(src(x.r))
          && x.cands.some((c) => Math.abs(c.ms - agreed) <= TOLERANCE_MS && c.reading === 'bare-wall-clock'));
        for (const { r, cands } of perRow) {
          const fit = cands.find((c) => Math.abs(c.ms - agreed) <= TOLERANCE_MS)!;
          proposedForDay.set(r.id, {
            iso: new Date(agreed).toISOString(),
            reading: fit.reading + (witness ? ` · agrees with ${src(witness.r)} ${witness.r.id}` : ' · group consensus'),
          });
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
