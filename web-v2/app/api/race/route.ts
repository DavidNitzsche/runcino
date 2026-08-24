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
import { logReadFailure } from '@/lib/db/read';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { normalizeGoalDisplay } from '@/lib/plan/goal-display'; // CAP-3 · distance-aware goal canonicalization
import { generatePlan } from '@/lib/plan/generate';
import { requireUserId } from '@/lib/auth/session';
import { patchSettings } from '@/lib/coach/settings';
import { distanceMiFromLabel } from '@/lib/race/distance'; // 2026-07-06 · P1-17 · shared label→mi parser
import { isCoachedExternally } from '@/lib/plan/coached-gate';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { suppressDriftNearRace } from '@/lib/plan/drift-proposal-policy';

/** Rule 11's horizon window · A/B races within 24 weeks AFTER the target race
 *  raise the long-run cap (generate.ts loadGeneratorInputs, `+ interval '168
 *  days'`). A race added beyond it cannot change the plan, so it does not
 *  earn a rebuild. */
const HORIZON_DAYS = 168;

function addDaysISO(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000)
    .toISOString().slice(0, 10);
}

function toFriendlyPlanError(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.includes('plan ramp is unsupported by current fitness')) {
    return "Faff doesn't currently support plans for runners at this mileage level. Build your base first, then try again.";
  }
  return raw;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.date) {
    // RULE THREE · `error` is the code, `reason` is the sentence. The phone
    // prints `reason` and nothing else, so a decline with no sentence wears
    // the data-outage treatment on a screen where nothing has gone wrong.
    return NextResponse.json(
      { error: 'name_date_required', reason: 'A race needs a name and a date before it can go on the schedule.' },
      { status: 400 },
    );
  }
  // 2026-06-05 · backend audit P0-8 · slug is the PRIMARY KEY of races and
  // two users picking identical names would have collided.
  // 2026-08-17 · made ATOMIC: the old shape was a SELECT precheck (whose
  // errors were swallowed by .catch → rows:[]) followed by an unconditional
  // ON CONFLICT DO UPDATE — a precheck failure or a lost race between check
  // and write merged this runner's meta into ANOTHER user's row. Now the
  // upsert itself carries the ownership guard (DO UPDATE ... WHERE
  // races.user_uuid = EXCLUDED.user_uuid): same-user re-add stays idempotent
  // (Rule 6 meta merge), a foreign-owned slug leaves rowCount 0 and we retry
  // once with the userId-suffixed slug. Plain DO NOTHING was rejected — it
  // would turn every same-user re-add into a duplicate suffixed row.
  let slug = slugify(`${body.name}-${body.date}`);
  // Default priority='A' (locked 2026-05-30 SIM-03): when a runner adds a
  // race to their calendar, they almost always care about it — treating
  // it as a goal race is the right default. Use 'B' for tune-ups and 'C'
  // for training-effort races; both require explicit caller intent.
  const meta = {
    name: body.name,
    date: body.date,
    distanceLabel: body.distance_label ?? null,
    // 2026-07-06 · P1-17 · distanceMi was NEVER written by any app path, so
    // execution-plan/pacing/fueling (which gate on Number(meta.distanceMi))
    // were dead for every app-created race. Derive it at write time; null
    // stays null and jsonb_strip_nulls drops it (Rule 6: never clobber a
    // value some other writer may have set).
    distanceMi: distanceMiFromLabel(body.distance_label),
    priority: body.priority ?? 'A',
    goalDisplay: normalizeGoalDisplay(body.goal, body.distance_label), // CAP-3 · was raw → "7:45" 5K read as 7h45m
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
    // 2026-08-17 · races composite-PK prep · conflict target is now
    // (slug, user_uuid), matching the races_slug_user_uniq index and the
    // incoming PRIMARY KEY (slug, user_uuid). The ownership WHERE is KEPT:
    // under a composite target a conflict can only ever be this user's own
    // row, so it is structurally redundant — but it costs nothing, it keeps
    // the invariant readable at the call site, and it is the guard that
    // still does real work in the pre-migration window below.
    //
    // TRANSITION WINDOW · this code deploys BEFORE the PK swap, so
    // races_pkey (slug) still exists alongside races_slug_user_uniq. A
    // foreign-owned slug therefore does NOT filter to rowCount 0 — the row
    // is absent for (slug, THIS user), so Postgres attempts a real INSERT
    // and trips the single-column pkey with a 23505. Map that to rowCount 0
    // so the suffix retry behaves identically either side of the migration.
    // Once the PK is composite, 23505 can no longer fire here and this
    // branch becomes unreachable-but-harmless.
    const claimSlug = (s: string) => pool.query(
      `INSERT INTO races (slug, user_uuid, meta, plan, gpx_text)
       VALUES ($1, $2, $3, '{}'::jsonb, '')
       ON CONFLICT (slug, user_uuid) DO UPDATE
         SET meta = races.meta || jsonb_strip_nulls(EXCLUDED.meta)
       WHERE races.user_uuid = EXCLUDED.user_uuid`,
      [s, userId, meta]
    ).catch((e: unknown) => {
      if ((e as { code?: string } | null)?.code === '23505') return { rowCount: 0, rows: [] };
      throw e;
    });
    if ((await claimSlug(slug)).rowCount === 0) {
      // Natural slug is owned by a different user — take the suffixed one.
      slug = `${slug}-${userId.slice(0, 8)}`;
      if ((await claimSlug(slug)).rowCount === 0) {
        // Suffixed slug ALSO foreign-owned (would need an 8-hex uuid-prefix
        // collision) — refuse rather than merge into someone else's row.
        return NextResponse.json(
          {
            error: 'race_slug_unavailable',
            reason: 'That name is already taken on the schedule. Give this one a different name and it saves.',
          },
          { status: 409 },
        );
      }
    }
    await bustBriefingCacheForEvent(userId, 'race_crud');

    // Q-05 · auto-generate plan on first A-race when there's no active
    // plan. If there IS an active plan tied to some other race, we DO
    // NOT auto-switch — would be too aggressive; 2026-08-19 we now REBUILD
    // the existing block so it can see the new race (see below), which is a
    // different thing from re-pointing it at a new target.
    let plan: { ok: boolean; plan_id?: string; weeks_generated?: number; reason?: string } | null = null;
    // 2026-08-19 · race-shape audit · COACHED RUNNERS AUTHOR NOTHING.
    // `coached_externally` (the fifth onboarding branch) was honoured at
    // onboarding and read in exactly two DISPLAY files after that — never in
    // the plan engine. So the obvious thing a coached runner does, putting
    // their goal race on the calendar so Faff can track it, landed here, found
    // no active plan, and authored a full 16-week block against their own
    // coach's. The race still saves; only authorship is gated.
    const coached = await isCoachedExternally(userId);
    let autoRebuild: { kind: string; ok: boolean; reason?: string; newPlanId?: string } | null = null;
    if (!coached) {
      const active = (await pool.query<{ race_id: string | null; race_date: string | null }>(
        `SELECT tp.race_id, (rc.meta->>'date')::text AS race_date
           FROM training_plans tp
           LEFT JOIN races rc ON rc.slug = tp.race_id AND rc.user_uuid = tp.user_uuid
          WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL LIMIT 1`,
        [userId],
      ).catch(() => ({ rows: [] }))).rows[0];
      if (active) {
        // 2026-08-19 · race-shape audit · THE SECOND A-RACE.
        //
        // This branch used to be absent: generation happened only `if
        // (!active)`, and `fireAutoRebuild` was never called from POST (only
        // from the drift cron, PATCH, and DELETE). So a runner who added a
        // September half and then a December marathon got a half block that
        // never learned it was a stepping stone — Rule 11's `horizonRaces`
        // logic in generate.ts raises the long-run cap for exactly that case,
        // but it runs at AUTHORING time and nothing re-authored.
        //
        // EVERY priority, not just A. The same "authored once, never
        // re-authored" hole covers the two other things a new race changes:
        //   · A/B AFTER the target date  → Rule 11 `horizonRaces`, which
        //     raises the long-run cap for a stepping-stone block.
        //   · B/C INSIDE the plan window → MIDRACE-1 `midBlockRaces`, which
        //     embeds the tune-up (B: mini-taper + race + recovery days;
        //     C: converts the week's nearest quality slot).
        // Both are read by `loadGeneratorInputs` at authoring time only, so
        // without a re-author neither ever sees a race added afterwards.
        //
        // 'a_race_added' is the kind the PATCH hook already stamps when a race
        // is promoted TO A-priority, which is the same event from the plan's
        // point of view. The rebuild targets the ACTIVE plan's own race, not
        // the new one: the runner's current block keeps its target and gains
        // the new race in its horizon / mid-block reads. `fireAutoRebuild`
        // no-ops on a race_mismatch, and the 60s dedupe covers a double POST.
        //
        // TWO GUARDS, both borrowed from the machinery that already learned
        // these lessons:
        //
        //   · RELEVANCE. Fire only when the new race lands somewhere the
        //     generator actually reads it — inside the plan window (a
        //     mid-block tune-up) or within Rule 11's 168-day horizon past the
        //     target. A race two years out changes nothing, and re-authoring
        //     a block to produce a byte-identical plan is churn.
        //
        //   · RACE PROXIMITY. `suppressDriftNearRace` — inside 14 days of the
        //     target the generator refuses ('target < 2 weeks away'), so
        //     firing could only mint a stuck pending row. That is the exact
        //     truth-bug the 2026-08-17 drift fix closed; the same rule applies
        //     to a rebuild triggered from a route.
        const todayISO = await runnerToday(userId);
        const newDate = typeof meta.date === 'string' ? meta.date.slice(0, 10) : null;
        const relevant = Boolean(
          newDate && active.race_date && newDate > todayISO
          && newDate <= addDaysISO(active.race_date.slice(0, 10), HORIZON_DAYS),
        );
        if (
          active.race_id && active.race_id !== slug && relevant
          && !suppressDriftNearRace(active.race_date, todayISO)
        ) {
          try {
            const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
            const rb = await fireAutoRebuild({
              userUuid: userId,
              raceSlug: active.race_id,
              kind: 'a_race_added',
              reasons: {
                added_race: slug,
                added_race_date: meta.date,
                added_race_distance_mi: meta.distanceMi,
                added_race_priority: meta.priority,
                message: `${body.name} added · rebuilding the active block with the new race on the horizon.`,
              },
              source: 'race_post_hook',
            });
            autoRebuild = { kind: 'a_race_added', ok: rb.ok, reason: rb.reason, newPlanId: rb.newPlanId };
          } catch (e: unknown) {
            console.error('[race POST] horizon rebuild warn:', e instanceof Error ? e.message : String(e));
          }
        }
      } else if (meta.priority === 'A') {
        // 2026-06-20 · optional "when do you want to start" for races (David).
        // Defaults to the upcoming Monday (startAnchor) when omitted; a chosen
        // start anchors week 0 there (clamped >= today in generatePlan). The
        // runway is start → race date either way.
        const startRaw = String(body?.start_date ?? '').trim();
        const startDateISO = /^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? startRaw : undefined;
        // Persist available days (which days the runner can run) before the
        // build so the plan places runs on them. Validated to known day keys.
        const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const availRaw = Array.isArray(body?.available_days) ? body.available_days : null;
        if (availRaw) {
          const days = [...new Set(availRaw.filter((d: any) => DAY_KEYS.includes(d)))];
          if (days.length >= 2) await patchSettings(userId, { available_days: days as any }).catch(() => {});
        }
        plan = await generatePlan({
          userId, raceSlug: slug, freshTarget: true,
          ...(startDateISO ? { startDateISO, startAnchor: 'today' as const } : {}),
        }).catch((e: unknown) => ({
          ok: false, reason: e instanceof Error ? e.message : String(e),
        }));
        // 2026-06-21 · fail-safe: if the chosen-start build failed validation,
        // retry Monday-anchored so a created A-race never leaves the runner with
        // a race row and zero plans (same hole as the goal route — workflow
        // CRITICAL). The first failure's reason still rides in `plan` if both miss.
        if (plan && plan.ok === false && startDateISO) {
          const retry = await generatePlan({ userId, raceSlug: slug, freshTarget: true })
            .catch(() => null);
          if (retry && retry.ok) plan = retry;
        }
      }
    }

    const planError = plan && !plan.ok ? toFriendlyPlanError(plan.reason ?? null) : null;
    return NextResponse.json({
      ok: true, slug, plan, plan_error: planError,
      // 2026-08-19 · so the client can say "your coach owns the plan · this
      // race is on your calendar" instead of silently showing no plan.
      ...(coached ? { coached_externally: true } : {}),
      ...(autoRebuild ? { auto_rebuild: autoRebuild } : {}),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// (Local distanceMiFromLabel fork removed 2026-07-06 · P1-17 — superseded by
// the shared lib/race/distance.ts parser imported above. Same label coverage;
// values normalized to the codebase-canonical 26.2/13.1/6.2/3.1 convention.)

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body?.slug) return NextResponse.json({ error: 'slug_required', reason: 'No race was named, so there is nothing to change.' }, { status: 400 });

  try {
    // Scope existence + ownership: a runner can only PATCH a race they own.
    const existing = (await pool.query(
      `SELECT meta FROM races WHERE slug = $1 AND user_uuid = $2`,
      [body.slug, userId],
    )).rows[0];
    if (!existing) return NextResponse.json({ error: 'race_not_found', reason: 'That race is not on your schedule any more.' }, { status: 404 });
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
        // CAP-3 · normalize a typed goal (distance_label is processed earlier in this loop, so
        // meta.distanceLabel is already current). PATCH auto-rebuilds on goal change → must be canonical.
        meta[metaKey] = (k === 'goal' || k === 'goal_safe') ? normalizeGoalDisplay(body[k], meta.distanceLabel) : body[k];
        // 2026-07-06 · P1-17 · keep distanceMi in lockstep with the label —
        // an edited label with a stale distanceMi would silently mis-pace
        // every downstream composer. Unparseable label → null (composers
        // fall back to their own label ladder rather than a wrong number).
        if (k === 'distance_label') meta.distanceMi = distanceMiFromLabel(body[k]);
      }
    }
    // 2026-07-06 · P1-17 · opportunistic backfill: rows created before
    // distanceMi landed get it stamped on their next edit (any PATCH), so
    // the read-time label fallback is a bridge, not a permanent crutch.
    if (meta.distanceMi == null && meta.distanceLabel) {
      const derived = distanceMiFromLabel(meta.distanceLabel);
      if (derived != null) meta.distanceMi = derived;
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
      'shuttle', 'packetPickup', 'officialUrl', 'parking', 'notes', 'aidStations', 'summary',
      'notableMiles', 'weatherNorms', 'timeLimit', 'gearCheck', 'pacers', 'spectators',
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
    // 2026-07-06 · P1-17 · prefer the numeric meta.distanceMi (now written on
    // every create/edit) over re-parsing the label; label parse stays as the
    // fallback for rows saved before distanceMi existed.
    const calDistanceMi = (Number(meta.distanceMi) > 0 ? Number(meta.distanceMi) : null)
      ?? distanceMiFromLabel(meta.distanceLabel);
    if (meta.finishTime && meta.avgHrBpm && calDistanceMi != null) {
      try {
        const distanceMi = calDistanceMi;
        const { parseRaceTime, vdotFromRace } = await import('@/lib/training/vdot');
        const { calibrateLthr } = await import('@/lib/training/lthr');
        const secs = parseRaceTime(String(meta.finishTime));
        const hr = Number(meta.avgHrBpm);
        recalc = {};
        // Read the prior VDOT + LTHR off the most recent coach_intents +
        // profile so the response can carry the before/after diff. No
        // explicit before column for VDOT — best estimate is the most
        // recent vdot_auto_recalc intent.
        // 2026-08-24 · swallowed-failure sweep · `coach_intents.user_id` is
        // `uuid`, so `COALESCE(user_uuid::text, user_id)` gave `COALESCE types
        // text and uuid cannot be matched` and this threw every time. The
        // `.catch` returned no rows, so `vdotBefore` was always null and the
        // before/after diff this block exists to produce has never had a
        // "before" in it.
        const priorVdot = await pool.query<{ value: string }>(
          `SELECT value FROM coach_intents
            WHERE COALESCE(user_uuid, user_id) = $1::uuid
              AND reason = 'vdot_auto_recalc'
            ORDER BY ts DESC LIMIT 1`,
          [userId]
        ).catch((e) => { logReadFailure('api/race · priorVdot', e); return { rows: [] }; });
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
  if (!body?.slug) return NextResponse.json({ error: 'slug_required', reason: 'No race was named, so there is nothing to change.' }, { status: 400 });
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
