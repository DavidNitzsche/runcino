/**
 * vdot-tuneup-impact.analysis.ts · READ-ONLY.
 *
 * Answers one question with production numbers and changes nothing:
 * what happens to the runner's VDOT, and to every pace derived from it, if
 * race-week tune-up sessions stop being allowed to anchor run-VDOT.
 *
 * Run it:
 *     cd web-v2 && npx vitest run --config vitest.analysis.config.ts
 *
 * It is NOT in the CI suite (see vitest.analysis.config.ts) and it holds no
 * assertions about the answer — it prints. The only assertion is that the
 * connection it opened is the read-only role.
 */
import { describe, it, expect } from 'vitest';

// ── RO FENCE ───────────────────────────────────────────────────────────────
// lib/db/pool.ts reads process.env.DATABASE_URL once, at module load. Set it
// to the read-only role BEFORE any @/lib import evaluates, and import every
// app module dynamically below so nothing hoists above this line.
const RO = process.env.DATABASE_URL_RO;
if (!RO) throw new Error('DATABASE_URL_RO is required — this analysis never opens a writable connection');
if (!/faff_readonly/.test(RO)) throw new Error('DATABASE_URL_RO is not the faff_readonly role — refusing to run');
process.env.DATABASE_URL = RO;

const RUNNER_EMAIL = 'dnitch85@me.com';

