/**
 * lib/runs/_absorption_invariant.test.ts · the two loser markers agree, or the
 * build says so.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FAILURE THIS EXISTS FOR
 *
 * A row that lost a dedup carries both `data->>'mergedIntoId'` and
 * `absorbed_into_canonical_at`. Seven of the owner's runs carried the SECOND
 * without the FIRST, and were the canonical row for their day — their own
 * duplicates pointing correctly at them — while holding a loser's stamp.
 *
 *   2026-06-14  13.13 mi     2026-07-07   7.56 mi     2026-08-10   4.02 mi
 *   2026-06-19   6.45 mi     2026-07-25  18.00 mi     2026-08-26   7.78 mi
 *   2026-07-06   6.01 mi
 *
 * 63.0 miles over ten weeks, the 18.00 almost certainly his peak long run, on
 * the eve of a 14-week marathon block that sizes itself from recent weekly
 * volume and peak long run.
 *
 * Three separate things had to be true for it to last that long, and this file
 * covers all three:
 *
 *   1 · the WRITER could mint it — `enhanceCanonicalFromAbsorbed` stamped on
 *       "is it already stamped?" and nothing else, so a merge pass working
 *       from a stale plan could stamp a row a fresher pass had just promoted.
 *   2 · the REPAIR could not see it — `planMergeOps` decided whether to clear
 *       a canonical by reading the pointer alone, so a row holding only the
 *       stamp was never in `clears`. The nightly sweep ran over these days
 *       inside its own 14-day window and fixed none of them.
 *   3 · no DETECTOR was looking — `flag-census.ts` counts pointers, and the
 *       count does not move when a stamp goes stale.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  absorptionViolations,
  absorptionAlertMessage,
  type AbsorptionRow,
} from './absorption-invariant';
import { mayStampAbsorbed, STAMP_ABSORBED_SQL } from './canonical';
import { planMergeOps, type RunRow } from './identity';
import { preserveMergedIntoIdSql, runMergedIntoIdSql, runNotMergedSql } from './run-shape';

const TZ = 'America/Los_Angeles';

/* ══════════════════════════════════════════════════════════════════════════
 * THE PRODUCTION SHAPE · 2026-07-25, byte for byte
 *
 * Three rows, one 18.00 mi run. The two duplicates point at the watch row; the
 * watch row is the canonical AND is stamped absorbed.
 * ═══════════════════════════════════════════════════════════════════════ */
const CANON = '-254892999381071';
const DUP_STRAVA = '19461601237';
const DUP_HK = '-375579766909448';

function prodShape(): AbsorptionRow[] {
  return [
    { id: DUP_STRAVA, day: '2026-07-25', mergedIntoId: CANON, absorbedAt: '2026-07-26 11:17:51', distanceMi: 18.0 },
    { id: DUP_HK, day: '2026-07-25', mergedIntoId: CANON, absorbedAt: '2026-07-25 23:30:14', distanceMi: 18.0 },
    // The bug: canonical, no pointer, stamped anyway.
    { id: CANON, day: '2026-07-25', mergedIntoId: null, absorbedAt: '2026-07-25 23:30:14', distanceMi: 18.0 },
  ];
}

