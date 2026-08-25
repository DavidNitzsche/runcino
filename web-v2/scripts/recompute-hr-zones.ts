/**
 * recompute-hr-zones.ts · ZONE-BANDS-1 (2026-08-24)
 *
 * Re-derive every stored `runs.data.hrZonePcts` under the corrected Friel
 * bands, so history and new runs are one thing.
 *
 * The bands changed because they were wrong: two adjacent percent bounds were
 * rounded to bpm independently, which left 145, 153 and 161 in no zone at
 * LTHR 162, put 138 in two, floored zone 1 at 0 bpm and capped the top at
 * 1.10 x LTHR. See `lib/training/zones.ts#bandsFromPctEdges`. Rows written
 * under the old bands do not agree with rows written after it, and a chart
 * that means one thing in May and another in August is not a history.
 *
 * WHAT IT RECOMPUTES FROM, in order, and never further:
 *
 *   1. `data.phases[].hrSamples[].bpm` — the watch's 5-second HR. A real
 *      time-weighted distribution.
 *   2. `data.splits[]._raw.hrSamples` / `data.splits[].hrSamples` — the same
 *      thing where an older payload put it.
 *   3. `data.splits[].hr` — per-mile AVERAGES. Coarser, and the run's own
 *      measurement all the same. Flagged `per-mile-avg` in the report.
 *
 * A row with none of those is set to NULL. It is not recomputed from its own
 * stored percentages: a percentage re-bucketed from a percentage is not a
 * measurement, it is the old answer wearing a new label, and inventing one is
 * the exact defect this change exists to remove. NULL is the refusal, and
 * every read path already handles it (`reconcileHrZones`, then the render-time
 * derivation, then nothing).
 *
 * WHAT IT WILL NOT TOUCH:
 *
 *   · A row whose `hrZonePcts` is already NULL. That is not a stored
 *     distribution under the old bands, so there is nothing to bring forward,
 *     and writing one would be a BACKFILL — a different change, with its own
 *     decision to make (many such rows do have recomputable HR; the read path
 *     already derives them live, under the new bands, on every render). This
 *     script recomputes history; it does not create it.
 *   · `apple-review@faff.run` and the `qa-*@faff.run` accounts.
 *
 * Usage:
 *   node <bundle>            · dry run · prints the before/after table
 *   node <bundle> --apply    · writes
 *
 * The dry run writes the snapshot; `--apply` requires the snapshot to exist,
 * so the change always has an exact inverse before anything moves.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { computeZones, zoneIdxForBpm } from '@/lib/training/zones';
import { bucketHrSamplesByZone, hasHrSamples } from '@/lib/coach/hr-zone-bucket';
import { apportionToHundred } from '@/lib/runs/coherence';

type Pcts = { z1: number; z2: number; z3: number; z4: number; z5: number };

/** Accounts the recompute must never touch. */
const PROTECTED_EMAIL = /^(apple-review@faff\.run|qa-.*@faff\.run)$/i;

const SNAPSHOT = path.resolve(
  process.cwd(),
  '../docs/hr-zone-pcts-snapshot-2026-08-24.json',
);

interface Row {
  id: string;
  email: string | null;
  date: string | null;
  source: string | null;
  avgHr: number | null;
  lthr: number | null;
  stored: Pcts | null;
  hasStoredKey: boolean;
  phases: unknown;
  splits: unknown;
  splitHr: Array<number | null>;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

  const { rows } = await pool.query<Row>(`
    SELECT r.id::text                                    AS id,
           u.email                                       AS email,
           r.data->>'date'                               AS date,
           r.data->>'source'                             AS source,
           NULLIF(r.data->>'avgHr','')::numeric          AS "avgHr",
           p.lthr                                        AS lthr,
           CASE WHEN jsonb_typeof(r.data->'hrZonePcts')='object'
                THEN r.data->'hrZonePcts' END            AS stored,
           (r.data ? 'hrZonePcts')                       AS "hasStoredKey",
           r.data->'phases'                              AS phases,
           r.data->'splits'                              AS splits,
           COALESCE(
             (SELECT jsonb_agg(s->'hr')
                FROM jsonb_array_elements(COALESCE(r.data->'splits','[]'::jsonb)) s),
             '[]'::jsonb)                                AS "splitHr"
      FROM runs r
      LEFT JOIN users u ON u.id = r.user_uuid
      LEFT JOIN profile p ON p.user_uuid = r.user_uuid
     WHERE r.data ? 'hrZonePcts'
     ORDER BY r.data->>'date'
  `);