const pad = (n: number) => String(n).padStart(2, '0');
/** "8:57" — the way a pace reads on screen. */
function pace(sPerMi: number | null | undefined): string {
  if (sPerMi == null || !Number.isFinite(sPerMi) || sPerMi <= 0) return '—';
  return `${Math.floor(sPerMi / 60)}:${pad(Math.round(sPerMi % 60))}`;
}
function hms(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
function signed(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const r = Math.round(n);
  return r === 0 ? '0' : `${r > 0 ? '+' : ''}${r}`;
}

describe('race-week tune-up · VDOT and pace impact (read-only, prod)', () => {
  it('computes before/after and prints the table', async () => {
    const { pool } = await import('@/lib/db/pool');
    const { loadVdotInputs } = await import('@/lib/training/vdot-inputs');
    const {
      bestRecentVdot, tPaceFromVdot, iPaceFromVdot, rPaceFromVdot,
      VDOT_FULL_VALUE_DAYS, predictRaceTime,
    } = await import('@/lib/training/vdot');
    const { runnerToday } = await import('@/lib/runtime/runner-tz');

    // The role is the fence. Prove it rather than trusting the string.
    const who = await pool.query<{ current_user: string }>('SELECT current_user');
    expect(who.rows[0].current_user).toBe('faff_readonly');

    const u = (await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`, [RUNNER_EMAIL],
    )).rows[0];
    if (!u) throw new Error(`no user ${RUNNER_EMAIL}`);
    const userId = u.id;
    const today = await runnerToday(userId);

    const inputs = await loadVdotInputs(userId, today);
    const { raceCandidates, runCandidates, runFloorMi } = inputs;

    // ── which run dates the plan calls a race-week tune-up ────────────────
    // Same predicate as the plan_type subquery in lib/training/vdot-inputs.ts:
    // an ACTIVE plan row on the run's own date. Reproduced here rather than
    // returned by the loader because the loader collapses plan type into a
    // zone and the zone cannot tell 'race' from 'race_week_tuneup'.
    const tuneupDates = new Set(
      (await pool.query<{ date_iso: string }>(
        `SELECT DISTINCT pw.date_iso
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
            AND pw.type = 'race_week_tuneup'`,
        [userId],
      )).rows.map(r => r.date_iso),
    );

    // The broader reading of the same worry: ANY run inside the taper, not
    // only one the plan happened to label. Research/08 §9.1 says intensity is
    // preserved through the taper, so these are real efforts on cut volume.
    const raceDates = (await pool.query<{ d: string }>(
      `SELECT (meta->>'date') AS d FROM races WHERE user_uuid = $1 AND meta->>'date' IS NOT NULL`,
      [userId],
    )).rows.map(r => r.d);
    // Every date any plan (archived included) ever called a tune-up. The live
    // subquery only sees ACTIVE plans, so it cannot label a past tune-up whose
    // plan has since been archived — which is every one of this runner's.
    const everTuneupDatesEarly = new Set(
      (await pool.query<{ date_iso: string }>(
        `SELECT DISTINCT pw.date_iso
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1 AND pw.type = 'race_week_tuneup'`,
        [userId],
      )).rows.map(r => r.date_iso),
    );

    const TAPER_DAYS = 10;
    const inTaper = (d: string) => raceDates.some((rd) => {
      const gap = (Date.parse(rd + 'T12:00:00Z') - Date.parse(d + 'T12:00:00Z')) / 86400000;
      return gap > 0 && gap <= TAPER_DAYS;
    });

    const scenarios: Array<{ name: string; runs: typeof runCandidates }> = [
      { name: 'NOW (production)', runs: runCandidates },
      { name: 'A · drop tune-up runs (ACTIVE plans label them)', runs: runCandidates.filter(r => !tuneupDates.has(r.date)) },
      { name: 'A2 · drop tune-up runs (ANY plan ever labelled them)', runs: runCandidates.filter(r => !everTuneupDatesEarly.has(r.date)) },
      { name: `B · drop every run inside ${TAPER_DAYS}d of a race`, runs: runCandidates.filter(r => !inTaper(r.date)) },
    ];

    const results = scenarios.map(s => ({
      name: s.name,
      dropped: runCandidates.length - s.runs.length,
      out: bestRecentVdot(raceCandidates, today, VDOT_FULL_VALUE_DAYS, s.runs, runFloorMi),
    }));

    // vitest swallows console output from a passing test, and the whole point
    // of this file is the output. Collect and write it where it can be read.
    const buf: string[] = [];
    const line = (s: string) => { buf.push(s); };
    line('');
    line(`runner ${RUNNER_EMAIL} · today ${today} · run floor ${runFloorMi} mi`);
    line(`race candidates ${raceCandidates.length} · run candidates ${runCandidates.length}`);
    line(`plan-labelled race_week_tuneup dates on ACTIVE plans: ${tuneupDates.size ? [...tuneupDates].join(', ') : 'none'}`);
    line(`race dates on file: ${raceDates.join(', ') || 'none'}`);

    line('');
    line('── every candidate the engine considered, NOW ───────────────────────');
    for (const c of results[0].out.considered) {
      const tag = c.source === 'run'
        ? `run   ${c.date} ${tuneupDates.has(c.date) ? '[TUNE-UP]' : inTaper(c.date) ? '[TAPER]' : '         '} ${c.workout_type ?? '—'}`
        : `race  ${c.date}           ${c.name}`;
      line(`  VDOT ${String(c.vdot).padEnd(5)} (raw ${String(c.vdot_raw).padEnd(5)}, age ${String(c.age_days).padStart(3)}d)  ${tag}  ${c.distance_mi.toFixed(2)} mi in ${hms(c.finish_seconds)}`);
    }

    // Which zone each run candidate carries, and what the two competing reads
    // say about it. `zone` is set ONLY when the work-phase pace was used
    // (vdot-inputs.ts), so a null zone means vdotFromRun falls back to the
    // run's OWN workout_type — which is the difference between a tune-up being
    // read as a threshold effort (vdotFromTpace, generous) and as an all-out
    // race (vdotFromRace, conservative).
    line('');
    line('── run candidates · the zone each one carries, and both reads ──');
    line('  date        wtype        dist    time      zone      vdotFromRace  vdotFromTpace  vdotFromRun');
    const { vdotFromRace, vdotFromTpace, vdotFromRun } = await import('@/lib/training/vdot');
    for (const r of [...runCandidates].sort((a, b) => (b.date < a.date ? -1 : 1))) {
      if (r.distance_mi == null || r.finish_seconds == null) continue;
      const asRace = vdotFromRace(r.finish_seconds, r.distance_mi);
      const asT = vdotFromTpace(r.finish_seconds / r.distance_mi);
      const actual = vdotFromRun({
        finishSeconds: r.finish_seconds, distanceMi: r.distance_mi,
        workoutType: r.workout_type, avgHr: r.avg_hr, maxHr: r.max_hr,
        zone: r.zone, minDistanceMi: runFloorMi,
      });
      line(`  ${r.date}  ${String(r.workout_type ?? '—').padEnd(12)} ${r.distance_mi.toFixed(2).padStart(5)}  ${hms(r.finish_seconds).padEnd(9)} ` +
        `${String(r.zone ?? 'null').padEnd(9)} ${String(asRace ?? '—').padEnd(13)} ${String(asT ?? '—').padEnd(14)} ${actual ?? '—'}` +
        `${everTuneupDatesEarly.has(r.date) ? '   <-- TUNE-UP DAY' : ''}`);
    }

    line('');
    line('── scenarios ────────────────────────────────────────────────────────');
    for (const r of results) {
      const b = r.out.best;
      line(`  ${r.name.padEnd(46)} VDOT ${b ? b.vdot : '—'}  from ${b ? `${b.source} ${b.date}` : 'nothing'}  (runs dropped: ${r.dropped})`);
    }

    // ── paces ───────────────────────────────────────────────────────────────
    // T is the anchor; every other zone the composer prescribes is a fixed
    // offset off it (lib/plan/spec-builder.ts, mirrored in
    // lib/training/prescriptions.ts#derivePaces). I and R are ALSO published
    // straight off the Daniels curve by lib/plan/pace-zones.ts for the phone's
    // Paces screen, and the two disagree by design (PACE.interval-offset and
    // PACE.rep-offset both carry standing exemptions in the doctrine registry).
    // Both are printed so neither reading is hidden.
    const paceSet: (vdot: number | null) => Record<string, number | null> = (vdot) => {
      const t = vdot != null ? tPaceFromVdot(vdot) : null;
      return {
        easyLo: t != null ? t + 80 : null,
        easyHi: t != null ? t + 120 : null,
        marathon: t != null ? t + 18 : null,
        threshold: t,
        intervalOffset: t != null ? t - 18 : null,
        repOffset: t != null ? t - 30 : null,
        intervalCurve: vdot != null ? iPaceFromVdot(vdot) : null,
        repCurve: vdot != null ? rPaceFromVdot(vdot) : null,
      };
    };

    const paceTable = (title: string, nowV: number | null, newV: number | null) => {
      const a = paceSet(nowV), b = paceSet(newV);
      line('');
      line(`── ${title} · VDOT ${nowV ?? '—'} → ${newV ?? '—'} ──`);
      line('  zone              before     after      delta s/mi');
      const rows: Array<[string, number | null, number | null]> = [
        ['easy (slow end)', a.easyHi, b.easyHi],
        ['easy (fast end)', a.easyLo, b.easyLo],
        ['marathon', a.marathon, b.marathon],
        ['threshold', a.threshold, b.threshold],
        ['interval (plan)', a.intervalOffset, b.intervalOffset],
        ['interval (curve)', a.intervalCurve, b.intervalCurve],
        ['repetition (plan)', a.repOffset, b.repOffset],
        ['repetition (curve)', a.repCurve, b.repCurve],
      ];
      for (const [name, x, y] of rows) {
        line(`  ${name.padEnd(18)}${pace(x).padEnd(11)}${pace(y).padEnd(11)}${signed(x != null && y != null ? y - x : null)}`);
      }
      for (const mi of [3.10686, 6.21371, 13.1094, 26.2188]) {
        const p1 = nowV != null ? predictRaceTime(nowV, mi) : null;
        const p2 = newV != null ? predictRaceTime(newV, mi) : null;
        line(`  predicted ${mi.toFixed(2).padStart(7)} mi ${hms(p1).padEnd(11)}${hms(p2).padEnd(11)}${signed(p1 != null && p2 != null ? p2 - p1 : null)} s`);
      }
    };

    const nowV = results[0].out.best?.vdot ?? null;
    for (const r of results.slice(1)) paceTable(`paces · NOW vs ${r.name}`, nowV, r.out.best?.vdot ?? null);

    // ── the plan the paces would move ──────────────────────────────────────
    const upcoming = (await pool.query<{
      date_iso: string; type: string; pace: string | null; spec: Record<string, unknown> | null;
    }>(
      `SELECT pw.date_iso, pw.type,
              pw.pace_target_s_per_mi::text AS pace,
              pw.workout_spec AS spec
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
          AND pw.date_iso >= $2
        ORDER BY pw.date_iso LIMIT 30`,
      [userId, today],
    )).rows;
    line('');
    line(`── next ${upcoming.length} plan days (what a pace move would land on) ──`);
    for (const w of upcoming) {
      const s = w.spec ?? {};
      line(`  ${w.date_iso}  ${String(w.type).padEnd(16)} target ${pace(w.pace != null ? Number(w.pace) : null).padEnd(8)} ` +
        `band ${pace(Number(s['pace_target_s_per_mi_lo'] ?? NaN))}-${pace(Number(s['pace_target_s_per_mi_hi'] ?? NaN))}`);
    }

    // ── how often this bites ───────────────────────────────────────────────
    line('');
    line('── frequency: race_week_tuneup rows in production, all users ──');
    const freq = (await pool.query<{ email: string; date_iso: string; active: boolean; anchored: boolean }>(
      `SELECT COALESCE(us.email, tp.user_uuid::text) AS email,
              pw.date_iso,
              (tp.archived_iso IS NULL) AS active,
              EXISTS (SELECT 1 FROM runs r
                       WHERE r.user_uuid = tp.user_uuid
                         AND (r.data->>'date') = pw.date_iso) AS anchored
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
         LEFT JOIN users us ON us.id::text = tp.user_uuid::text
        WHERE pw.type = 'race_week_tuneup'
        ORDER BY pw.date_iso`,
    )).rows;
    for (const f of freq) {
      line(`  ${f.date_iso}  ${f.active ? 'ACTIVE  ' : 'archived'}  run on that date: ${f.anchored ? 'yes' : 'no '}  ${f.email}`);
    }

    // ── the arbitrary ORDER BY ─────────────────────────────────────────────
    line('');
    line('── ORDER BY pw.type · dates where two qualifying plan rows collide ──');
    const collisions = (await pool.query<{ user_uuid: string; date_iso: string; types: string[] }>(
      `SELECT tp.user_uuid::text AS user_uuid, pw.date_iso, array_agg(pw.type ORDER BY pw.type) AS types
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.archived_iso IS NULL
          AND pw.type IN ('tempo','threshold','intervals','marathon_pace','race','race_week_tuneup')
        GROUP BY 1,2 HAVING count(*) > 1
        ORDER BY 2`,
    )).rows;
    line(collisions.length === 0
      ? '  none — no active plan has two qualifying rows on one date, for any user.'
      : collisions.map(c => `  ${c.date_iso} ${c.user_uuid} ${c.types.join(' + ')}`).join('\n'));

    // The live collision query above only sees ACTIVE plans, which is what the
    // subquery filters on — but it cannot see whether two plans were BOTH
    // active on some past day. Same question, asked of the archive.
    line('');
    line('── were two plans ever active at once? (archived_iso per plan carrying a tune-up) ──');
    const planLives = (await pool.query<{ plan_id: string; user_uuid: string; authored: string | null; archived: string | null; n: string }>(
      `SELECT tp.id::text AS plan_id, tp.user_uuid::text AS user_uuid,
              tp.authored_iso::text AS authored, tp.archived_iso::text AS archived,
              count(*)::text AS n
         FROM training_plans tp
         JOIN plan_workouts pw ON pw.plan_id = tp.id
        WHERE pw.type = 'race_week_tuneup'
        GROUP BY 1,2,3,4 ORDER BY 3`,
    )).rows;
    for (const p of planLives) {
      line(`  plan ${p.plan_id.padEnd(38)} authored ${String(p.authored).slice(0, 10)}  archived ${String(p.archived).slice(0, 10)}  tune-up rows ${p.n}  ${p.user_uuid}`);
    }

    // ── the IN-list vs what the plan tables actually contain ───────────────
    line('');
    line('── plan_workouts.type values vs the subquery IN-list ──');
    const types = (await pool.query<{ type: string; n: string; listed: boolean }>(
      `SELECT type, count(*)::text AS n,
              type IN ('tempo','threshold','intervals','marathon_pace','race','race_week_tuneup') AS listed
         FROM plan_workouts GROUP BY 1 ORDER BY 2 DESC`,
    )).rows;
    for (const t of types) line(`  ${t.type.padEnd(18)} ${t.n.padStart(6)}  ${t.listed ? 'in IN-list' : ''}`);

    // ── DAY-BY-DAY REPLAY ──────────────────────────────────────────────────
    // "Is a tune-up anchoring today, or only in race weeks?" cannot be answered
    // from today alone: the superseded-lead rule (bestRecentVdot, 2026-08-17)
    // demotes every run dated at or before the freshest representative race, so
    // a tune-up is silent the moment its own race lands. The window where it
    // CAN anchor is the taper itself. Replay each day to see it.
    //
    // Historical tune-up dates come from EVERY plan, archived included — the
    // plan that labelled 2026-08-11 a tune-up was active on 2026-08-11 and is
    // archived now, so the live subquery cannot see it and a replay that used
    // the live set would report "never fires" by construction.
    const everTuneupDates = everTuneupDatesEarly;
    line('');
    line(`── day-by-day replay · tune-up dates ever planned: ${[...everTuneupDates].join(', ') || 'none'} ──`);
    line('  day         VDOT now   anchor                 VDOT w/o tune-up   anchor');
    const movedPairs = new Set<string>();
    const start = Date.parse(today + 'T12:00:00Z') - 45 * 86400000;
    for (let i = 0; i <= 45; i++) {
      const d = new Date(start + i * 86400000).toISOString().slice(0, 10);
      const inp = await loadVdotInputs(userId, d);
      const withAll = bestRecentVdot(inp.raceCandidates, d, VDOT_FULL_VALUE_DAYS, inp.runCandidates, inp.runFloorMi);
      const without = bestRecentVdot(
        inp.raceCandidates, d, VDOT_FULL_VALUE_DAYS,
        inp.runCandidates.filter(r => !everTuneupDates.has(r.date)), inp.runFloorMi,
      );
      const tag = (b: typeof withAll.best) => b ? `${b.source} ${b.date}${b.source === 'run' && everTuneupDates.has(b.date) ? ' TUNE-UP' : ''}` : 'none';
      const moved = (withAll.best?.vdot ?? null) !== (without.best?.vdot ?? null);
      line(`  ${d}  ${String(withAll.best?.vdot ?? '—').padEnd(10)} ${tag(withAll.best).padEnd(22)} ${String(without.best?.vdot ?? '—').padEnd(18)} ${tag(without.best).padEnd(22)} ${moved ? '  <<< MOVES' : ''}`);
      if (moved) movedPairs.add(`${withAll.best?.vdot ?? ''}|${without.best?.vdot ?? ''}`);
    }
    // The days the change would actually have moved a prescription, priced.
    for (const p of movedPairs) {
      const [a, b] = p.split('|');
      paceTable('paces on a day the tune-up DID anchor', a ? Number(a) : null, b ? Number(b) : null);
    }

    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const out = process.env.VDOT_ANALYSIS_OUT ?? path.join(os.tmpdir(), 'vdot-tuneup-impact.txt');
    fs.writeFileSync(out, buf.join('\n') + '\n', 'utf8');
    console.log(`\n[analysis written to ${out}]\n` + buf.join('\n'));

    await pool.end();
  });
});
