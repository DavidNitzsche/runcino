/**
 * _zz_brain_probe_prod.test.ts · READ-ONLY sweep of every non-archived plan's
 * future rows (2026-09-01): label vs spec, phone headline vs watch summary,
 * WU/CD sizing, cutdown identity vs uniform spec, interval recovery ratio,
 * tune-up column vs spec, selection_rationale coverage, easy/long point paces.
 *
 * Gated on BRAIN_PROBE=1 and DATABASE_URL. Writes a report.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { subLabelFromSpec } from '@/lib/training/expand-spec';
import { cardFromSpec } from '@/lib/training/spec-card';
import { prescriptionFor, narrowToPrescriptionType, strictPrescriptionType } from '@/lib/training/prescriptions';
import { rationaleForRow } from '@/lib/workout-catalogue/select';

const OUT = process.env.BRAIN_PROBE_OUT ?? '/tmp/brain-probe-prod.txt';
const CUTDOWN_HEADS = ['1K cutdowns', 'Mile cutdowns', 'Continuous mile cutdowns', 'Canova 2K repeats', '5K progression'];

describe.runIf(process.env.BRAIN_PROBE === '1' && !!process.env.DATABASE_URL)('BRAIN PROBE · production', () => {
  it('sweeps every active plan and writes the report', async () => {
    const { pool } = await import('@/lib/db/pool');
    const plans = (await pool.query<{ id: string; user_uuid: string; email: string }>(
      `SELECT p.id, p.user_uuid, u.email FROM training_plans p JOIN users u ON u.id = p.user_uuid
        WHERE p.archived_iso IS NULL ORDER BY p.authored_iso DESC`,
    )).rows;
    const today = '2026-09-01';
    const tot: Record<string, number> = { plans: plans.length, rows: 0, quality: 0, labelDrift: 0, watchGeneric: 0, wuOver20: 0, cdOver20: 0,
      cutdownUniform: 0, intervalRestShort: 0, rationalePresent: 0, rationaleRecoverable: 0, tuneupSplit: 0, easyPoint: 0, longSummaryWrong: 0 };
    const examples: Record<string, string[]> = {};
    const ex = (k: string, s: string) => { (examples[k] ??= []); if (examples[k].length < 6) examples[k].push(s); };
    for (const p of plans) {
      const rows = (await pool.query<any>(
        `SELECT pw.date_iso, pw.type, pw.sub_label, pw.distance_mi, pw.pace_target_s_per_mi, pw.workout_spec, pw.notes, ph.label AS phase
           FROM plan_workouts pw LEFT JOIN plan_weeks wk ON wk.id = pw.week_id LEFT JOIN plan_phases ph ON ph.id = wk.phase_id
          WHERE pw.plan_id = $1 AND pw.date_iso::date >= $2::date ORDER BY pw.date_iso`, [p.id, today],
      )).rows;
      const easyRow = (await pool.query<any>(
        `SELECT (workout_spec->>'pace_target_s_per_mi_lo')::float lo, (workout_spec->>'pace_target_s_per_mi_hi')::float hi
           FROM plan_workouts WHERE plan_id=$1 AND workout_spec->>'kind' IN ('easy','long') AND workout_spec->>'pace_target_s_per_mi_lo' IS NOT NULL
          ORDER BY (workout_spec->>'kind'='easy') DESC, ABS(date_iso::date - $2::date) ASC, (date_iso::date > $2::date) DESC LIMIT 1`, [p.id, today],
      )).rows[0];
      const easyMid = easyRow ? Math.round((easyRow.lo + easyRow.hi) / 2) : null;
      const weeklyMi = rows.slice(0, 7).reduce((a: number, r: any) => a + Number(r.distance_mi || 0), 0) || 30;
      const goalRow = (await pool.query<any>(`SELECT meta FROM races WHERE user_uuid=$1 AND meta->>'priority'='A' AND meta->>'goalDisplay' IS NOT NULL ORDER BY meta->>'date' ASC LIMIT 1`, [p.user_uuid])).rows[0];
      const profile = { lthr: null, goal_seconds: null, goal_distance_mi: goalRow ? Number(goalRow.meta?.distanceMi) || null : null } as any;
      for (const r of rows) {
        tot.rows++;
        const spec = r.workout_spec as Record<string, unknown> | null;
        if (!spec) continue;
        const kind = String(spec.kind ?? '');
        const tag = `${p.email.split('@')[0]} ${r.date_iso} ${r.type}`;
        const pt = narrowToPrescriptionType(r.type);
        const generic = prescriptionFor(pt, weeklyMi, profile, Number(r.distance_mi)).headline;
        const card = cardFromSpec({ spec, type: strictPrescriptionType(r.type) ?? 'easy', subLabel: r.sub_label, distanceMi: Number(r.distance_mi), easyPaceSec: easyMid, easyCeilingSec: easyRow?.lo ?? null, hr: null });
        const isQ = ['threshold', 'intervals', 'tempo'].includes(kind) || r.type === 'race_week_tuneup';
        if (isQ) {
          tot.quality++;
          const derived = subLabelFromSpec(spec);
          if (derived && r.sub_label && derived !== r.sub_label) { tot.labelDrift++; ex('labelDrift', `${tag} · stored "${r.sub_label}" · derived "${derived}"`); }
          if (card && generic !== card.headline) { tot.watchGeneric++; ex('watchGeneric', `${tag} · watch "${generic}" · phone "${card.headline}"`); }
          const wu = Number(spec.warmup_mi ?? 0), cd = Number(spec.cooldown_mi ?? 0);
          if (easyMid) {
            const wuMin = wu * easyMid / 60, cdMin = cd * easyMid / 60;
            if (wuMin > 20) { tot.wuOver20++; ex('wuOver20', `${tag} · WU ${wu} mi = ${wuMin.toFixed(0)} min at ${easyMid}s · day ${r.distance_mi} · "${r.sub_label}"`); }
            if (cdMin > 20) { tot.cdOver20++; ex('cdOver20', `${tag} · CD ${cd} mi = ${cdMin.toFixed(0)} min · day ${r.distance_mi}`); }
          }
          const head = String(r.notes ?? '').split(/\s*[·.]/)[0]?.trim();
          if (CUTDOWN_HEADS.includes(head) && !Array.isArray(spec.steps)) { tot.cutdownUniform++; ex('cutdownUniform', `${tag} · notes "${head}" · label "${r.sub_label}" · pace ${spec.rep_pace_s_per_mi ?? spec.tempo_pace_s_per_mi}`); }
          if (kind === 'intervals' && spec.by_effort !== true) {
            const repS = Number(spec.rep_duration_s ?? 0) || Number(spec.rep_distance_mi ?? 0) * Number(spec.rep_pace_s_per_mi ?? 0);
            if (repS > 0 && Number(spec.rep_rest_s ?? 0) < 0.5 * repS) { tot.intervalRestShort++; ex('intervalRestShort', `${tag} · "${r.sub_label}" · rep ${repS.toFixed(0)}s rest ${spec.rep_rest_s}s`); }
          }
          if (typeof spec.selection_rationale === 'string') tot.rationalePresent++;
          else if (rationaleForRow({ notes: r.notes, slot: r.type, phase: r.phase })) tot.rationaleRecoverable++;
          if (r.type === 'race_week_tuneup') {
            const col = Number(r.pace_target_s_per_mi), sp = Number(spec.rep_pace_s_per_mi);
            if (col && sp && col !== sp) { tot.tuneupSplit++; ex('tuneupSplit', `${tag} · "${r.sub_label}" · column ${col} · spec rep ${sp} · lo/hi ${spec.pace_target_s_per_mi_lo}/${spec.pace_target_s_per_mi_hi}`); }
          }
        }
        if (['easy', 'long', 'recovery'].includes(kind) && r.type !== 'race') {
          const work = card?.steps.find((s) => s.label !== 'Warmup' && s.label !== 'Cooldown');
          if (work?.pace_target && !/-/.test(work.pace_target) && !/≤|slower/.test(work.pace_target)) { tot.easyPoint++; ex('easyPoint', `${tag} · "${work.pace_target}" band ${spec.pace_target_s_per_mi_lo}-${spec.pace_target_s_per_mi_hi}`); }
          if (kind === 'long' && !spec.finish_mi && !spec.finish_segments && /marathon-pace/i.test(generic)) { tot.longSummaryWrong++; ex('longSummaryWrong', `${tag} · watch "${generic}" · row "${r.sub_label}"`); }
        }
      }
    }
    const lines: string[] = [JSON.stringify(tot, null, 2)];
    for (const [k, v] of Object.entries(examples)) { lines.push(`\n## ${k}`); for (const s of v) lines.push(`- ${s}`); }
    fs.writeFileSync(OUT, lines.join('\n') + '\n');
    await pool.end();
    expect(tot.rows).toBeGreaterThan(0);
  }, 600_000);
});
