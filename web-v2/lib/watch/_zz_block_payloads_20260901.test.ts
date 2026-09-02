/**
 * The WIRE PAYLOAD and the PHONE CARD for every quality row of the owner's
 * live block (`pln_9a57561debb776e5`), composed against production READ-ONLY.
 *
 * Same method as `_zz_watch_payload_20260901.test.ts`, widened to the block:
 * `buildWatchToday(owner, date)` for the wrist, `cardFromSpec` with the same
 * easy-band read the phone route makes for the phone. Writes a markdown
 * table; asserts only that both surfaces composed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const PLAN = 'pln_9a57561debb776e5';
const OUT = process.env.BLOCK_PAYLOAD_OUT
  ?? '/private/tmp/claude-501/-Volumes-WP-06-Claude-Code-Runcino/5f870f9b-924e-42f5-9e67-a1225046505a/scratchpad/brain/owner-block-payloads.md';

const mmss = (s: number | null | undefined) =>
  s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

describe.runIf(process.env.BRAIN_PROBE === '1' && !!process.env.DATABASE_URL)('BLOCK PAYLOADS · owner live block', () => {
  it('composes watch + phone for every quality row', async () => {
    const { pool } = await import('@/lib/db/pool');
    const { buildWatchToday } = await import('./build-workout');
    const { cardFromSpec } = await import('@/lib/training/spec-card');
    const { strictPrescriptionType } = await import('@/lib/training/prescriptions');
    const rows = (await pool.query<any>(
      `SELECT date_iso, type, sub_label, distance_mi, pace_target_s_per_mi, workout_spec, notes
         FROM plan_workouts WHERE plan_id = $1 AND date_iso::date >= '2026-09-01'
          AND type NOT IN ('easy','rest','recovery') ORDER BY date_iso`, [PLAN],
    )).rows;
    expect(rows.length).toBeGreaterThan(0);
    const easyRow = (await pool.query<any>(
      `SELECT (workout_spec->>'pace_target_s_per_mi_lo')::float lo, (workout_spec->>'pace_target_s_per_mi_hi')::float hi
         FROM plan_workouts WHERE plan_id=$1 AND workout_spec->>'kind' IN ('easy','long')
          AND workout_spec->>'pace_target_s_per_mi_lo' IS NOT NULL
        ORDER BY (workout_spec->>'kind'='easy') DESC, ABS(date_iso::date - '2026-09-01'::date) ASC LIMIT 1`, [PLAN],
    )).rows[0];
    const easyMid = easyRow ? Math.round((easyRow.lo + easyRow.hi) / 2) : null;
    const lines: string[] = ['# Owner live block · watch payload + phone card per quality row', ''];
    let composed = 0;
    for (const r of rows) {
      const res = await buildWatchToday(OWNER, r.date_iso);
      const w = res.workout ?? null;
      const card = cardFromSpec({
        spec: r.workout_spec, type: strictPrescriptionType(r.type) ?? 'easy', subLabel: r.sub_label,
        distanceMi: Number(r.distance_mi), easyPaceSec: easyMid, easyCeilingSec: easyRow?.lo ?? null, hr: null,
      });
      lines.push(`## ${r.date_iso} · ${r.type} · row "${r.sub_label}" · ${r.distance_mi} mi · column pace ${r.pace_target_s_per_mi ?? '—'}`);
      lines.push(`notes: ${String(r.notes ?? '').slice(0, 120)}`);
      lines.push(`WATCH: name "${w?.name ?? '—'}" · summary "${w?.summary ?? res.message ?? '—'}" · paceLabel ${w?.paceLabel ?? '—'} · hrCeiling ${w?.hrCeilingBpm ?? '—'}`);
      lines.push(`PHONE: headline "${card?.headline ?? '—'}" · work ${mmss(card?.workPaceSPerMi)} ± ${card?.workToleranceSPerMi ?? '—'} · dur ${card?.totalDurationSec != null ? Math.round(card.totalDurationSec / 60) + ' min' : '—'} · rationale ${card?.selectionRationale ?? '—'}`);
      if (w) {
        composed++;
        lines.push('| # | type | label | value | target | tol | shape | hr |');
        lines.push('|---|---|---|---|---|---|---|---|');
        w.phases.forEach((p, i) => {
          const v = p.repUnit === 'distance' ? `${p.distanceMi} mi` : `${p.durationSec} s`;
          lines.push(`| ${i} | ${p.type} | ${p.label} | ${v} | ${mmss(p.targetPaceSPerMi)} | ${p.tolerancePaceSPerMi ?? '—'} | ${p.paceShape ?? '(absent)'} | ${p.hrTargetBpm ?? '—'} |`);
        });
      }
      if (card) {
        lines.push('phone steps:');
        for (const s of card.steps) {
          lines.push(`- ${s.label}${s.reps ? ` ×${s.reps}` : ''}${s.rep_distance_mi ? ` ${s.rep_distance_mi} mi` : ''}${s.distance_mi ? ` ${s.distance_mi} mi` : ''}${s.duration ? ` ${s.duration}` : ''} · ${s.pace_target ?? s.effort_target ?? 'no pace'}${s.recovery ? ` · rec ${s.recovery.duration}${s.recovery.pace_target ? ' @ ' + s.recovery.pace_target : ''}` : ''} · ${s.note}`);
        }
      }
      lines.push('');
    }
    fs.writeFileSync(OUT, lines.join('\n') + '\n');
    expect(composed).toBeGreaterThan(0);
  }, 300_000);
});
