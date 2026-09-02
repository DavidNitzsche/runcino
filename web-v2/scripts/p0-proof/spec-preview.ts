/**
 * SPEC PREVIEW · proofs 8 and 9, which compose alone cannot answer.
 *
 * `DayPlan` carries no workout_spec: warm-up, cool-down, HR cap and the abort
 * rules are built at PERSIST time by `buildWorkoutSpec`. A preview that reads
 * the composed days and reports "—" for all of them has not shown that the
 * corrected structures and HR rules appear — it has only shown that compose is
 * not where they live.
 *
 * So this calls the SAME builder persist calls, with the anchors this compose
 * resolved, and prints what the rows will carry. It writes nothing.
 */
import { pool } from '@/lib/db/pool';
import { composeForUser } from '@/lib/plan/generate';
import { buildWorkoutSpec } from '@/lib/plan/spec-builder';

const U = process.env.PROBE_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = process.env.PROBE_TODAY || '2026-09-02';
const pace = (s: number | null | undefined) =>
  s == null || !(s > 0) ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function main() {
  const c = await composeForUser({ userId: U, raceSlug: 'cim' });
  if (!c.ok) { console.log(`## COMPOSE REFUSED\n\n${c.reason}`); await pool.end(); return; }
  const cr = c.result.composed as any;
  const st = (cr.authoredState ?? {}) as Record<string, any>;
  const tPace = Number(st.t_pace_s_per_mi);
  const lthr = st.lthr_bpm == null ? null : Number(st.lthr_bpm);
  const goalPace = st.goal_pace_s_per_mi == null ? null : Number(st.goal_pace_s_per_mi);
  const maxHr = (await pool.query<{ max_hr: number | null }>(
    'SELECT max_hr FROM users WHERE id = $1', [U])).rows[0]?.max_hr ?? null;

  const L: string[] = [];
  L.push('# Spec preview · proofs 8 and 9');
  L.push('');
  L.push(`Built with \`buildWorkoutSpec\` — the same function \`persistPlan\` calls — using the anchors`);
  L.push(`this compose resolved: T ${tPace}s (${pace(tPace)}/mi) · LTHR ${lthr ?? '—'} · maxHR ${maxHr ?? '—'} · goal pace ${goalPace ?? '—'}s.`);
  L.push('');
  L.push('> **The `Pace` column on a `race` row is not a prediction of the rebuild.**');
  L.push('> This script calls `buildWorkoutSpec` with seven of its twelve arguments.');
  L.push('> `persistPlan` also passes `iPaceSec`, `easyAnchorTSec`, `effortCued`,');
  L.push('> `prescribedRacePaceSec` (RACEPACE-1) and the canonical anchors object.');
  L.push('> Without `prescribedRacePaceSec` the race branch falls back to the stated');
  L.push('> goal pace, which is why every race below reads alike. Race pacing is owned');
  L.push('> by `race-row-refresh`, which runs inside authoring. HR caps, warm-up,');
  L.push('> cool-down and the pass/abort rules read none of the five and are valid.');
  L.push('');
  L.push('| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort / pass rules |');
  L.push('|---|---|---|---|---|---|---|---|---|');

  let withRules = 0, withHr = 0, withWu = 0, future = 0;
  for (const w of cr.weeks ?? []) {
    const startMs = Date.parse(w.startISO + 'T12:00:00Z');
    const startDow = new Date(startMs).getUTCDay();
    const rows = (w.days ?? []).map((d: any) => {
      const off = ((Number(d.dow) - startDow) % 7 + 7) % 7;
      return { iso: new Date(startMs + off * 86400000).toISOString().slice(0, 10), d };
    }).sort((a: any, b: any) => a.iso.localeCompare(b.iso));
    for (const { iso, d } of rows) {
      if (iso < TODAY) continue;
      future++;
      // HARNESS LIMIT, STATED RATHER THAN HIDDEN. `persistPlan` passes five
      // further arguments this preview cannot reconstruct from outside the
      // composer: iPaceSec, easyAnchorTSec, effortCued, prescribedRacePaceSec
      // (RACEPACE-1) and the canonical anchors object. Without
      // prescribedRacePaceSec the race branch falls back to the stated goal
      // pace, so THE PACE COLUMN ON A `race` ROW BELOW IS AN ARTIFACT OF THIS
      // SCRIPT and must not be read as what the rebuild would prescribe. Race
      // pacing is owned by `race-row-refresh`, which runs inside authoring and
      // writes race_execution / race_hr from the canonical outlook.
      // Every non-race row is unaffected: HR caps, warm-up, cool-down and the
      // pass/abort rules do not read any of the five.
      const built = buildWorkoutSpec(
        String(d.type), Number(d.distanceMi ?? 0), tPace, lthr,
        d.subLabel ?? null, maxHr, goalPace,
      ) as { spec: any; paceTargetSPerMi: number | null };
      const raceArtifact = String(d.type) === 'race';
      const s = built.spec ?? {};
      const rules = Array.isArray(s.rules) ? s.rules : [];
      const rr = rules.map((x: any) => `${x.kind}: ${x.label}`).join(' · ') || '—';
      if (rules.length) withRules++;
      if (s.hr_cap_bpm != null) withHr++;
      if (s.warmup_mi != null) withWu++;
      L.push(`| ${iso} | ${d.type} | ${d.subLabel ?? '—'} | ${Number(d.distanceMi ?? 0).toFixed(1)} | `
        + `${raceArtifact ? '_(harness artifact — see note)_' : pace(built.paceTargetSPerMi)} | ${s.warmup_mi ?? '—'} | ${s.cooldown_mi ?? '—'} | `
        + `${s.hr_cap_bpm ?? '—'} | ${rr} |`);
    }
  }
  L.push('');
  L.push(`## Coverage`);
  L.push('');
  L.push(`- future rows previewed: **${future}**`);
  L.push(`- carrying an HR cap: **${withHr}**`);
  L.push(`- carrying warm-up/cool-down: **${withWu}**`);
  L.push(`- carrying pass/abort rules: **${withRules}**`);
  console.log(L.join('\n'));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
