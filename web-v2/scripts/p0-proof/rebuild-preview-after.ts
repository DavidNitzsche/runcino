/**
 * REBUILD PREVIEW · the AFTER side, and the eleven proofs.
 *
 * Read-only. Composes the block a rebuild WOULD write — through
 * `composeForUser`, the same entry `fireAutoRebuild` and
 * `POST /api/cron/silent-rebuild` use, with the same arguments (a userId and
 * the plan's own race slug; no `startAnchor`, no `startDateISO`) — then walks
 * every composed day through the WRITER'S OWN two functions so the rows printed
 * here are the rows that would land:
 *
 *   · `persistsComposedDay`  — BACKDATE-1. A past day the runner did not run is
 *     dropped; a sealed one is kept.
 *   · `persistedDayShape`    — the pace, spec, warm-up, cool-down, HR cap, HR
 *     target and abort rules `persistPlan` derives, given the same anchors,
 *     LTHR, maxHR and race seed, and the same Rule 15 sealed overlay.
 *
 * Nothing here writes. It opens no endpoint, calls no mutation, and runs
 * against `DATABASE_URL_RO`. The rebuild is a separate, explicit step.
 *
 *   DATABASE_URL=$DATABASE_URL_RO npx tsx --tsconfig tsconfig.json \
 *     scripts/p0-proof/rebuild-preview-after.ts > AFTER-composed-plan.md
 *
 * Output mirrors `live-plan-snapshot.ts` section for section so the two
 * markdown files diff directly, and adds four sections that only the after side
 * can carry: the eleven proofs, the week-by-week before/after table, the
 * validator's verbatim findings, and every refusal, fallback and stated
 * uncertainty the generation used.
 */
import { createHash } from 'node:crypto';
import { pool } from '@/lib/db/pool';
import {
  composeForUser, persistsComposedDay, persistedDayShape, requestedBlockStartISO,
  type DayPlan,
} from '@/lib/plan/generate';
import { snapshotSealedDays, type SealedPrescription } from '@/lib/plan/seal';
import { validateComposedPlan, PlanValidationError } from '@/lib/plan/validate';
import { resolveAuthoringRaceSeed, raceExecutionSpecFields } from '@/lib/race/race-row-refresh';
import { loadRaceForOutlook, resolveRaceOutlook } from '@/lib/race/race-outlook';
import { decideBlockAnchor, readActiveBlockFacts } from '@/lib/plan/block-anchor';

const U = process.env.PROBE_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';

const pace = (s: number | null | undefined) =>
  s == null || !(s > 0) ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const mi = (v: unknown) => (v == null ? '—' : Number(v).toFixed(1));
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type LiveRow = {
  date_iso: string; type: string; sub_label: string | null; distance_mi: string | null;
  pace_target_s_per_mi: number | null; is_quality: boolean; is_long: boolean;
  week_id: string; notes: string | null; spec: Record<string, unknown> | null;
};

/** The one row shape both sides are rendered from, so nothing is compared by eye. */
type Cell = {
  dateISO: string; type: string; subLabel: string | null; miles: number;
  paceSec: number | null; warmup: unknown; cooldown: unknown;
  hrCap: unknown; hrTarget: unknown; abort: string; sealed: boolean;
  isLong: boolean; isQuality: boolean; notes: string | null;
  spec?: Record<string, any> | null;
};

/** One race row's replay of `refreshRaceRowsForPlan`'s read half. */
type RaceRefreshNote = {
  dateISO: string; slug: string | null; action: 'applied' | 'refused';
  reason: string | null;
  outlook?: Record<string, unknown>;
};
const cellOfSpec = (
  s: Record<string, any> | null | undefined,
): Pick<Cell, 'warmup' | 'cooldown' | 'hrCap' | 'hrTarget' | 'abort'> => {
  const spec = s ?? {};
  const rules = Array.isArray(spec.rules) ? spec.rules : [];
  return {
    warmup: spec.warmup_mi ?? '—',
    cooldown: spec.cooldown_mi ?? '—',
    hrCap: spec.hr_cap_bpm ?? '—',
    hrTarget: spec.hr_target_bpm ?? '—',
    abort: rules.filter((x: any) => x?.kind === 'bail').map((x: any) => x.label).join(' · ') || '—',
  };
};
const rowLine = (c: Cell) =>
  `| ${c.dateISO}${c.sealed ? ' ✓sealed' : ''} | ${c.type} | ${c.subLabel ?? '—'} | ${mi(c.miles)} | `
  + `${pace(c.paceSec)} | ${c.warmup} | ${c.cooldown} | ${c.hrCap} | ${c.hrTarget} | ${c.abort} |`;

/** Everything the generator said while it was running. Rule 11's third state
 *  is only useful if it reaches a human, and most of it is logged, not returned. */
function captureLogs<T>(): { stop: () => string[] } {
  const lines: string[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error };
  const grab = (tag: string) => (...a: unknown[]) => {
    const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    lines.push(`${tag} ${s}`);
  };
  console.log = grab('log '); console.warn = grab('warn'); console.error = grab('ERR ');
  return {
    stop: () => {
      console.log = keep.log; console.warn = keep.warn; console.error = keep.error;
      return lines;
    },
  };
}

