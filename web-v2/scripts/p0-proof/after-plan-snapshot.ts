/**
 * AFTER PLAN SNAPSHOT · the composed side of the rebuild diff.
 *
 * Read-only. Composes with the block anchor applied and renders the same
 * categories `live-plan-snapshot.ts` renders for the stored plan, so the two
 * markdown files diff directly.
 *
 * It also runs `validateComposedPlan` against the composed result and prints
 * its findings VERBATIM, including the advisory dosing sink — proof 11 asks
 * that the invariants pass against the preview, and a suite that merely
 * doesn't throw is not the same as a validator that was actually asked.
 */
import { pool } from '@/lib/db/pool';
import { composeForUser } from '@/lib/plan/generate';
import { validateComposedPlan } from '@/lib/plan/validate';

const U = process.env.PROBE_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pace = (s: number | null | undefined) =>
  s == null || !(s > 0) ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function main() {
  const composed = await composeForUser({ userId: U, raceSlug: 'cim' });
  if (!composed.ok) { console.log(`## COMPOSE REFUSED\n\n${composed.reason}`); await pool.end(); return; }
  const r = composed.result;
  const cr = r.composed as unknown as {
    weeks: Array<{ startISO: string; days: Array<Record<string, unknown>>; isCutback?: boolean; isPeak?: boolean; isRaceWeek?: boolean; rationale?: string; phaseId?: string }>;
    authoredState?: Record<string, unknown>;
    blocks?: unknown;
  };

  const L: string[] = [];
  L.push('# Composed plan snapshot · AFTER (anchored)');
  L.push('');
  L.push(`mode ${r.mode} · today ${r.todayISO} · trailingAvgWeeklyMi ${r.trailingAvgWeeklyMi ?? '— (refused)'}`);
  L.push('');
  L.push('## Week summary');
  L.push('');
  L.push('| # | Start | Mi | Long | Long purpose | Quality | Rest | Flags |');
  L.push('|---|---|---|---|---|---|---|---|');

  const detail: string[] = [];
  cr.weeks.forEach((w, i) => {
    const startMs = Date.parse(w.startISO + 'T12:00:00Z');
    const startDow = new Date(startMs).getUTCDay();
    const rows = (w.days ?? []).map((d) => {
      const off = ((Number(d.dow) - startDow) % 7 + 7) % 7;
      return { iso: new Date(startMs + off * 86400000).toISOString().slice(0, 10), d };
    }).sort((a, b) => a.iso.localeCompare(b.iso));

    const vol = rows.reduce((a, x) => a + Number((x.d as any).distanceMi ?? 0), 0);
    const long = rows.find((x) => (x.d as any).isLong);
    const q = rows.filter((x) => (x.d as any).isQuality);
    const rest = rows.filter((x) => String((x.d as any).type) === 'rest').length;
    const flags = [w.isPeak && 'PEAK', w.isCutback && 'cutback', w.isRaceWeek && 'RACE WEEK'].filter(Boolean).join(' ') || '—';
    L.push(`| ${i} | ${w.startISO} | ${vol.toFixed(1)} | ${Number((long?.d as any)?.distanceMi ?? 0).toFixed(1)} | `
      + `${(long?.d as any)?.subLabel ?? '—'} | ${q.length} | ${rest} | ${flags} |`);

    detail.push(`### Week ${i} · ${w.startISO} · ${vol.toFixed(1)} mi ${flags === '—' ? '' : `· ${flags}`}`);
    if (w.rationale) detail.push(`> ${w.rationale}`);
    detail.push('');
    detail.push('| Date | Type | Session | Mi | Pace | WU | CD | HR cap | Abort rules |');
    detail.push('|---|---|---|---|---|---|---|---|---|');
    for (const { iso, d } of rows) {
      const a = d as any; const s = (a.workoutSpec ?? a.spec ?? {}) as Record<string, any>;
      const rules = Array.isArray(s.rules) ? s.rules : [];
      const bail = rules.filter((x: any) => x?.kind === 'bail').map((x: any) => x.label).join(' · ') || '—';
      detail.push(`| ${iso} | ${a.type ?? '—'} | ${a.subLabel ?? '—'} | ${Number(a.distanceMi ?? 0).toFixed(1)} | `
        + `${pace(a.paceTargetSPerMi ?? s.pace_target_s_per_mi)} | ${s.warmup_mi ?? '—'} | ${s.cooldown_mi ?? '—'} | `
        + `${s.hr_cap_bpm ?? '—'} | ${bail} |`);
    }
    detail.push('');
  });

  // ── Proof 11 · ask the validator, do not merely fail to throw ─────────────
  L.push('');
  L.push('## validateComposedPlan');
  L.push('');
  const dosing: unknown[] = [];
  try {
    validateComposedPlan(r.composed, 26.2, r.mode, (r as any).validationCtx ?? {} as any,
      { onDosing: (f: unknown) => dosing.push(f) } as any);
    L.push('`validateComposedPlan` returned with **no violations**.');
  } catch (e: any) {
    const v = e?.violations ?? [String(e?.message ?? e)];
    L.push(`\`validateComposedPlan\` raised **${Array.isArray(v) ? v.length : 1}** violation(s):`);
    L.push('');
    for (const x of (Array.isArray(v) ? v : [v])) L.push(`- ${String(x)}`);
  }
  if (dosing.length) {
    L.push('');
    L.push(`Advisory dosing findings (${dosing.length}):`);
    for (const d of dosing) L.push(`- \`${JSON.stringify(d)}\``);
  } else {
    L.push('');
    L.push('Advisory dosing sink: no findings.');
  }

  // ── Refusals / fallbacks / uncertainty recorded during generation ─────────
  L.push('');
  L.push('## Refusals, fallbacks and uncertainty');
  L.push('');
  const st = (cr.authoredState ?? {}) as Record<string, unknown>;
  const interesting = ['placement_compromises', 'travel_shaped', 'goal_realism', 'ramp_base',
    'pace_blend', 'horizon_raise', 'is_mid_block', 'recent_avg_mpw', 'weeklyAvg4w',
    'tier_peak_weekly_band', 'tier_peak_long_band', 'block_anchor'];
  for (const k of interesting) {
    if (k in st) L.push(`- \`${k}\` = \`${JSON.stringify(st[k])}\``);
  }
  const absent = interesting.filter((k) => !(k in st));
  if (absent.length) L.push(`- not recorded by this run: ${absent.map((k) => `\`${k}\``).join(', ')}`);
  L.push('');
  L.push(`Full authored_state keys: ${Object.keys(st).sort().map((k) => `\`${k}\``).join(', ')}`);

  L.push('');
  L.push('## Every week in full');
  L.push('');
  L.push(...detail);
  console.log(L.join('\n'));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
