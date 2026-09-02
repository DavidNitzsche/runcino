/**
 * scripts/beliefs-proof/owner-limiters.ts · READ-ONLY probe.
 *
 * Prints, for the owner's real account, the two things this repo currently
 * calls a "limiter" side by side — the Coaching Thesis's primary limiter
 * (`lib/training/coaching-thesis.ts`, Constitution §F) and the goal-gap's
 * `diagnoseLimiter` read (`lib/coach/limiter.ts`, consumed by
 * `lib/plan/goal-gap.ts#whatClosesIt`) — plus the upcoming quality days on the
 * active plan, so the Rule 16 question ("do two surfaces say two different
 * things under one word") can be answered from output rather than argued.
 *
 * Run (read-only role, from web-v2):
 *   DATABASE_URL=$DATABASE_URL_RO npx tsx --tsconfig tsconfig.json scripts/beliefs-proof/owner-limiters.ts
 */
import { pool } from '@/lib/db/pool';
import { resolveCoachingThesis } from '@/lib/training/coaching-thesis';
import { computeGoalGap } from '@/lib/plan/goal-gap';

const OWNER = process.env.OWNER_UUID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = process.env.TODAY_ISO ?? '2026-09-02';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!/ro|readonly|read_only/i.test(url) && !process.env.ALLOW_NON_RO) {
    throw new Error('refusing: DATABASE_URL does not look like the read-only role (set ALLOW_NON_RO=1 to override)');
  }

  const thesis = await resolveCoachingThesis(OWNER, TODAY);
  console.log(`\n══ COACHING THESIS · ${TODAY} ══`);
  console.log(`  primaryLimiter=${thesis.primaryLimiter} basis=${thesis.basis} priority=${thesis.priority}`);
  console.log(`  confidence=${thesis.confidence} evidenceIds=${JSON.stringify(thesis.evidenceIds)}`);
  console.log(`  coachLine: ${thesis.coachLine}`);
  for (const s of thesis.standings) {
    console.log(`    ${s.capacity.padEnd(14)} ${s.rankable ? `conf=${s.confidence.toFixed(3)} mode=${s.sourceMode}` : `UNRANKABLE(${s.reason}) mode=${s.sourceMode}`}`);
  }
  console.log(`  addressedBy: ${thesis.addressedBy.map((a) => `${a.dateIso} ${a.type} "${a.subLabel}"`).join(' | ') || '(none)'}`);

  const gap = await computeGoalGap(OWNER);
  console.log(`\n══ GOAL-GAP LIMITER (lib/coach/limiter.ts) ══`);
  if (!gap) {
    console.log('  computeGoalGap returned null');
  } else {
    console.log(`  mode=${gap.mode} race=${gap.raceSlug} status=${gap.status} gapSec=${gap.gapSec}`);
    console.log(`  limiter=${JSON.stringify(gap.limiter, null, 2)}`);
    console.log(`  whatClosesIt=${JSON.stringify(gap.whatClosesIt, null, 2)}`);
  }

  const rows = (await pool.query<{ date_iso: string; type: string; sub_label: string | null; pace_target_s_per_mi: number | null; is_long: boolean; is_quality: boolean }>(
    `SELECT pw.date_iso, pw.type, pw.sub_label, pw.pace_target_s_per_mi, pw.is_long, pw.is_quality
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
        AND pw.date_iso::date BETWEEN $2::date AND ($2::date + 21)
        AND (pw.is_quality OR pw.is_long OR pw.type IN ('threshold','tempo','intervals','long'))
      ORDER BY pw.date_iso`,
    [OWNER, TODAY],
  )).rows;
  console.log(`\n══ UPCOMING KEY DAYS (active plan, ${TODAY} +21d) ══`);
  for (const r of rows) {
    console.log(`  ${r.date_iso} ${r.type.padEnd(10)} q=${r.is_quality ? 1 : 0} long=${r.is_long ? 1 : 0} pace=${r.pace_target_s_per_mi ?? '—'}  "${r.sub_label ?? ''}"`);
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
