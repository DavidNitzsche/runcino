/**
 * /api/race
 *
 *   POST   { name, date, distance_label, priority, goal? }  → create
 *   PATCH  { slug, ...fields }                              → update
 *   DELETE { slug }                                         → delete
 *
 * Writes races.meta jsonb. Schema is already in place from legacy.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { generatePlan } from '@/lib/plan/generate';
import { requireUserId } from '@/lib/auth/session';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.date) {
    return NextResponse.json({ error: 'name + date required' }, { status: 400 });
  }
  // 2026-06-05 · backend audit P0-8 fix · same shape as the onboarding
  // race write · slug is the PRIMARY KEY of races and two users picking
  // identical names would have collided. Conflict-detect against the
  // existing owner before write; disambiguate with a userId suffix if
  // a DIFFERENT user already holds the natural slug. Same-user re-add
  // (idempotent) keeps the original slug. Cite docs/2026-06-05-backend
  // -audit.html § P0-8.
  let slug = slugify(`${body.name}-${body.date}`);
  const existing = await pool.query(
    `SELECT user_uuid::text AS u FROM races WHERE slug = $1`,
    [slug],
  ).catch(() => ({ rows: [] as Array<{ u: string }> }));
  if (existing.rows[0] && existing.rows[0].u !== userId) {
    slug = `${slug}-${userId.slice(0, 8)}`;
  }
  // Default priority='A' (locked 2026-05-30 SIM-03): when a runner adds a
  // race to their calendar, they almost always care about it — treating
  // it as a goal race is the right default. Use 'B' for tune-ups and 'C'
  // for training-effort races; both require explicit caller intent.
  const meta = {
    name: body.name,
    date: body.date,
    distanceLabel: body.distance_label ?? null,
    priority: body.priority ?? 'A',
    goalDisplay: body.goal ?? null,
    location: body.location ?? null,
  };

  try {
    // Rule 6 guard: PATCH accumulates result fields onto this same meta blob
    // (finishTime, bib, wave, goalSafeDisplay, retro*, avgHrBpm). A re-add
    // must never full-replace them. Existing keys survive; non-null incoming
    // keys win; incoming nulls (absent form fields) cannot erase. Clearing a
    // field stays PATCH's job, not POST's.
    // 2026-06-10 persona-suite catch: plan + gpx_text are NOT NULL with
    // no defaults — this INSERT failed for any NEW race row (existing
    // rows predate v2 and already carry both). Empty seeds; PATCH and
    // the execution-plan builders own the real content.
    await pool.query(
      `INSERT INTO races (slug, user_uuid, meta, plan, gpx_text)
       VALUES ($1, $2, $3, '{}'::jsonb, '')
       ON CONFLICT (slug) DO UPDATE
         SET meta = races.meta || jsonb_strip_nulls(EXCLUDED.meta)`,
      [slug, userId, meta]
    );
    await bustBriefingCacheForEvent(userId, 'race_crud');

    // Q-05 · auto-generate plan on first A-race when there's no active
    // plan. If there IS an active plan tied to some other race, we DO
    // NOT auto-switch — would be too aggressive. Instead leave it to
    // the runner to explicitly /plan/generate (or accept a future
    // coach_proposals item, when wired).
    let plan: { ok: boolean; plan_id?: string; weeks_generated?: number; reason?: string } | null = null;
    if (meta.priority === 'A') {
      const active = (await pool.query<{ race_id: string | null }>(
        `SELECT race_id FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL LIMIT 1`,
        [userId],
      ).catch(() => ({ rows: [] }))).rows[0];
      if (!active) {
        plan = await generatePlan({ userId, raceSlug: slug }).catch((e: unknown) => ({
          ok: false, reason: e instanceof Error ? e.message : String(e),
        }));
      }
    }

    return NextResponse.json({ ok: true, slug, plan });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** Map common race-distance labels to miles. Used for VDOT + LTHR calibrate. */
