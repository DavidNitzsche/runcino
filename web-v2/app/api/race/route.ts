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

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.name || !body?.date) {
    return NextResponse.json({ error: 'name + date required' }, { status: 400 });
  }
  const slug = slugify(`${body.name}-${body.date}`);
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

  const userId = body.user_id ?? DAVID_USER_ID;
  try {
    await pool.query(
      `INSERT INTO races (slug, user_uuid, meta)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET meta = EXCLUDED.meta`,
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
  const body = await req.json().catch(() => null);
  if (!body?.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  try {
    const existing = (await pool.query(`SELECT meta FROM races WHERE slug = $1`, [body.slug])).rows[0];
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
    await pool.query(`UPDATE races SET meta = $1 WHERE slug = $2`, [meta, body.slug]);

    // P33 — auto-calibrate LTHR + VDOT from race retro when both finish
    // time and avg HR are set. Best-effort: failures don't block save.
    const userId = body.user_id ?? DAVID_USER_ID;
    if (meta.finishTime && meta.avgHrBpm && distanceMiFromLabel(meta.distanceLabel) != null) {
      try {
        const distanceMi = distanceMiFromLabel(meta.distanceLabel)!;
        const { parseRaceTime, vdotFromRace } = await import('@/lib/training/vdot');
        const { calibrateLthr } = await import('@/lib/training/lthr');
        const secs = parseRaceTime(String(meta.finishTime));
        const hr = Number(meta.avgHrBpm);
        // VDOT
        if (secs && meta.priority !== 'C') {
          const v = vdotFromRace(secs, distanceMi);
          if (v != null) {
            // No vdot column on profile — coach_intent tells the next
            // briefing about the new estimate.
            await pool.query(
              `INSERT INTO coach_intents (user_id, reason, field, value)
               VALUES ($1, 'vdot_auto_recalc', 'vdot', $2)`,
              [userId, String(v)]
            );
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
            `INSERT INTO coach_intents (user_id, reason, field, value)
             VALUES ($1, 'lthr_auto_calibrated', 'lthr', $2)`,
            [userId, `${cal.lthr} (${cal.method})`]
          );
        }
      } catch (e: any) {
        console.error('[race PATCH] auto-calibrate warn:', e?.message);
      }
    }

    await bustBriefingCacheForEvent(DAVID_USER_ID, 'race_crud');
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  try {
    await pool.query(`DELETE FROM races WHERE slug = $1`, [body.slug]);
    await bustBriefingCacheForEvent(DAVID_USER_ID, 'race_crud');
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