describe('the orphan stamp · the exact production shape is a finding', () => {
  it('two dups pointing at a canonical that is itself stamped → violation', () => {
    const v = absorptionViolations(prodShape());

    // The orphan itself.
    const orphan = v.filter((x) => x.kind === 'stamp_without_pointer');
    expect(orphan).toHaveLength(1);
    expect(orphan[0].id).toBe(CANON);
    expect(orphan[0].day).toBe('2026-07-25');
    expect(orphan[0].distanceMi).toBe(18.0);

    // ... and both duplicates, because each of them records a loss to a row
    // that is itself marked as having lost. The three findings are one fact
    // told from three rows, which is what makes the day legible in the alert.
    expect(v.filter((x) => x.kind === 'pointer_to_loser').map((x) => x.id).sort())
      .toEqual([DUP_HK, DUP_STRAVA].sort());
    expect(v).toHaveLength(3);

    // The day still HAS a survivor — this is not the zeroed-day shape. That is
    // exactly what made it so quiet: canonical reads return the run, so nothing
    // looked broken, while the row carried a marker no repair could clear.
    expect(v.some((x) => x.kind === 'day_without_survivor')).toBe(false);
  });

  it('the same day with the stamp cleared is clean', () => {
    const healed = prodShape().map((r) => (r.id === CANON ? { ...r, absorbedAt: null } : r));
    expect(absorptionViolations(healed)).toEqual([]);
  });

  it('a normal absorbed loser is NOT a finding · the check must not cry wolf', () => {
    // The overwhelmingly common row: pointer + stamp, target clean.
    const ordinary: AbsorptionRow[] = [
      { id: 'A', day: '2026-08-01', mergedIntoId: null, absorbedAt: null, distanceMi: 6 },
      { id: 'B', day: '2026-08-01', mergedIntoId: 'A', absorbedAt: '2026-08-01 10:00:00', distanceMi: 6 },
    ];
    expect(absorptionViolations(ordinary)).toEqual([]);
  });

  it('a loser that has not been absorbed YET is not a finding either', () => {
    // Between merge.ts's `sets` loop and its absorber loop, a row legitimately
    // holds the pointer with no stamp. Flagging that would fire on every merge.
    const midPass: AbsorptionRow[] = [
      { id: 'A', day: '2026-08-01', mergedIntoId: null, absorbedAt: null, distanceMi: 6 },
      { id: 'B', day: '2026-08-01', mergedIntoId: 'A', absorbedAt: null, distanceMi: 6 },
    ];
    expect(absorptionViolations(midPass)).toEqual([]);
  });

  it('a chain — absorbed into a row that is itself absorbed — is a finding', () => {
    const chained: AbsorptionRow[] = [
      { id: 'A', day: '2026-08-01', mergedIntoId: 'B', absorbedAt: '2026-08-01 10:00:00', distanceMi: 6 },
      { id: 'B', day: '2026-08-01', mergedIntoId: 'C', absorbedAt: '2026-08-01 10:00:00', distanceMi: 6 },
      { id: 'C', day: '2026-08-01', mergedIntoId: null, absorbedAt: null, distanceMi: 6 },
    ];
    const kinds = absorptionViolations(chained).map((v) => v.kind);
    expect(kinds).toContain('pointer_to_loser');
  });

  it('a day with rows and no canonical survivor reads zero and is a finding', () => {
    // The circular A↔B pair. Both point, neither survives, every canonical read
    // of the day returns nothing at all.
    const circular: AbsorptionRow[] = [
      { id: 'A', day: '2026-08-02', mergedIntoId: 'B', absorbedAt: '2026-08-02 10:00:00', distanceMi: 12.4 },
      { id: 'B', day: '2026-08-02', mergedIntoId: 'A', absorbedAt: '2026-08-02 10:00:00', distanceMi: 12.4 },
    ];
    const v = absorptionViolations(circular);
    expect(v.map((x) => x.kind)).toContain('day_without_survivor');
    expect(v.find((x) => x.kind === 'day_without_survivor')!.distanceMi).toBe(12.4);
  });

  it('a dangling pointer is a finding · the target row is gone', () => {
    const dangling: AbsorptionRow[] = [
      { id: 'A', day: '2026-08-03', mergedIntoId: null, absorbedAt: null, distanceMi: 5 },
      { id: 'B', day: '2026-08-03', mergedIntoId: 'GONE', absorbedAt: '2026-08-03 10:00:00', distanceMi: 5 },
    ];
    expect(absorptionViolations(dangling).map((v) => v.kind)).toEqual(['pointer_dangling']);
  });

  it('the alert names the miles and the day · a person must be able to act on it', () => {
    const msg = absorptionAlertMessage({
      userUuid: '0645f40c-951d-4ccc-b86e-9979cd26c795',
      rowsChecked: 153,
      violations: absorptionViolations(prodShape()),
      milesAtRisk: 18.0,
    });
    expect(msg).toContain('2026-07-25');
    expect(msg).toContain('18 mi at risk');
    expect(msg).toContain('stamp_without_pointer');
  });

  it('a clean audit produces no alert at all', () => {
    expect(absorptionAlertMessage({
      userUuid: 'x', rowsChecked: 10, violations: [], milesAtRisk: 0,
    })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE WRITER · a stamp the committed state does not entitle it to
 * ═══════════════════════════════════════════════════════════════════════ */
describe('mayStampAbsorbed · the guard at the write site', () => {
  const base = {
    loserMergedIntoId: CANON,
    loserAbsorbedAt: null,
    canonicalId: CANON,
    canonicalMergedIntoId: null,
    canonicalAbsorbedAt: null,
  };

  it('allows the ordinary absorption', () => {
    expect(mayStampAbsorbed(base)).toEqual({ allow: true });
  });

  it('REFUSES the exact race that minted the orphan', () => {
    // The interleaving: a stale pass planned "R is the loser", a fresher pass
    // then promoted R and stripped both markers, and the stale pass arrives
    // here with its last statement. Pre-fix this wrote the stamp, because the
    // only question asked was "is it already stamped?" — and it was not.
    const v = mayStampAbsorbed({ ...base, loserMergedIntoId: null });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.benign).toBe(false);
    expect(v.allow === false && v.reason).toMatch(/no mergedIntoId/);
  });

  it('REFUSES a stamp for a loser that now points somewhere else', () => {
    const v = mayStampAbsorbed({ ...base, loserMergedIntoId: 'OTHER' });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.benign).toBe(false);
  });

  it('REFUSES a stamp recording a loss to a row that has itself lost', () => {
    const v = mayStampAbsorbed({ ...base, canonicalMergedIntoId: 'SOMEONE' });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.benign).toBe(false);
  });

  it('REFUSES a stamp recording a loss to a row that is itself absorbed', () => {
    const v = mayStampAbsorbed({ ...base, canonicalAbsorbedAt: '2026-07-25 23:30:14' });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.benign).toBe(false);
  });

  it('an already-stamped row is a BENIGN refusal · re-running a pass is normal', () => {
    const v = mayStampAbsorbed({ ...base, loserAbsorbedAt: '2026-07-25 23:30:14' });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.benign).toBe(true);
  });

  it('the pointer comparison is string-tolerant · legacy rows wrote it as text', () => {
    expect(mayStampAbsorbed({ ...base, loserMergedIntoId: String(CANON) }).allow).toBe(true);
  });

  it('the SQL carries every condition the predicate does', () => {
    // The predicate is the testable statement of the rule; the SQL is what
    // actually runs. If they drift, the tests above stop describing production.
    const sql = STAMP_ABSORBED_SQL.replace(/\s+/g, ' ');
    expect(sql).toContain('l.absorbed_into_canonical_at IS NULL');
    expect(sql).toContain(`${runMergedIntoIdSql('l')} = c.id::text`);
    expect(sql).toContain(runNotMergedSql('c'));
    expect(sql).toContain('c.absorbed_into_canonical_at IS NULL');
  });

  it('the stamp column has exactly ONE writer in the whole app', () => {
    // The guard is only worth having if nothing can route around it. Any other
    // `SET absorbed_into_canonical_at = <something>` is a second writer and a
    // second chance to mint the orphan. merge.ts's `= NULL` (the clear) is the
    // one legitimate other spelling.
    const WEB = path.resolve(__dirname, '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '.next') continue;
          walk(p);
        } else if (/\.tsx?$/.test(e.name) && !e.name.startsWith('._') && !/\.test\.tsx?$/.test(e.name)) {
          const src = readFileSync(p, 'utf8');
          for (const m of src.matchAll(/SET\s+absorbed_into_canonical_at\s*=\s*([A-Za-z()]+)/gi)) {
            const rel = path.relative(WEB, p).split(path.sep).join('/');
            const isTheClear = /^NULL$/i.test(m[1]);
            if (isTheClear && rel === 'lib/runs/merge.ts') continue;
            if (!isTheClear && rel === 'lib/runs/canonical.ts') continue;
            offenders.push(`${rel} · SET absorbed_into_canonical_at = ${m[1]}`);
          }
        }
      }
    };
    for (const r of ['lib', 'app', 'components']) walk(path.join(WEB, r));
    expect(offenders,
      'a second writer of the absorption stamp. The stamp is only safe because '
      + 'STAMP_ABSORBED_SQL in lib/runs/canonical.ts is the only thing that sets '
      + 'it, under the invariant in mayStampAbsorbed. Route the write through '
      + 'there, or the orphan comes back.',
    ).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE REPAIR · the sweep can now SEE a stamp-only orphan
 * ═══════════════════════════════════════════════════════════════════════ */
describe('planMergeOps · the repair reaches a stamp-only orphan', () => {
  /** The 2026-07-25 trio as merge.ts loads them, post-fix (stamp selected). */
  function rows(canonAbsorbedAt: string | null): RunRow[] {
    const common = { user_uuid: 'u1' };
    return [
      {
        ...common, id: DUP_STRAVA,
        data: {
          source: 'strava', date: '2026-07-25', startLocal: '2026-07-25T06:21:40Z',
          startUtc: '2026-07-25T13:21:40.000Z', distanceMi: 18.0, movingTimeS: 8661,
          mergedIntoId: CANON,
        },
        absorbedAt: '2026-07-26 11:17:51',
      },
      {
        ...common, id: DUP_HK,
        data: {
          source: 'apple_watch', date: '2026-07-25', startLocal: '2026-07-25T06:21:36',
          startUtc: '2026-07-25T13:21:40.000Z', distanceMi: 18.0, durationSec: 8665,
          mergedIntoId: CANON,
        },
        absorbedAt: '2026-07-25 23:30:14',
      },
      {
        ...common, id: CANON,
        data: {
          source: 'watch', date: '2026-07-25', startLocal: '2026-07-25T06:21:40',
          startUtc: '2026-07-25T13:21:40.000Z', timezone: TZ,
          distanceMi: 18.0, durationSec: 8660, movingTimeS: 8661,
          // no mergedIntoId — it reads as canonical
        },
        absorbedAt: canonAbsorbedAt,
      },
    ];
  }

  it('the three rows are one cluster and the watch row is the canonical', () => {
    const ops = planMergeOps(rows(null), TZ);
    expect(ops.clusters).toBe(1);
    expect(ops.absorptions.every((a) => a.canonicalId === CANON)).toBe(true);
    expect(ops.absorptions.map((a) => a.loserId).sort()).toEqual([DUP_HK, DUP_STRAVA].sort());
  });

  it('a stamped canonical is now CLEARED · pre-fix this list was empty', () => {
    // The whole reason the seven survived ten weeks of nightly sweeps: the
    // gate read `canonical.data.mergedIntoId`, which is absent here, so the
    // canonical was never queued for a clear and its stamp was permanent.
    const ops = planMergeOps(rows('2026-07-25 23:30:14'), TZ);
    expect(ops.clears).toEqual([CANON]);
  });

  it('a clean canonical is NOT cleared · the pass stays a no-op when nothing is wrong', () => {
    expect(planMergeOps(rows(null), TZ).clears).toEqual([]);
  });

  it('applying the ops leaves nothing to do · the repair is idempotent', () => {
    const before = rows('2026-07-25 23:30:14');
    const ops = planMergeOps(before, TZ);

    // Apply exactly what merge.ts applies.
    const after: RunRow[] = before.map((r) => {
      let data = { ...r.data };
      let absorbedAt = r.absorbedAt ?? null;
      if (ops.clears.includes(r.id)) {
        delete data.mergedIntoId;
        absorbedAt = null;                       // the clear drops BOTH markers
      }
      const set = ops.sets.find((s) => s.id === r.id);
      if (set) data = { ...data, mergedIntoId: set.canonicalId };
      return { ...r, data, absorbedAt };
    });

    const again = planMergeOps(after, TZ);
    expect(again.clears).toEqual([]);
    expect(again.sets).toEqual([]);

    // And the day the repair leaves behind satisfies the invariant.
    const shaped: AbsorptionRow[] = after.map((r) => ({
      id: r.id,
      day: r.data.date,
      mergedIntoId: r.data.mergedIntoId ?? null,
      absorbedAt: r.absorbedAt ?? null,
      distanceMi: r.data.distanceMi,
    }));
    expect(absorptionViolations(shaped)).toEqual([]);
    // The day keeps a survivor — the point of the whole exercise.
    expect(shaped.filter((r) => r.mergedIntoId == null)).toHaveLength(1);
  });

  it('a caller that does not select the column behaves exactly as before', () => {
    // `absorbedAt` is optional so the volume reader, the audits and pullSync's
    // matcher are untouched by this change. An undefined stamp must never
    // queue a clear.
    const noStamp = rows(null).map(({ absorbedAt: _drop, ...r }) => r as RunRow);
    expect(planMergeOps(noStamp, TZ).clears).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE MERGE PASS · one at a time, all or nothing
 * ═══════════════════════════════════════════════════════════════════════ */
describe('autoMergeForDate · the flag rewrite is serialised and atomic', () => {
  const src = readFileSync(path.join(__dirname, 'merge.ts'), 'utf8');

  it('takes a transaction-scoped advisory lock keyed on (user, date)', () => {
    expect(src).toMatch(/pg_advisory_xact_lock\(hashtext\(\$1::text\), hashtext\(\$2::text\)\)/);
  });

  it('re-reads the day INSIDE the lock · a queued pass must not plan on stale rows', () => {
    const lockAt = src.indexOf('pg_advisory_xact_lock');
    const readAt = src.indexOf('FROM runs\n        WHERE user_uuid = $1');
    expect(lockAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(lockAt);
  });

  it('selects the absorption stamp · the repair cannot clear what it cannot see', () => {
    expect(src).toMatch(/absorbed_into_canonical_at::text AS "absorbedAt"/);
  });

  it('the clears and sets commit together', () => {
    const begin = src.indexOf("client.query('BEGIN')");
    const commit = src.indexOf("client.query('COMMIT')", src.indexOf('for (const { id, canonicalId } of sets)'));
    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(begin);
    expect(src).toMatch(/client\.query\('ROLLBACK'\)/);
    expect(src).toMatch(/client\.release\(\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE FULL-REPLACE WRITES · Rule 6 on a column-and-key pair
 * ═══════════════════════════════════════════════════════════════════════ */
describe('Rule 6 · a snapshot write cannot erase the pointer and leave the stamp', () => {
  it('the fragment defers to the LIVE row in both directions', () => {
    const sql = preserveMergedIntoIdSql('$1').replace(/\s+/g, ' ');
    // A pointer that arrived after the snapshot is carried onto the new object.
    expect(sql).toContain("WHEN runs.data ? 'mergedIntoId'");
    expect(sql).toContain("jsonb_set($1::jsonb, '{mergedIntoId}', runs.data->'mergedIntoId')");
    // A pointer that LEFT after the snapshot is not resurrected — the other
    // half, and the one a plain `||` merge would get wrong.
    expect(sql).toContain("ELSE $1::jsonb - 'mergedIntoId'::text");
  });

  const CASES: Array<[string, string]> = [
    ['lib/runs/canonical.ts', path.join(__dirname, 'canonical.ts')],
    ['lib/strava/pullSync.ts', path.join(__dirname, '..', 'strava', 'pullSync.ts')],
  ];

  for (const [label, file] of CASES) {
    it(`${label} preserves a mergedIntoId written after its snapshot`, () => {
      // Both build a replacement `data` from a snapshot read earlier in the
      // same function — pullSync's snapshot is separated from its write by an
      // HTTP call to Strava — and both wrote it back with a full
      // `SET data = $1::jsonb`. A concurrent merge flagging the row in that
      // window lost its pointer, while `absorbed_into_canonical_at` (a COLUMN)
      // survived. Stamp without pointer: the orphan, by a second route.
      const src = readFileSync(file, 'utf8');
      // Both go through the ONE fragment, so there is a single definition of
      // the guard rather than two copies free to drift apart.
      expect(src).toContain("SET data = ${preserveMergedIntoIdSql('$1')}");
      // ... and no bare full-replace survives anywhere in the file.
      expect(src.replace(/\s+/g, ' ')).not.toMatch(/SET data = \$1::jsonb,/);
    });
  }
});