function distanceMiFromLabel(label: string | undefined): number | null {
  if (!label) return null;
  const s = String(label).toLowerCase().trim();
  if (s === 'marathon'      || s === '26.2') return 26.2;
  if (s === 'half marathon' || s === 'half' || s === '13.1') return 13.1094;
  if (s === '10k')   return 6.21371;
  if (s === '5k')    return 3.10686;
  if (s === '15k')   return 9.32057;
  if (s === '10mi'   || s === '10 mile') return 10.0;
  if (s === '20mi'   || s === '20 mile') return 20.0;
  // Fallback: try parse number suffixed with 'mi' / 'km'
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(mi|km|k)?$/);
  if (m) {
    const n = parseFloat(m[1]);
    if (!m[2] || m[2] === 'mi') return n;
    if (m[2] === 'km' || m[2] === 'k') return n / 1.609344;
  }
  return null;
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body?.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  try {
    // Scope existence + ownership: a runner can only PATCH a race they own.
    const existing = (await pool.query(
      `SELECT meta FROM races WHERE slug = $1 AND user_uuid = $2`,
      [body.slug, userId],
    )).rows[0];
    if (!existing) return NextResponse.json({ error: 'race not found' }, { status: 404 });
    const meta = { ...existing.meta };
    // Editable plain fields. goal_safe + bib + wave + startTime + registered
    // come from the Faff race-detail editable hero so the runner can stash
    // a B-target and confirmed bib straight off the page.
    for (const k of ['name', 'date', 'distance_label', 'priority', 'goal', 'goal_safe', 'bib', 'wave', 'startTime', 'location', 'registered']) {
      if (body[k] !== undefined) {
        const metaKey = k === 'distance_label' ? 'distanceLabel'
          : k === 'goal' ? 'goalDisplay'
          : k === 'goal_safe' ? 'goalSafeDisplay'
          : k;
        meta[metaKey] = body[k];
      }
    }
    // Retrospective fields — passed through as-is on the meta blob
    for (const k of ['finishTime', 'pb', 'retroFelt', 'retroExecution', 'retroNotes', 'avgHrBpm']) {
      if (body[k] !== undefined) meta[k] = body[k];
    }
    // Per-race fueling (camelCase) — the runner's planned race fuel. Feeds
    // composeRaceExecutionPlan's structured fuel recommendation + the watch
    // gel schedule. Distinct from the runner-level default in users.fuel_*:
    // these override for THIS race. Cite Research/18 §1/§11.
    //   fuelProduct            "Maurten Gel 100"
    //   fuelCarbsPerServingG   25
    //   fuelCadenceMin         25  (take one every N min)
    //   fuelCarbsPerHourTargetG 75 (optional · direct rate, beats cadence)
    // Plus race-morning logistics for a later phone edit sheet (passthrough).
    for (const k of [
      'fuelProduct', 'fuelCarbsPerServingG', 'fuelCadenceMin', 'fuelCarbsPerHourTargetG',
      'shuttle', 'packetPickup', 'officialUrl', 'parking', 'notes',
    ]) {
      if (body[k] !== undefined) meta[k] = body[k];
    }
    await pool.query(
      `UPDATE races SET meta = $1 WHERE slug = $2 AND user_uuid = $3`,
      [meta, body.slug, userId],
    );

    // 2026-06-01 · auto-rebuild plan when the runner edits a field
    // that materially invalidates the existing plan timeline / pacing.
    // No accept gate · the runner made the underlying change, the plan
    // follows automatically. Audit-logged to plan_proposals.
    let autoRebuild: { kind: string; oldPlanId?: string; newPlanId?: string; ok: boolean; reason?: string } | null = null;
    try {
      const prior = existing.meta ?? {};
      let rebuildKind: 'race_date_changed' | 'goal_time_changed' | 'a_race_added' | 'a_race_removed' | null = null;
      const rebuildReasons: Record<string, unknown> = {};
      if (body.date !== undefined && prior.date !== meta.date) {
        rebuildKind = 'race_date_changed';
        rebuildReasons.from_iso = prior.date ?? null;
        rebuildReasons.to_iso = meta.date;
      } else if (body.goal !== undefined && prior.goalDisplay !== meta.goalDisplay) {
        rebuildKind = 'goal_time_changed';
        rebuildReasons.from = prior.goalDisplay ?? null;
        rebuildReasons.to = meta.goalDisplay;
      } else if (body.priority !== undefined && prior.priority !== meta.priority) {
        if (meta.priority === 'A' && prior.priority !== 'A') {
          rebuildKind = 'a_race_added';
          rebuildReasons.from_priority = prior.priority ?? null;
        } else if (prior.priority === 'A' && meta.priority !== 'A') {
          rebuildKind = 'a_race_removed';
          rebuildReasons.to_priority = meta.priority ?? null;
        }
      }
      if (rebuildKind) {
        const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
        const result = await fireAutoRebuild({
          userUuid: userId,
          raceSlug: body.slug,
          kind: rebuildKind,
          reasons: rebuildReasons,
          source: 'race_patch_hook',
        });
        autoRebuild = {
          kind: rebuildKind,
          oldPlanId: result.oldPlanId,
          newPlanId: result.newPlanId,
          ok: result.ok,
          reason: result.reason,
        };
      }
    } catch (e: unknown) {
      console.error('[race PATCH] auto-rebuild warn:', e instanceof Error ? e.message : String(e));
    }

    // P33 — auto-calibrate LTHR + VDOT from race retro when both finish
    // time and avg HR are set. Best-effort: failures don't block save.
    // The recalc deltas are surfaced back on the response so the client
    // can render a StateChangeToast (closes coverage line 1228 · race
    // retro auto-recalc surfacing).
    let recalc: { vdotBefore?: number | null; vdotAfter?: number | null; lthrBefore?: number | null; lthrAfter?: number | null; lthrMethod?: string } | null = null;
    if (meta.finishTime && meta.avgHrBpm && distanceMiFromLabel(meta.distanceLabel) != null) {
      try {
        const distanceMi = distanceMiFromLabel(meta.distanceLabel)!;
        const { parseRaceTime, vdotFromRace } = await import('@/lib/training/vdot');
        const { calibrateLthr } = await import('@/lib/training/lthr');
        const secs = parseRaceTime(String(meta.finishTime));
        const hr = Number(meta.avgHrBpm);
        recalc = {};
        // Read the prior VDOT + LTHR off the most recent coach_intents +
        // profile so the response can carry the before/after diff. No
        // explicit before column for VDOT — best estimate is the most
        // recent vdot_auto_recalc intent.
        const priorVdot = await pool.query<{ value: string }>(
          `SELECT value FROM coach_intents
            WHERE COALESCE(user_uuid::text, user_id) = $1
              AND reason = 'vdot_auto_recalc'
            ORDER BY ts DESC LIMIT 1`,
          [userId]
        ).catch(() => ({ rows: [] }));
        const priorLthr = await pool.query<{ lthr: number | null }>(
          `SELECT lthr FROM profile WHERE user_uuid = $1`,
          [userId]
        ).catch(() => ({ rows: [] }));
        recalc.vdotBefore = priorVdot.rows[0]?.value ? Number(priorVdot.rows[0].value) : null;
        recalc.lthrBefore = priorLthr.rows[0]?.lthr ?? null;
        // VDOT
        if (secs && meta.priority !== 'C') {
          const v = vdotFromRace(secs, distanceMi);
          if (v != null) {
            // No vdot column on profile — coach_intent tells the next
            // briefing about the new estimate.
            await pool.query(
              `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
               VALUES ($1, $1, 'vdot_auto_recalc', 'vdot', $2)`,
              [userId, String(v)]
            );
            recalc.vdotAfter = v;
          }
        }
        // LTHR
        const cal = calibrateLthr(distanceMi, hr);
        if (cal) {
          await pool.query(
            `UPDATE profile
                SET lthr = $1, lthr_method = $2, lthr_set_at = NOW()
              WHERE user_uuid = $3`,
            [cal.lthr, cal.method, userId]
          );
          await pool.query(
            `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
             VALUES ($1, $1, 'lthr_auto_calibrated', 'lthr', $2)`,
            [userId, `${cal.lthr} (${cal.method})`]
          );
          recalc.lthrAfter = cal.lthr;
          recalc.lthrMethod = cal.method;
        }
      } catch (e: any) {
        console.error('[race PATCH] auto-calibrate warn:', e?.message);
      }
    }

    await bustBriefingCacheForEvent(userId, 'race_crud');
    return NextResponse.json({ ok: true, recalc, autoRebuild });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body?.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  try {
    // 2026-06-01 · BEFORE delete · check if this race is the current
    // plan's goal. If so we'll auto-rebuild after the delete (the plan
    // is now orphaned · runner needs guidance toward what to do next).
    // The auto-rebuild itself will FAIL gracefully (race not found),
    // and the proposal row will record the orphan state.
    const planRow = (await pool.query<{ race_id: string | null }>(
      `SELECT race_id FROM training_plans
        WHERE user_uuid = $1 AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [userId],
    ).catch(() => ({ rows: [] }))).rows[0];
    const wasGoalRace = planRow?.race_id === body.slug;

    // Scope to the caller's races so a runner can't DELETE someone else's race by slug.
    await pool.query(
      `DELETE FROM races WHERE slug = $1 AND user_uuid = $2`,
      [body.slug, userId],
    );

    // Audit-only · if this was the goal race, log to plan_proposals so
    // the Today view can surface "your goal race was removed · pick a
    // new race to keep training meaningful." We don't auto-rebuild
    // because there's no race to point at · the runner has to act.
    if (wasGoalRace) {
      try {
        await pool.query(
          `INSERT INTO plan_proposals
             (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
           VALUES ($1, $2, 'a_race_removed', $3::jsonb, 'pending', 'race_delete_hook', NOW())`,
          [
            userId,
            planRow?.race_id ?? null,
            JSON.stringify({
              removed_slug: body.slug,
              orphan: true,
              message: 'Your goal race was removed · pick a new A-race or your plan continues running blind.',
            }),
          ],
        );
      } catch (e: unknown) {
        console.error('[race DELETE] proposal write warn:', e instanceof Error ? e.message : String(e));
      }
    }

    await bustBriefingCacheForEvent(userId, 'race_crud');
    return NextResponse.json({ ok: true, wasGoalRace });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