  // ── Snapshot · the exact inverse, written before anything moves ──────────
  if (!existsSync(SNAPSHOT)) {
    mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    writeFileSync(SNAPSHOT, JSON.stringify({
      takenAt: new Date().toISOString(),
      note: 'ZONE-BANDS-1 · pre-recompute values of runs.data.hrZonePcts. '
          + 'Restore with scripts/_restore_hr_zone_pcts.sql.',
      rows: rows.map((r) => ({
        runId: r.id, userEmail: r.email, date: r.date, source: r.source,
        hrZonePcts: r.stored,
      })),
    }, null, 2) + '\n');
    console.log(`snapshot written · ${rows.length} row(s) → ${SNAPSHOT}`);
  } else {
    console.log(`snapshot already present · ${SNAPSHOT}`);
  }
  if (apply && !existsSync(SNAPSHOT)) throw new Error('refusing to write with no snapshot');

  const report: string[] = [];
  let written = 0;
  let skippedNulls = 0;

  for (const r of rows) {
    if (r.email && PROTECTED_EMAIL.test(r.email)) {
      report.push(`SKIP  ${r.date} ${r.id}  protected account ${r.email}`);
      continue;
    }
    const lthr = r.lthr != null ? Number(r.lthr) : null;
    const table = lthr ? computeZones({ lthr }) : null;

    let next: Pcts | null = null;
    let basis = 'none';

    if (table) {
      // 1 & 2 · per-second samples, wherever the payload put them.
      for (const [src, label] of [[r.phases, 'phase-samples'], [r.splits, 'split-samples']] as const) {
        if (next) break;
        const arr = Array.isArray(src) ? src as Parameters<typeof bucketHrSamplesByZone>[0] : [];
        if (arr.length > 0 && hasHrSamples(arr)) {
          next = bucketHrSamplesByZone(arr, table);
          if (next) basis = label;
        }
      }
      // 3 · per-mile averages. Coarse, but measured.
      if (!next) {
        const counts = [0, 0, 0, 0, 0];
        let n = 0;
        for (const raw of (r.splitHr ?? [])) {
          const bpm = Number(raw);
          if (!Number.isFinite(bpm) || bpm < 40 || bpm > 230) continue;
          const idx = zoneIdxForBpm(bpm, table);
          if (idx == null) continue;
          counts[idx - 1]++; n++;
        }
        if (n > 0) {
          const share = apportionToHundred(counts);
          if (share) {
            next = { z1: share[0], z2: share[1], z3: share[2], z4: share[3], z5: share[4] };
            basis = 'per-mile-avg';
          }
        }
      }
    }

    // Only a row that HOLDS a distribution is in scope. A stored null is the
    // absence of one, and filling it is a backfill, not a recompute.
    if (!r.stored) {
      if (next) skippedNulls++;
      continue;
    }

    const before = fmt(r.stored);
    const after = next ? fmt(next) : 'null';
    const changed = before !== after;
    report.push(
      `${changed ? 'MOVE ' : 'same '} ${r.date}  ${(r.source ?? '').padEnd(12)}` +
      `avgHr ${String(r.avgHr ?? '-').padStart(3)}  ${before.padEnd(34)} → ${after.padEnd(34)}` +
      `  [${basis}]`,
    );

    if (apply && changed) {
      await pool.query(
        `UPDATE runs SET data = jsonb_set(data, '{hrZonePcts}', $2::jsonb, true) WHERE id = $1`,
        [r.id, JSON.stringify(next)],
      );
      written++;
    }
  }

  console.log('\n' + report.join('\n'));
  console.log(
    `\n${apply ? `WROTE ${written} row(s)` : 'DRY RUN · nothing written'} · ` +
    `${rows.length} row(s) examined · ${skippedNulls} row(s) hold NULL and were left alone ` +
    `(they have recomputable HR, but filling them is a backfill, not this change)`,
  );
  await pool.end();
}

function fmt(p: Pcts): string {
  return `z1 ${p.z1} · z2 ${p.z2} · z3 ${p.z3} · z4 ${p.z4} · z5 ${p.z5}`;
}

main().catch((e) => { console.error(e); process.exit(1); });