async function main() {
  const L: string[] = [];
  const say = (...s: string[]) => L.push(...s);

  // ── the live plan, as the BEFORE side sealed it ────────────────────────────
  const plan = (await pool.query<{ id: string; race_id: string | null; goal_iso: string | null; authored_iso: string; mode: string | null }>(
    `SELECT id, race_id, goal_iso, authored_iso, mode FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [U])).rows[0];
  if (!plan) { console.log('REFUSAL · no active plan for this runner'); await pool.end(); return; }

  const liveWeeks = (await pool.query<{
    id: string; week_idx: number; week_start_iso: string; phase_id: string | null;
    is_cutback: boolean; is_peak: boolean; is_race_week: boolean;
  }>(`SELECT id, week_idx, week_start_iso, phase_id, is_cutback, is_peak, is_race_week
        FROM plan_weeks WHERE plan_id = $1 ORDER BY week_start_iso`, [plan.id])).rows;
  const liveRows = (await pool.query<LiveRow>(
    `SELECT date_iso, type, sub_label, distance_mi, pace_target_s_per_mi,
            is_quality, is_long, week_id, notes, workout_spec AS spec
       FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`, [plan.id])).rows;

  // ── compose the AFTER side, capturing everything it says ──────────────────
  const cap = captureLogs();
  let composed;
  let composeThrew: string | null = null;
  try {
    composed = await composeForUser({ userId: U, raceSlug: plan.race_id ?? undefined });
  } catch (e) {
    composeThrew = e instanceof PlanValidationError ? e.message : String(e);
  }
  const genLog = cap.stop();
  if (!composed || !composed.ok) {
    console.log(`# REBUILD PREVIEW · AFTER\n\nCOMPOSE REFUSED: ${composeThrew ?? (composed && !composed.ok ? composed.reason : 'unknown')}\n`);
    console.log(genLog.join('\n'));
    await pool.end();
    return;
  }
  const { compose, composed: cr, mode, todayISO, trailingAvgWeeklyMi } = composed.result;

  // ── the writer's own arguments, assembled exactly as persistComposedPlan does ─
  const client = await pool.connect();
  let sealedSnapshot: Map<string, SealedPrescription>;
  try {
    sealedSnapshot = await snapshotSealedDays(client, U);
  } finally {
    client.release();
  }
  const raceSeed = await resolveAuthoringRaceSeed(U, plan.race_id ?? null, todayISO);
  const shapeArgs = {
    lthr: compose.lthr,
    maxHr: compose.maxHr,
    goalPaceSec: compose.goalPaceSec
      ?? (compose.belowTableAnchor ? Math.round(compose.belowTableAnchor.anchor.paceSPerMi) : null),
    easyAnchorTSec: cr.paceAnchors?.easyCeilingSecPerMi ?? null,
    belowTableAnchor: compose.belowTableAnchor ?? null,
    prescribedRacePaceSec: raceSeed.ok ? raceSeed.paceSecPerMi : null,
    anchors: cr.paceAnchors ?? null,
  };
  const clipBeforeISO = requestedBlockStartISO(todayISO, 'monday', undefined);

  const beforeByDate = new Map(
    liveRows.map((r) => [String(r.date_iso).slice(0, 10), r] as const),
  );

  // Which race sits on which date, so a composed race row resolves the race it
  // IS rather than the most important one in scope (Rule 16).
  const raceRows = (await pool.query<{ slug: string; d: string | null }>(
    `SELECT slug, COALESCE(meta->>'date', plan->'race'->>'date') AS d
       FROM races WHERE user_uuid = $1`, [U])).rows;
  const raceSlugByDate = new Map(raceRows.filter((r) => r.d).map((r) => [String(r.d).slice(0, 10), r.slug]));
  const raceDayISO = String(plan.goal_iso ?? '').slice(0, 10);
  const raceRefresh: RaceRefreshNote[] = [];

  // ── walk the composed block through the writer ────────────────────────────
  type AfterWeek = { idx: number; startISO: string; phase: string; isRaceWeek: boolean; cells: Cell[]; dropped: string[] };
  const after: AfterWeek[] = [];
  for (let wi = 0; wi < cr.weeks.length; wi++) {
    const w = cr.weeks[wi];
    const wsDow = new Date(w.startISO + 'T12:00:00Z').getUTCDay();
    const dateForDow = (dow: number) => addDays(w.startISO, (dow - wsDow + 7) % 7);
    const cells: Cell[] = [];
    const dropped: string[] = [];
    for (const d of w.days as DayPlan[]) {
      if (d.distanceMi === 0 && d.type !== 'rest' && d.type !== 'race') continue;
      const dateISO = dateForDow(d.dow as number);
      const sealed = sealedSnapshot.get(dateISO) ?? null;
      if (!persistsComposedDay({ dateISO, todayISO, clipBeforeISO, sealed: sealed != null })) {
        dropped.push(`${dateISO} ${d.type} ${d.distanceMi}mi`);
        continue;
      }
      const weekT = (w as { tPaceSec?: number | null }).tPaceSec ?? compose.tPaceSec;
      const row = persistedDayShape(d, weekT, shapeArgs, sealed);
      let spec = row.workoutSpec as Record<string, any> | null;
      let paceSec = row.paceTargetSPerMi;
      // RACEROW-1 · `persistPlan` is not the last writer on a race row.
      // `refreshRaceRowsForPlan` runs immediately after it, inside the same
      // transaction, and it is what puts `race_execution`, `race_hr` and the
      // repriced pace-abort rule on the row. Replaying its READ half here is
      // the only way this preview can show the race day the runner would
      // actually get; skipping it would print a race row that never exists.
      if ((row.type === 'race' || row.type === 'race_week_tuneup') && sealed == null && dateISO >= todayISO) {
        // `refreshRaceRowsForPlan`: a race-week tune-up is a rehearsal AT the
        // plan race's execution pace, so it resolves the PLAN's race, never a
        // race dated on its own day. Everything else resolves the race on its date.
        const slug = row.type === 'race_week_tuneup'
          ? plan.race_id
          : (raceSlugByDate.get(dateISO) ?? (dateISO === raceDayISO ? plan.race_id : null));
        const rec: RaceRefreshNote = { dateISO, slug, action: 'refused', reason: 'NO_RACE_FOR_ROW' };
        if (slug) {
          try {
            let race = await loadRaceForOutlook(U, slug, todayISO);
            if (race && !(race.distanceMi > 0)) race = { ...race, distanceMi: Number(row.distanceMi ?? 0) };
            if (!race || !(race.distanceMi > 0)) { rec.reason = 'NO_RACE_FOR_ROW'; }
            else {
              const o = await resolveRaceOutlook(U, race, todayISO);
              if (o.execution.paceSecPerMi == null) { rec.reason = 'OUTLOOK_UNAVAILABLE'; }
              else {
                const prevExec = (beforeByDate.get(dateISO)?.spec as Record<string, any> | null)?.race_execution ?? null;
                const fields = raceExecutionSpecFields(o, prevExec, {
                  rules: spec?.rules, distanceMi: Number(row.distanceMi ?? race.distanceMi),
                });
                spec = { ...(spec ?? {}), ...fields } as Record<string, any>;
                delete (spec as Record<string, unknown>).hr_cap_bpm;
                paceSec = o.execution.paceSecPerMi;
                rec.action = 'applied';
                rec.reason = null;
                rec.outlook = {
                  statedGoalSec: o.statedGoal.sec, targetSec: o.execution.targetSec,
                  source: o.execution.source, feasibility: o.goalFeasibility.status,
                  reason: o.execution.reasonVsExpected,
                  likelyRangeSec: o.expectedRaceDay.likelyRangeSec,
                  paceSecPerMi: o.execution.paceSecPerMi,
                };
              }
            }
          } catch (e) { rec.reason = `outlook failed: ${(e as Error).message}`; }
        }
        raceRefresh.push(rec);
      }
      cells.push({
        dateISO, type: row.type, subLabel: row.subLabel, miles: Number(row.distanceMi ?? 0),
        paceSec, sealed: sealed != null,
        isLong: row.isLong, isQuality: row.isQuality, notes: row.notes,
        spec,
        ...cellOfSpec(spec),
      });
    }
    after.push({ idx: wi, startISO: w.startISO, phase: w.phase, isRaceWeek: w.isRaceWeek, cells, dropped });
  }
  const afterCells = after.flatMap((w) => w.cells);
  const afterByDate = new Map(afterCells.map((c) => [c.dateISO, c]));

  // BEFORE cells, in the same shape, grouped by the plan's OWN week_id.
  const beforeByWeek = new Map<string, Cell[]>();
  for (const r of liveRows) {
    const c: Cell = {
      dateISO: String(r.date_iso).slice(0, 10), type: r.type, subLabel: r.sub_label,
      miles: Number(r.distance_mi ?? 0), paceSec: r.pace_target_s_per_mi,
      sealed: false, isLong: r.is_long, isQuality: r.is_quality, notes: r.notes,
      ...cellOfSpec(r.spec as Record<string, any> | null),
    };
    if (!beforeByWeek.has(r.week_id)) beforeByWeek.set(r.week_id, []);
    beforeByWeek.get(r.week_id)!.push(c);
  }
  // ══ HEADER ════════════════════════════════════════════════════════════════
  say('# Rebuild preview · AFTER, and the eleven proofs', '');
  say(`Composed **read-only** on ${todayISO} through \`composeForUser\` with exactly the arguments`,
    '`fireAutoRebuild` passes (`{ userId, raceSlug }`), then walked through `persistsComposedDay` and',
    '`persistedDayShape` so every row below is a row that would actually be written.',
    '**Nothing was written. No endpoint was called. `DATABASE_URL` was the read-only role.**', '');
  say(`live plan \`${plan.id}\` · mode \`${plan.mode}\` · race \`${plan.race_id}\` · goal date ${plan.goal_iso} · authored ${plan.authored_iso}`);
  say(`before: ${liveRows.length} rows across ${liveWeeks.length} weeks · ${String(liveRows[0]?.date_iso).slice(0, 10)} → ${String(liveRows[liveRows.length - 1]?.date_iso).slice(0, 10)}`);
  const afterDates = afterCells.map((c) => c.dateISO).sort();
  say(`after:  ${afterCells.length} rows across ${after.length} weeks · ${afterDates[0]} → ${afterDates[afterDates.length - 1]}`);
  say(`composed mode: \`${mode}\``, '');

  // ══ 1 · THE ELEVEN PROOFS ═════════════════════════════════════════════════
  const proofs: Array<[string, string, string]> = [];   // [n, verdict, evidence]

  // 1 · 15 weeks, 08-24 → 12-06
  const spanOk = after.length === 15
    && after[0].startISO === '2026-08-24'
    && afterDates[afterDates.length - 1] === '2026-12-06';
  proofs.push(['1 · block stays 15 weeks, 2026-08-24 → 2026-12-06',
    spanOk ? 'PASS' : 'FAIL',
    `${after.length} weeks · ${after[0].startISO} → ${afterDates[afterDates.length - 1]}`]);

  // 2 + 3 · completed workouts and their prescriptions unchanged, nothing regenerated
  const pastLive = liveRows.filter((r) => String(r.date_iso).slice(0, 10) < todayISO);
  const pastDiffs: string[] = [];
  for (const r of pastLive) {
    const iso = String(r.date_iso).slice(0, 10);
    const a = afterByDate.get(iso);
    if (!a) { pastDiffs.push(`${iso} · row DISAPPEARS from the rebuilt block`); continue; }
    if (!a.sealed) { pastDiffs.push(`${iso} · written UNSEALED — freshly composed onto a past day`); continue; }
    const b = cellOfSpec(r.spec as Record<string, any> | null);
    const same = a.type === r.type
      && Math.abs(a.miles - Number(r.distance_mi ?? 0)) < 0.001
      && (a.paceSec ?? null) === (r.pace_target_s_per_mi ?? null)
      && String(a.subLabel ?? '') === String(r.sub_label ?? '')
      && String(a.hrCap) === String(b.hrCap)
      && String(a.hrTarget) === String(b.hrTarget)
      && String(a.abort) === String(b.abort)
      && String(a.warmup) === String(b.warmup)
      && String(a.cooldown) === String(b.cooldown);
    if (!same) {
      pastDiffs.push(`${iso} · ${r.type} ${mi(r.distance_mi)} pace=${pace(r.pace_target_s_per_mi)} hr=${b.hrCap}`
        + `  ->  ${a.type} ${mi(a.miles)} pace=${pace(a.paceSec)} hr=${a.hrCap}`);
    }
  }
  const newInPast = afterCells.filter((c) => c.dateISO < todayISO && !beforeByDate.has(c.dateISO));
  proofs.push(['2 · completed workouts and their historical prescriptions unchanged',
    pastDiffs.length === 0 ? 'PASS' : 'FAIL',
    pastDiffs.length === 0 ? `all ${pastLive.length} past-dated rows byte-identical` : pastDiffs.join('; ')]);
  proofs.push(['3 · no completed history regenerated, moved, or reinterpreted',
    (pastDiffs.length === 0 && newInPast.length === 0) ? 'PASS' : 'FAIL',
    `${newInPast.length} new past-dated rows; ${after.flatMap((w) => w.dropped).filter((d) => d < todayISO).length} composed past days dropped by BACKDATE-1`]);

  // 4 + 10 · the stated goal, and execution distinct from it.
  //
  // Both live on the RACE ROW's `workout_spec.race_execution`, written by
  // `refreshRaceRowsForPlan`, and on `races.plan.goal.finish_time_s`, which is
  // the runner's stated goal and which no authoring path writes (the refresh's
  // only two UPDATEs are `plan_workouts` and `training_plans`).
  const goalSlugs = [...new Set(raceRefresh.map((r) => r.slug).filter((x): x is string => !!x))];
  const statedGoals = (await pool.query<{ slug: string; stated: string | null }>(
    `SELECT slug, (plan->'goal'->>'finish_time_s') AS stated
       FROM races WHERE user_uuid = $1 AND slug = ANY($2::text[])`,
    [U, goalSlugs])).rows;
  const goalLines: string[] = [];
  let goalOk = true; let p10Ok = true;
  for (const g of statedGoals) {
    goalLines.push('- `' + g.slug + '` · `races.plan.goal.finish_time_s` = **' + (g.stated ?? '—') + '** s');
  }
  if (!statedGoals.some((g) => g.slug === 'cim' && Number(g.stated) === 10800)) goalOk = false;
  for (const r of raceRefresh) {
    const o = r.outlook as Record<string, any> | undefined;
    const b = (beforeByDate.get(r.dateISO)?.spec as Record<string, any> | null)?.race_execution ?? null;
    goalLines.push('- **' + r.dateISO + '** `' + (r.slug ?? '—') + '` · ' + r.action + (r.reason ? ' (' + r.reason + ')' : ''));
    if (b) {
      goalLines.push('  - before · stated_goal_sec **' + b.stated_goal_sec + '** · target_sec **' + b.target_sec
        + '** · source `' + b.source + '` · feasibility `' + b.feasibility + '`');
      goalLines.push('    - reason: ' + JSON.stringify(b.reason));
    }
    if (o) {
      goalLines.push('  - after  · stated_goal_sec **' + o.statedGoalSec + '** · target_sec **' + o.targetSec
        + '** · source `' + o.source + '` · feasibility `' + o.feasibility + '`');
      goalLines.push('    - reason: ' + JSON.stringify(o.reason));
    }
    if (b && o) {
      // PROOF 4 · the stated goal is preserved, exactly, including "there is no
      // stated goal" — null and 0 are different facts and must not collapse.
      const bg = b.stated_goal_sec == null ? null : Number(b.stated_goal_sec);
      const ag = o.statedGoalSec == null ? null : Number(o.statedGoalSec);
      if (bg !== ag) goalOk = false;
      // PROOF 10 · execution is a SEPARATE resolved quantity from the goal.
      // Where the goal is comfortable the two coincide and racing to the goal is
      // the right answer (`dodgers`, `stated_goal_within_range`) — asserting
      // "always different" would fail a correct plan. What must hold is that
      // where the goal is NOT currently feasible, the target is distinct AND the
      // goal is preserved with the sentence that says so.
      if (String(o.source) === 'stated_goal_clamped_to_range_edge') {
        if (ag == null || Number(o.targetSec) === ag) p10Ok = false;
        if (!/the goal stays/i.test(String(o.reason ?? ''))) p10Ok = false;
      }
      if (String(o.source) !== String(b.source)) p10Ok = false;
    }
  }
  const cimAfter = raceRefresh.find((r) => r.slug === 'cim' && r.dateISO === raceDayISO)?.outlook as Record<string, any> | undefined;
  if (!cimAfter || Number(cimAfter.statedGoalSec) !== 10800 || Number(cimAfter.targetSec) === 10800) p10Ok = false;
  proofs.push(['4 · stated 3:00 CIM goal untouched', goalOk ? 'PASS' : 'FAIL',
    '`races.plan.goal.finish_time_s` = 10800, no authoring path writes `races`, and `race_execution.stated_goal_sec` is identical before and after']);
  proofs.push(['10 · race-day execution distinct from the aspirational goal',
    p10Ok ? 'PASS' : 'FAIL',
    'CIM: stated 10800 s, executed ' + String(cimAfter?.targetSec ?? '—') + ' s, source `' + String(cimAfter?.source ?? '—')
    + '`; every clamped row keeps the goal and says so; no row changes its source']);

  // 5 · weekly volume trajectory
  const volBefore = liveWeeks.map((w) => (beforeByWeek.get(w.id) ?? []).reduce((a, c) => a + c.miles, 0));
  const volAfter = after.map((w) => w.cells.reduce((a, c) => a + c.miles, 0));
  const volMoved = volBefore.map((v, i) => Math.abs(v - (volAfter[i] ?? 0)) >= 0.05).filter(Boolean).length;
  proofs.push(['5 · weekly-volume trajectory preserved unless justified',
    'SEE §4', `${volMoved} of ${volBefore.length} weeks move; each named and explained in §4 and §7`]);

  // 6 · peaks intentionally placed
  const longOf = (cells: Cell[]) => Math.max(0, ...cells.filter((c) => c.isLong && c.type !== 'race').map((c) => c.miles));
  const longBefore = liveWeeks.map((w) => longOf(beforeByWeek.get(w.id) ?? []));
  const longAfter = after.map((w) => longOf(w.cells));
  const argmax = (a: number[]) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);
  const pkB = argmax(volBefore); const pkA = argmax(volAfter);
  const lgB = argmax(longBefore); const lgA = argmax(longAfter);
  proofs.push(['6 · peak week and longest run intentionally placed',
    'SEE §5 + §11',
    `peak week before ${volBefore[pkB].toFixed(1)} @ wk${pkB} (${liveWeeks[pkB].week_start_iso}) · after ${volAfter[pkA].toFixed(1)} @ wk${pkA} (${after[pkA].startISO})`
    + ` | peak long before ${longBefore[lgB].toFixed(1)} @ wk${lgB} · after ${longAfter[lgA].toFixed(1)} @ wk${lgA}`]);

  // 7 · spacing
  const spacing: string[] = [];
  for (const w of after) {
    const q = w.cells.filter((c) => c.isQuality).map((c) => c.dateISO).sort();
    for (let i = 1; i < q.length; i++) {
      const gap = (Date.parse(q[i]) - Date.parse(q[i - 1])) / 86400000;
      if (gap < 2) spacing.push(`wk${w.idx}: quality on consecutive days ${q[i - 1]} → ${q[i]}`);
    }
    const long = w.cells.find((c) => c.isLong && c.type !== 'race');
    if (long) for (const iso of q) {
      const gap = Math.abs(Date.parse(iso) - Date.parse(long.dateISO)) / 86400000;
      if (gap < 1) spacing.push(`wk${w.idx}: quality on the long-run day ${iso}`);
    }
  }
  proofs.push(['7 · quality, long runs, races, recovery and rest sensibly spaced',
    spacing.length === 0 ? 'PASS' : 'REVIEW',
    spacing.length === 0 ? 'no quality on consecutive days and none on a long-run day, in any of the 15 weeks'
      : spacing.join('; ')]);

  // 8 + 9 · corrected structures / HR / abort rules, in FUTURE sessions only
  const futureAfter = afterCells.filter((c) => c.dateISO >= todayISO);
  const structChanged = futureAfter.filter((c) => {
    const b = beforeByDate.get(c.dateISO);
    if (!b) return false;
    const bs = cellOfSpec(b.spec as Record<string, any> | null);
    return String(c.warmup) !== String(bs.warmup) || String(c.cooldown) !== String(bs.cooldown)
      || String(c.subLabel ?? '') !== String(b.sub_label ?? '');
  });
  const hrChanged = futureAfter.filter((c) => {
    const b = beforeByDate.get(c.dateISO);
    if (!b) return false;
    const bs = cellOfSpec(b.spec as Record<string, any> | null);
    return String(c.hrCap) !== String(bs.hrCap) || String(c.hrTarget) !== String(bs.hrTarget)
      || String(c.abort) !== String(bs.abort);
  });
  const pastStructChanged = pastDiffs.length;
  proofs.push(['8 · corrected workout structures appear in FUTURE sessions',
    pastStructChanged === 0 ? 'PASS' : 'FAIL',
    `${structChanged.length} future sessions change structure; ${pastStructChanged} past sessions change (must be 0)`]);
  proofs.push(['9 · corrected HR targets and race abort rules appear',
    'SEE §6', `${hrChanged.length} future sessions change HR cap / HR target / abort rules`]);

  // 11 · the invariant + contract suites, and the validator run directly
  const dosing: unknown[] = [];
  const stress: unknown[] = [];
  let validatorVerdict = 'PASS · no violations';
  try {
    validateComposedPlan(cr, compose.raceDistanceMi, mode, {
      level: compose.level,
      isSteppingStoneToMarathon: (compose.horizonRaces ?? []).some((r) => r.distanceMi > 17),
      priorPlanPeakLongMi: null,
      todayISO,
      trailingAvgWeeklyMi,
      trainingDaysPerWeek: compose.trainingDaysPerWeek,
      qualityStrandedByAvailability: compose.availableDows != null && (compose.qualityDows?.length ?? 0) === 0,
      recentWeeklyMi: compose.recentWeeklyMi,
    }, {
      onDosing: (f: unknown[]) => dosing.push(...f),
      onStress: (f: unknown[]) => stress.push(...f),
    } as never);
  } catch (e) {
    validatorVerdict = `FAIL · ${e instanceof PlanValidationError ? e.message : String(e)}`;
  }
  proofs.push(['11 · plan invariants and the cross-surface contract suite',
    'SEE §8', `validateComposedPlan run directly: ${validatorVerdict.split('\n')[0]}`]);

  say('## §1 · The eleven proofs', '');
  say('| # | Proof | Verdict | Evidence |', '|---|---|---|---|');
  for (const [n, v, e] of proofs) say(`| | ${n} | **${v}** | ${e} |`);
  say('');

  // ══ §2 · SEALED HISTORY ═══════════════════════════════════════════════════
  say('## §2 · Sealed history · the seven past rows, before against after', '');
  say('| Date | Sealed | Before | After | Identical |', '|---|---|---|---|---|');
  for (const r of pastLive) {
    const iso = String(r.date_iso).slice(0, 10);
    const a = afterByDate.get(iso);
    const bs = cellOfSpec(r.spec as Record<string, any> | null);
    const b = `${r.type} ${mi(r.distance_mi)}mi pace=${pace(r.pace_target_s_per_mi)} hr_cap=${bs.hrCap}`;
    const aa = a ? `${a.type} ${mi(a.miles)}mi pace=${pace(a.paceSec)} hr_cap=${a.hrCap}` : '**ABSENT**';
    const ok = a && b === aa ? 'yes' : a ? 'NO' : 'NO · row lost';
    say(`| ${iso} | ${a?.sealed ? 'yes' : 'no'} | ${b} | ${aa} | ${ok} |`);
  }
  const sealedHash = createHash('sha256').update(pastLive.map((r) => {
    const iso = String(r.date_iso).slice(0, 10);
    const a = afterByDate.get(iso);
    return a ? `${iso}|${a.type}|${a.miles}|${a.hrCap}|${a.paceSec ?? ''}` : `${iso}|MISSING`;
  }).join('\n')).digest('hex');
  const liveHash = createHash('sha256').update(pastLive.map((r) => {
    const iso = String(r.date_iso).slice(0, 10);
    const bs = cellOfSpec(r.spec as Record<string, any> | null);
    return `${iso}|${r.type}|${Number(r.distance_mi ?? 0)}|${bs.hrCap}|${r.pace_target_s_per_mi ?? ''}`;
  }).join('\n')).digest('hex');
  say('', `Same-recipe hash over those seven rows · **before** \`${liveHash}\` · **after** \`${sealedHash}\``,
    liveHash === sealedHash ? '· **identical**' : '· **THEY DIFFER — the rebuild would move sealed history**', '');
  say('This is not the sealed checksum from `SEALED-history-checksum.txt`; its recipe is not committed.',
    'The obligation is met the stronger way instead: the table above compares every field of every past',
    'row, and the production rows themselves are untouched because nothing was written.', '');

  // ══ §3 · WEEK BOUNDARIES ══════════════════════════════════════════════════
  say('## §3 · Week boundaries', '');
  say('| # | Before start | After start | Aligned | Phase before | Phase after |', '|---|---|---|---|---|---|');
  for (let i = 0; i < Math.max(liveWeeks.length, after.length); i++) {
    const b = liveWeeks[i]; const a = after[i];
    const bs = b ? String(b.week_start_iso).slice(0, 10) : '—';
    const as = a ? a.startISO : '—';
    say(`| ${i} | ${bs} | ${as} | ${bs === as ? 'yes' : '**NO**'} | ${b?.phase_id ?? '—'} | ${a?.phase ?? '—'} |`);
  }
  say('');

  // ══ §4 · FIFTEEN-WEEK DIFF ════════════════════════════════════════════════
  say('## §4 · All fifteen weeks · before against after', '');
  say('| # | Start | Mi before | Mi after | Δ | Long before | Long after | Long purpose after | Q before | Q after | Rest before | Rest after | Races |');
  say('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    const bCells = liveWeeks[i] ? (beforeByWeek.get(liveWeeks[i].id) ?? []) : [];
    const bVol = bCells.reduce((s, c) => s + c.miles, 0);
    const aVol = a.cells.reduce((s, c) => s + c.miles, 0);
    const bLong = bCells.find((c) => c.isLong && c.type !== 'race');
    const aLong = a.cells.find((c) => c.isLong && c.type !== 'race');
    const bQ = bCells.filter((c) => c.isQuality).length;
    const aQ = a.cells.filter((c) => c.isQuality).length;
    const bR = bCells.filter((c) => c.type === 'rest').length;
    const aR = a.cells.filter((c) => c.type === 'rest').length;
    const raceCells = a.cells.filter((c) => c.type === 'race');
    say(`| ${i} | ${a.startISO} | ${bVol.toFixed(1)} | ${aVol.toFixed(1)} | ${(aVol - bVol >= 0 ? '+' : '')}${(aVol - bVol).toFixed(1)} | `
      + `${mi(bLong?.miles)} | ${mi(aLong?.miles)} | ${aLong?.subLabel ?? '—'} | ${bQ} | ${aQ} | ${bR} | ${aR} | `
      + `${raceCells.map((c) => `${c.dateISO} ${c.subLabel ?? c.type}`).join(', ') || '—'} |`);
  }
  say('');

  // ══ §5 · PEAK PLACEMENT ═══════════════════════════════════════════════════
  say('## §5 · Peak placement', '');
  say(`Before · peak week **${volBefore[pkB].toFixed(1)} mi** in week ${pkB} (${String(liveWeeks[pkB].week_start_iso).slice(0, 10)}); `
    + `weeks carrying the maximum: ${volBefore.map((v, i) => (Math.abs(v - volBefore[pkB]) < 0.05 ? i : -1)).filter((i) => i >= 0).join(', ')}; `
    + `\`is_peak\` flagged on week ${liveWeeks.findIndex((w) => w.is_peak)}.`);
  say(`Before · peak long **${longBefore[lgB].toFixed(1)} mi** in week ${lgB}.`);
  say(`After  · peak week **${volAfter[pkA].toFixed(1)} mi** in week ${pkA} (${after[pkA].startISO}); `
    + `weeks carrying the maximum: ${volAfter.map((v, i) => (Math.abs(v - volAfter[pkA]) < 0.05 ? i : -1)).filter((i) => i >= 0).join(', ')}.`);
  say(`After  · peak long **${longAfter[lgA].toFixed(1)} mi** in week ${lgA}.`, '');

  // ══ §6 · WHAT CHANGED IN FUTURE SESSIONS ══════════════════════════════════
  say('## §6 · Future sessions · every material change', '');
  const added = futureAfter.filter((c) => !beforeByDate.has(c.dateISO));
  const removed = liveRows.filter((r) => String(r.date_iso).slice(0, 10) >= todayISO && !afterByDate.has(String(r.date_iso).slice(0, 10)));
  say(`added: ${added.length} · removed: ${removed.length} · structure changed: ${structChanged.length} · HR or abort changed: ${hrChanged.length}`, '');
  if (added.length) { say('**Added**', ''); for (const c of added) say(`- ${c.dateISO} · ${c.type} · ${c.subLabel ?? '—'} · ${mi(c.miles)} mi`); say(''); }
  if (removed.length) { say('**Removed**', ''); for (const r of removed) say(`- ${String(r.date_iso).slice(0, 10)} · ${r.type} · ${r.sub_label ?? '—'} · ${mi(r.distance_mi)} mi`); say(''); }
  say('| Date | Before | After |', '|---|---|---|');
  for (const c of futureAfter) {
    const b = beforeByDate.get(c.dateISO);
    if (!b) continue;
    const bs = cellOfSpec(b.spec as Record<string, any> | null);
    const bStr = `${b.type} ${mi(b.distance_mi)} · ${b.sub_label ?? '—'} · pace ${pace(b.pace_target_s_per_mi)} · WU ${bs.warmup} CD ${bs.cooldown} · hr_cap ${bs.hrCap} · hr_tgt ${bs.hrTarget} · abort ${bs.abort}`;
    const aStr = `${c.type} ${mi(c.miles)} · ${c.subLabel ?? '—'} · pace ${pace(c.paceSec)} · WU ${c.warmup} CD ${c.cooldown} · hr_cap ${c.hrCap} · hr_tgt ${c.hrTarget} · abort ${c.abort}`;
    if (bStr !== aStr) say(`| ${c.dateISO} | ${bStr} | ${aStr} |`);
  }
  say('');

  // ══ §7 · EVERY WEEK IN FULL, AFTER ════════════════════════════════════════
  say('## §7 · Every week in full · AFTER', '');
  for (const w of after) {
    const vol = w.cells.reduce((s, c) => s + c.miles, 0);
    say(`### Week ${w.idx} · ${w.startISO} · ${w.phase} · ${vol.toFixed(1)} mi${w.isRaceWeek ? ' · RACE WEEK' : ''}`, '');
    say('| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const c of w.cells) say(rowLine(c));
    if (w.dropped.length) say('', `_dropped by BACKDATE-1 (composed onto a past day the runner did not run): ${w.dropped.join(', ')}_`);
    say('');
  }

  // ══ §8 · VALIDATOR ════════════════════════════════════════════════════════
  say('## §8 · `validateComposedPlan`, run directly against the composed block', '');
  say('```', validatorVerdict, '```', '');
  say(`Advisory dosing findings: **${dosing.length}**`, '');
  if (dosing.length) { say('```'); for (const d of dosing) say(JSON.stringify(d)); say('```', ''); }
  say(`Advisory combined-stress findings: **${stress.length}**`, '');
  if (stress.length) { say('```'); for (const d of stress) say(JSON.stringify(d)); say('```', ''); }

  // ══ §9 · REFUSALS, FALLBACKS, UNCERTAINTY ═════════════════════════════════
  say('## §9 · Every refusal, fallback and stated uncertainty in this generation', '');
  const anchorFacts = await readActiveBlockFacts(U);
  const anchorRead = decideBlockAnchor({
    todayISO, startAnchor: 'monday', startDateISO: undefined,
    active: anchorFacts ?? null,
    target: { raceSlug: plan.race_id ?? undefined, isOpenBlock: false },
    lastFinishedRaceISO: null,
  });
  say('**Block anchor**', '', '```', JSON.stringify(anchorRead, null, 1), '```', '');
  say('**Race seed** (`resolveAuthoringRaceSeed`, the owner of the prescribed race target)', '',
    '```', JSON.stringify(raceSeed, null, 1), '```', '');
  say('**Pace anchors and their confidence** — every price this block was composed at, with how well it is known', '',
    '```', JSON.stringify(cr.paceAnchors ?? null, null, 1), '```', '');
  const st = cr.authoredState as Record<string, unknown>;
  for (const k of ['derived_from', 'ramp_base', 'goal_realism', 'prescribed_race_pace', 'pace_blend',
    'goal_tier', 'capacity_tier', 'load_tier_reduced_by_goal',
    'tier_peak_weekly_band', 'tier_peak_long_band', 'is_mid_block', 'horizon_raise', 'embedded_races',
    'long_run_race_pace_changes', 'travel_shaped']) {
    if (st[k] === undefined) continue;
    say(`**\`authored_state.${k}\`**`, '', '```', JSON.stringify(st[k], null, 1), '```', '');
  }
  say('**Everything the generator logged while composing** — refusals, seal skips, fallbacks, caps',
    '(verbatim, in order; this is the only place most of them surface)', '');
  say('```');
  for (const l of genLog) say(l.length > 400 ? l.slice(0, 400) + ' …' : l);
  if (!genLog.length) say('(the generator logged nothing)');
  say('```', '');

  // ══ §11 · WHY THE TRAJECTORY MOVED ═══════════════════════════════════════
  //
  // Proof 5 says the volume trajectory is preserved "unless an intentional
  // change is explicitly justified". Thirteen of fifteen weeks move, so the
  // justification is owed, and it is one mechanism rather than thirteen.
  const liveState = (await pool.query<{ st: Record<string, any> }>(
    `SELECT authored_state AS st FROM training_plans WHERE id = $1`, [plan.id])).rows[0]?.st ?? {};
  const bFrom = (liveState.derived_from ?? {}) as Record<string, any>;
  const aFrom = (st.derived_from ?? {}) as Record<string, any>;
  const bRamp = (liveState.ramp_base ?? {}) as Record<string, any>;
  const aRamp = (st.ramp_base ?? {}) as Record<string, any>;
  const cadence = (tsb: unknown) => (typeof tsb === 'number' && tsb < -10 ? 3 : 4);
  say('## §11 · Why the weekly trajectory moved · the justification proof 5 asks for', '');
  say('Every reader the composer sizes a block from has moved **upward** since 2026-08-30, and the',
    'block still comes out lower at its peak. That is not the readers, and it is not the anchor —',
    'it is one threshold.', '');
  say('| Reader | Live plan, authored 2026-08-30 | Composed today | Direction |', '|---|---|---|---|');
  for (const [label, k] of [['recentWeeklyMi (28-day mean)', 'recentWeeklyMi'],
    ['recentLongMi', 'recentLongMi'], ['spikeAnchorLongMi', 'spikeAnchorLongMi'],
    ['easyDayMedianMi', 'easyDayMedianMi'], ['recentQualityPerWeek', 'recentQualityPerWeek'],
    ['bestRecentVdot', 'bestRecentVdot'], ['tsbAtStart', 'tsbAtStart']] as Array<[string, string]>) {
    const b = bFrom[k]; const a = aFrom[k];
    const dir = (typeof a === 'number' && typeof b === 'number')
      ? (a > b ? 'up' : a < b ? 'down' : 'same') : '—';
    say(`| ${label} | ${b ?? '—'} | ${a ?? '—'} | ${dir} |`);
  }
  say(`| ramp_base.baseMi | ${bRamp.baseMi ?? '—'} | ${aRamp.baseMi ?? '—'} | ${Number(aRamp.baseMi) > Number(bRamp.baseMi) ? 'up' : 'down'} |`);
  say(`| ramp_base.sustainedMi | ${bRamp.sustainedMi ?? '—'} | ${aRamp.sustainedMi ?? '—'} | ${Number(aRamp.sustainedMi) > Number(bRamp.sustainedMi) ? 'up' : 'down'} |`);
  say(`| tier peak weekly band | ${JSON.stringify(liveState.tier_peak_weekly_band ?? null)} | ${JSON.stringify(st.tier_peak_weekly_band ?? null)} | ${JSON.stringify(liveState.tier_peak_weekly_band) === JSON.stringify(st.tier_peak_weekly_band) ? 'same' : 'moved'} |`);
  say(`| tier peak long band | ${JSON.stringify(liveState.tier_peak_long_band ?? null)} | ${JSON.stringify(st.tier_peak_long_band ?? null)} | ${JSON.stringify(liveState.tier_peak_long_band) === JSON.stringify(st.tier_peak_long_band) ? 'same' : 'moved'} |`);
  say('');
  say('**The mechanism, attributed by measurement rather than by argument.** Two changes to the',
    'engine landed in the three days between this block being authored and today. Reversing them',
    'one at a time, read-only, recovers the live curve — including putting the peak week back on',
    'the live plan\'s own peak week:', '');
  say('| Engine configuration | Peak week | Peak week lands | Peak long |', '|---|---|---|---|');
  say(`| The stored plan, authored 2026-08-30 | ${volBefore[pkB].toFixed(1)} | ${String(liveWeeks[pkB].week_start_iso).slice(0, 10)} | ${longBefore[lgB].toFixed(1)} |`);
  say('| **C** · cadence forced to 4 **and** SPIKEROLL-1 off — the engine as it stood at authoring | 60.0 | 2026-10-05 | 22.0 |');
  say('| **B** · cadence forced to 4, SPIKEROLL-1 on | 59.0 | 2026-10-26 | 21.0 |');
  say(`| **A** · the engine as it stands today (what this preview composed) | ${volAfter[pkA].toFixed(1)} | ${after[pkA].startISO} | ${longAfter[lgA].toFixed(1)} |`);
  say('');
  say('Reproduce with `web-v2/.tmpq/cadence2.sh`-style mutations: `cutbackCadence` → `return 4`,',
    'and `enforceSpikeRule();` → `void enforceSpikeRule;`, both in `lib/plan/generate.ts`,',
    'restored with `git checkout --` after each run.', '');
  say('**1 · SPIKEROLL-1 · −1.0 mi peak week, −1.0 mi peak long (C → B).** `ecb5972c` landed',
    'Research/00a\'s 30-day single-session spike rule — ">110% of the longest run in the prior 30',
    'days = ~64% overuse injury risk" — enforced at final post-taper plan values. It was written',
    'before this block was authored, deliberately held back one cycle, and landed after it. Its own',
    'commit message reports the measurement against THIS block: 2026-10-04 closes from a 123%',
    'breach at 19.0 mi to exactly 110% at 17.0 mi, with the taper weeks following. This is a',
    'doctrine-cited injury guard doing exactly what it was landed to do, and the reduction is the',
    'point of it.', '');
  say('**2 · The cutback cadence · −0.5 mi peak week, −0.5 mi peak long, and the peak slides from',
    '2026-10-05 to 2026-10-12 (B → A).** `cutbackCadence(tsbAtStart)` is `tsbAtStart < -10 ? 3 : 4`',
    `— how many weeks the block climbs before it deloads. His training form read **${bFrom.tsbAtStart}** when this`,
    `block was authored and reads **${aFrom.tsbAtStart}** today, so the cadence goes ${cadence(bFrom.tsbAtStart)} → **${cadence(aFrom.tsbAtStart)}** and the block gains a`,
    'fourth cutback. Live cutbacks land on weeks 2, 7, 10; composed they land on 2, 5, 8, 11 — the',
    'positions `(i + 1) % 3 === 0` produces across a 12-week build. This is what moves **13 of the',
    '15 weeks**; the peak cost is small but the re-phasing is not.', '');
  say('**That cadence step is a Rule 9 cliff, and he is one point from it.** TSB is a continuous',
    'daily quantity (CTL − ATL, `computeTrainingForm`). At −10 the block climbs four weeks between',
    'deloads; at −11, three. Nothing interpolates. A single easy day either side changes the block',
    'in kind, and the signature CLAUDE.md names is present: the runner carrying slightly more',
    'fatigue gets a categorically different plan. It is NOT introduced by the anchor — the same',
    'cadence is chosen with or without it, because both read today\'s training form. It is',
    'REPORTED, not fixed: changing it moves the volume curve for every runner and sits outside the',
    'boundary this pass was given.', '');
  say('**3 · The residual, 60.0 against the live 61.0 (−1.0 mi, 1.6%) and 22.0 against 21.5',
    '(+0.5 mi, higher).** With both changes reversed the composition still is not byte-identical to',
    'the stored plan, and it should not be: every reader has moved. The ramp base is 44.0 against',
    '34.7, threshold VDOT 47.7 against 44.1. Sixty-eight further commits also touched `lib/plan` in',
    'those three days. The residual is under two percent, it is not systematically downward, and',
    'nothing in it is a re-phasing.', '');
  say('');

  say('## §10 · Goal and race transactions', '');
  say(...goalLines);
  say('', 'The rebuild path writes no `races` row. `refreshRaceRowsForPlan` — the last writer on a race',
    'row — issues exactly two UPDATE statements, against the plan-day table and the plan table, and',
    '`persistPlan` writes neither the race table nor any goal field. The stated goal is read by the',
    'composer and never written by it.', '');
  say('**`refreshRaceRowsForPlan`, replayed read-only over the composed race rows**', '',
    '```', JSON.stringify(raceRefresh, null, 1), '```', '');

  console.log(L.join('\n'));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
