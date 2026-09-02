/**
 * GET /api/v5/race/[slug] · the v5 Race detail screen (handoff 8a).
 *
 * A pushed screen: AppBar + plain list, no gradient panel — the shell
 * exception the v5 README names — so `V5RaceDetail` carries no `panel`
 * field at all.
 *
 * Closes two backend gaps named in `docs/design/iphone-v5/BUILD-PLAN.md`:
 *   B11 · no taper-progress figure. Derived from the active plan's own
 *        `plan_phases` TAPER row + `plan_weeks` boundaries — 0…1 from the
 *        taper's first week through race day. Null when the block has no
 *        TAPER phase authored yet (the client draws nothing, not a zero).
 *   B14 · no gear plan. Composed from what genuinely exists — the shoe
 *        rotation's own racing recommendation (`lib/shoe/recommend.ts`,
 *        already the single recommender every other surface uses) plus the
 *        race-morning forecast when the course has GPS and the date is
 *        inside the forecast horizon. Empty array when neither resolves —
 *        never an invented kit list.
 */
import { NextRequest, NextResponse } from 'next/server';
import { dateWords } from '@/lib/format/date';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { loadRacesState } from '@/lib/coach/races-state';
import { parseRaceTime, formatRaceTime } from '@/lib/training/vdot';
import { raceProjectionFromOutlook, projectionCoachLine } from '@/lib/training/race-projection';
import { resolveRaceOutlookBySlug } from '@/lib/race/race-outlook';
import { raceOutlookPayload } from '@/lib/race/race-outlook-payload';
import { buildRacePacing, type CourseGeometryInput } from '@/lib/race/pacing';
import { resolveCourseElevation, type ResolveCourseElevationInput, type StoredGeometry } from '@/lib/race/course-elevation';
import { loadActivePlan } from '@/lib/plan/lookup';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { computeShoeMileage } from '@/lib/shoe/mileage';
import { coerceShoeType, resolveShoeCapMi } from '@/lib/shoe/lifespan';
import { recommendShoe, shoeDisplayName, type GarageShoe } from '@/lib/shoe/recommend';
import { computeRaceConditions } from '@/lib/training/race-conditions';
import { outage } from '@/lib/route/failure';
import { racePlateFor } from '@/lib/faff/race-plate';

export const dynamic = 'force-dynamic';

interface V5NumberOut { text: string | null; modelled: boolean; }
interface V5RowOut { id: string; label: string; sub: string | null; value: V5NumberOut | null; action: string | null; }
const num = (text: string | null, modelled: boolean): V5NumberOut => ({ text, modelled });


/**
 * "Sun, Dec 6, 2026". A schedule row was printing the raw ISO date, which is
 * the database showing through — the same class of leak as "about 0 min" on a
 * rest day. The words themselves now come from `lib/format/date`, which is the
 * one place that decides how a date is written down; this file used to carry
 * its own copy, and so did the race-detail route.
 */
const raceDateWords = (iso: string | null | undefined): string => dateWords(iso);

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { slug } = await params;

  try {
    const racesState = await loadRacesState(userId);
    const race = [...racesState.aRaces, ...racesState.upcomingBs, ...racesState.upcomingCs, ...racesState.past]
      .find(r => r.slug === slug);
    if (!race) {
      // A reason, not a bare status. The phone treats a 4xx as a legible
      // decline only when the body carries one; without it this 404 wears the
      // outage treatment and tells the runner we went blind.
      return NextResponse.json(
        { error: 'race_not_found', reason: 'That race is not on your schedule any more.' },
        { status: 404 },
      );
    }

    const todayISO = await runnerToday(userId);
    const distanceMi = race.distance_mi ?? 0;
    const goalSec = parseRaceTime(race.goal);

    // ── geometry + course-aware pace plan ──────────────────────────────────
    const [geoRow, libRow] = await Promise.all([
      pool.query<{ course_geometry: StoredGeometry | null; course_source: string | null; terrain: string | null; goal_framing: string | null }>(
        `SELECT course_geometry, course_source, meta->>'terrain' AS terrain,
                meta->>'goalFraming' AS goal_framing
           FROM races WHERE slug = $1 AND user_uuid = $2`,
        [slug, userId],
      ).then(r => r.rows[0] ?? null).catch(() => null),
      pool.query<{ elevation_gain_ft: number | string | null; net_elevation_ft: number | string | null; geometry_json: unknown }>(
        `SELECT elevation_gain_ft, net_elevation_ft, geometry_json FROM course_library WHERE slug = $1`,
        [slug],
      ).then(r => r.rows[0] ?? null).catch(() => null),
    ]);
    const courseGeometry = geoRow?.course_geometry ?? null;

    const FT_PER_M = 3.28084;
    /** Downsample raw trackpoint elevations to a chart-sized series. Real
     *  measured points only — never interpolated beyond an even stride
     *  pick, and never fabricated when the geometry carries none. */
    function elevationSeriesFt(geom: StoredGeometry | null, maxPoints = 60): number[] {
      const g = geom as { trackPoints?: Array<{ ele?: number | null }> } | null;
      const eles = (g?.trackPoints ?? []).map(p => p?.ele).filter((e): e is number => typeof e === 'number');
      if (eles.length === 0) return [];
      if (eles.length <= maxPoints) return eles.map(e => Math.round(e * FT_PER_M));
      const stride = eles.length / maxPoints;
      const out: number[] = [];
      for (let i = 0; i < maxPoints; i++) out.push(Math.round(eles[Math.floor(i * stride)] * FT_PER_M));
      return out;
    }

    let elevation: number[] = [];
    let elevationFootnotes: string[] = [];
    let resolvedProvenance: string = 'unknown';
    /** Measured course gain (ft) when the resolver produced one — feeds the
     *  coach-goal hilly gate below, same read the footnotes are built from. */
    let resolvedGainFt: number | null = null;
    try {
      elevation = elevationSeriesFt(courseGeometry);
      const resolveInput: ResolveCourseElevationInput = {
        lib: libRow ? { elevation_gain_ft: libRow.elevation_gain_ft, net_elevation_ft: libRow.net_elevation_ft } : null,
        geometry: courseGeometry, nominalDistanceMi: distanceMi || null,
      };
      const resolved = resolveCourseElevation(resolveInput);
      resolvedProvenance = resolved.provenance;
      resolvedGainFt = resolved.elevationGainFt ?? null;
      if (resolved.elevationGainFt != null) {
        elevationFootnotes.push(`${Math.round(resolved.elevationGainFt)} ft gain`);
      }
      if (resolved.netElevationFt != null) {
        const net = Math.round(resolved.netElevationFt);
        elevationFootnotes.push(net === 0 ? 'Net flat' : net > 0 ? `Net +${net} ft` : `Net ${net} ft`);
      }
      if (resolved.conflict) {
        elevationFootnotes.push('Measured elevation differs from the listed course profile.');
      }
      if (elevationFootnotes.length === 0) elevationFootnotes = ['No elevation data yet.'];
      if (resolvedProvenance === 'measured') elevationFootnotes.push('Measured from GPS.');
    } catch { /* elevation is additive — never fail the detail over it */ }

    // 2026-09-02 · P0 · THE PACE PLAN IS BUILT FROM THE TARGET, NEVER THE GOAL.
    //
    // This block used to pass `goalSec` — the runner's TYPED ASPIRATION —
    // straight into `buildRacePacing`. The same response already carried the
    // canonical execution target and prose explaining why the goal is out of
    // reach, so the screen argued against the goal in words and then handed
    // him a mile-by-mile plan for it, with a final phase labelled "Lock goal
    // pace".
    //
    // Measured on the owner's CIM detail, 2026-09-02: stated target 7:23/mi,
    // pace plan weighted mean 413 s/mi = 6:53/mi = exactly his 3:00:00 goal
    // pace. THIRTY SECONDS PER MILE, thirteen minutes across the marathon, in
    // the direction that ends a marathon at mile 18.
    //
    // Constitution §7 names this shape verbatim and
    // `DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` requires goal data be
    // PHYSICALLY excluded from a capacity path rather than kept out by
    // convention. No source scan found it because `buildRacePacing(goalSec)`
    // is a legitimate call with a legitimately-named argument; it took a
    // cross-surface contract reading both numbers off one live response.
    //
    // `outlook.execution.targetSec` is the one owner of "what should he run
    // this race at" (`lib/race/race-outlook.ts`), and it already honours the
    // stated goal exactly as far as doctrine allows — pulling the target no
    // further than the fast edge of the likely range, and reporting which of
    // those it did through `execution.source`.
    //
    // RULE 11 · when the outlook cannot resolve there is NO pace plan. The
    // goal is not a fallback here; falling back to it is the defect.
    const outlook = (!race.is_past && distanceMi > 0)
      ? await resolveRaceOutlookBySlug(userId, race.slug, todayISO).catch(() => null)
      : null;
    const pacePlanTargetSec = outlook?.execution.targetSec ?? null;

    let pacePlan: V5RowOut[] = [];
    if (pacePlanTargetSec && distanceMi > 0) {
      try {
        const geometryForPacing = (libRow?.geometry_json ?? courseGeometry) as CourseGeometryInput | null;
        const pacing = buildRacePacing({
          goalSec: pacePlanTargetSec, distanceMi, geometry: geometryForPacing,
        });
        pacePlan = (pacing.phases ?? []).map((p, i) => ({
          id: `phase-${i}`,
          label: `Miles ${Math.round(p.start_mi)}-${Math.round(p.end_mi)}`,
          // RULE 16 · `buildRacePacing` labels its last phase "Goal pace",
          // which was true while this block passed the goal and is a LIE now
          // that it passes the target. On the owner's CIM the two are 31 s/mi
          // apart, so a row reading "Goal pace · 7:19/mi" would state a pace
          // that is not his goal pace under the words "goal pace". The
          // shared builder keeps its label — the retrospective passes a real
          // goal and is right to say so — and the caller that changed what it
          // passes renames what it draws.
          sub: [p.label === 'Goal pace' ? 'Target pace' : p.label, p.cue]
            .filter(Boolean).join(' · ') || null,
          // `display` already carries its unit ("6:58/mi"); appending
          // another produced "6:55/mi/mi" on screen.
          value: num(p.display, true),
          action: null,
        }));
      } catch { /* pacing is additive */ }
    }

    // Up to 3 marks, at each pace-phase boundary — real course structure,
    // not invented landmarks.
    const elevationMarks = pacePlan.slice(0, 3).map((row, i) => ({
      id: `mark-${i}`,
      at: distanceMi > 0 ? Math.min(1, Math.max(0, Number(row.label.replace('Miles ', '').split('-')[0]) / distanceMi)) : 0,
      label: row.sub?.split(' · ')[0] ?? row.label,
    }));

    // ── goal / projected / gap ─────────────────────────────────────────────
    //
    // A RACE THAT HAS ALREADY BEEN RUN IS NOT PROJECTED.
    //
    // Every field below shipped without ever consulting `race.is_past`, which
    // this route already reads two blocks down for `resultEntry`. So opening a
    // race from last weekend showed today's fitness PROJECTED onto it, a gap
    // against that projection, a pace plan for how to run it, and a coach line
    // reading "That can still close." about a result already in the book.
    //
    // Past and finished: the middle column holds what the runner actually ran
    // and the gap is measured against the goal — both `modelled: false`,
    // because a finish time is a read, not a model. The client relabels that
    // column "Result" off `resultEntry.isPast`.
    //
    // Past and unfinished (a DNS, or a result not logged yet): no projection
    // and no gap. There is nothing honest to put there.
    // 2026-08-30 · AND A RACE IS NOT PROJECTED TWO DIFFERENT WAYS.
    //
    // `projectedSec` was `predictRaceTime(vdot, distanceMi)` — today's
    // fitness equivalence — while the Races list one tap away resolved the
    // same "Projected" label through `computeGoalProjection().trajectory`.
    // On the owner's account: list 3:22:17 / gap +22:17, detail 3:31:48 /
    // gap +31:48. Same race, same goal, same word, 9m31s apart.
    //
    // Both surfaces now resolve through `resolveRaceProjection`, which
    // documents the precedence and returns the `basis` the coach line below
    // needs to stay true to whichever quantity it got.
    // 2026-09-01 · P0 · THE race-pace brain. `resolveRaceOutlookBySlug` is
    // the one owner; `raceProjectionFromOutlook` is the one mapping to
    // "Projected". The list route reads the same two functions.
    const projection = raceProjectionFromOutlook(outlook);
    // The runner's fitness for the heat read below: the canonical threshold
    // capacity's VDOT, not a snapshot table's.
    const vdot = outlook?.capacity.thresholdVdot ?? null;
    const plate = racePlateFor({
      isPast: race.is_past,
      goalSec,
      finishSec: parseRaceTime(race.finishTime),
      projectedSec: projection.projectedSec,
    });
    const gapSec = plate.gapSec;

    // ── B11 · taper progress ───────────────────────────────────────────────
    let taperProgress: number | null = null;
    let taperEndpoints: string[] = [];
    let taperCentreLabel: string | null = null;
    try {
      const plan = await loadActivePlan(userId);
      if (plan && plan.race_id === slug) {
        const phase = await pool.query<{ start_week_idx: number; end_week_idx: number }>(
          `SELECT start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1 AND label = 'TAPER' LIMIT 1`,
          [plan.id],
        ).then(r => r.rows[0] ?? null).catch(() => null);
        if (phase) {
          const startWeek = await pool.query<{ week_start_iso: string }>(
            `SELECT week_start_iso::text AS week_start_iso FROM plan_weeks WHERE plan_id = $1 AND week_idx = $2 LIMIT 1`,
            [plan.id, phase.start_week_idx],
          ).then(r => r.rows[0] ?? null).catch(() => null);
          const taperStartISO = startWeek?.week_start_iso ?? null;
          const raceDateISO = race.date;
          if (taperStartISO && raceDateISO) {
            const startMs = Date.parse(taperStartISO + 'T12:00:00Z');
            const raceMs = Date.parse(raceDateISO + 'T12:00:00Z');
            const todayMs = Date.parse(todayISO + 'T12:00:00Z');
            const span = raceMs - startMs;
            taperProgress = span > 0 ? Math.min(1, Math.max(0, (todayMs - startMs) / span)) : null;
            const taperWeeksTotal = Math.max(1, Math.round((phase.end_week_idx - phase.start_week_idx + 1)));
            taperEndpoints = [`${taperWeeksTotal} week${taperWeeksTotal === 1 ? '' : 's'} out`, 'Race day'];
            const daysOut = Math.round((raceMs - todayMs) / 86400000);
            taperCentreLabel = daysOut <= 7 && daysOut >= 0
              ? 'Race week'
              : daysOut > 7
                ? `${Math.round(daysOut / 7)} week${Math.round(daysOut / 7) === 1 ? '' : 's'} out`
                : 'Race day';
          }
        }
      }
    } catch { /* taper is additive */ }

    // ── B14 · gear plan ─────────────────────────────────────────────────────
    const gear: V5RowOut[] = [];
    try {
      const [shoeRows, mileageMap] = await Promise.all([
        pool.query<{ id: number; brand: string; model: string; run_types: string[] | null; mileage_cap: number | null; shoe_type: string | null; baseline_mi: number | null; retired: boolean | null; preferred: boolean | null }>(
          `SELECT id, brand, model, run_types, mileage_cap::numeric AS mileage_cap,
                  to_jsonb(shoes.*) ->> 'shoe_type' AS shoe_type,
                  COALESCE(baseline_mi, 0)::numeric AS baseline_mi,
                  COALESCE(retired, false) AS retired, COALESCE(preferred, false) AS preferred
             FROM shoes WHERE user_uuid = $1`,
          [userId],
        ).then(r => r.rows).catch(() => []),
        computeShoeMileage(userId).catch(() => new Map<number, number>()),
      ]);
      const garage: GarageShoe[] = shoeRows.map(s => ({
        id: s.id, brand: s.brand, model: s.model, runTypes: s.run_types ?? [],
        mileage: (mileageMap.get(Number(s.id)) ?? 0) + Number(s.baseline_mi ?? 0),
        cap: resolveShoeCapMi(s.shoe_type, s.mileage_cap), preferred: s.preferred ?? false, retired: s.retired ?? false,
      }));
      const raceShoe = recommendShoe(garage, 'race');
      if (raceShoe) {
        const cap = raceShoe.cap ?? resolveShoeCapMi(null, null);
        const pctUsed = cap > 0 ? Math.round((raceShoe.mileage / cap) * 100) : 0;
        gear.push({
          id: `shoe-${raceShoe.id}`, label: shoeDisplayName(raceShoe) ?? 'Race shoe',
          sub: `${Math.round(raceShoe.mileage)} mi · ${pctUsed}% of its life`,
          value: null, action: 'open_shoe',
        });
      }
      // Race-morning forecast, only when the course has GPS and the date is
      // inside the real forecast horizon — never a climate-normal guess
      // presented as a gear fact.
      const g = courseGeometry as { trackPoints?: Array<{ lat?: number | null; lon?: number | null }> } | null;
      const tp = g?.trackPoints?.find(p => typeof p?.lat === 'number' && typeof p?.lon === 'number');
      if (tp?.lat != null && tp?.lon != null && race.date && distanceMi > 0 && goalSec) {
        const cond = await computeRaceConditions({
          raceSlug: slug, raceDateISO: race.date, location: race.location,
          raceLat: tp.lat, raceLng: tp.lon, distanceMi, goalSec, vdot,
          startTimeLocal: null, todayISO,
        }).catch(() => null);
        if (cond?.source === 'forecast' && cond.tempF != null) {
          gear.push({
            id: 'forecast', label: 'Race morning',
            sub: cond.safetyMessage ?? 'Forecast for the course, race-day morning.',
            // MODELLED. A forecast is a model's opinion about a morning that
            // has not happened. Shipping it bare-faced beside a measured
            // finish time is exactly the sin rule one names, and it is the
            // more tempting version of it because a temperature FEELS like a
            // reading.
            value: num(`${cond.tempF}°F`, true), action: null,
          });
        }
      }
    } catch { /* gear is additive */ }

    // Both of these sentences are about a race still to come — one says the
    // gap "can still close", the other says to "race it as planned". Neither
    // is a thing to say about a race already run, so a past race gets no
    // coach line here and the result section speaks for itself.
    //
    // 2026-08-30 · the sentence is worded off the projection's OWN basis.
    // Hardcoding "Today's fitness" was correct while the plate printed the
    // raw equivalence and would have become a lie the moment it printed the
    // race-day trajectory — prose asserting a basis the number beside it
    // does not have, which is the same defect as the two screens disagreeing.
    const coachLine = plate.showsForwardLooking
      ? projectionCoachLine({
          basis: projection.basis,
          gapSec,
          formatGap: formatRaceTime,
        })
      : null;

    // ── result entry (Job 3) ────────────────────────────────────────────
    //
    // Rule one, concretely: `race.finishProvisional` (races-state.ts) is
    // true when the logged finish came from an auto-detected/watch-matched
    // run rather than a confirmed chip time — "Training effort · race to
    // lock in", NOT authoritative for fitness (CLAUDE.md's race-data
    // source-of-truth checklist). `status: 'provisional'` is exactly that
    // reading; `finish` carries `modelled: race.finishProvisional` so the
    // client's own `FaffValue` mechanism draws the amber tilde on a
    // provisional number without this route (or the client) hand-rolling
    // the mark. `status: 'confirmed'` (a real chip time already locked in)
    // is deliberately given no entry form at all — nothing left to ask.
    const resultEntry = {
      isPast: race.is_past,
      status: !race.is_past || race.finishTime == null
        ? null
        : (race.finishProvisional ? 'provisional' : 'confirmed'),
      finish: race.finishTime != null ? num(race.finishTime, race.finishProvisional) : null,
    };

    // ── coach-set goal (2026-08-28) ─────────────────────────────────────
    //
    // The SAME loader GET /api/race/[slug] and the web race page call
    // (lib/race/coach-goal-load.ts), so all three surfaces read one answer.
    // Null whenever the runner has a stated goal (untouchable), the race is
    // past, or there is no honest evidence to set one from. kind:'time'
    // carries A/B/C — every number modelled, so the client renders the amber
    // ~ on each — and kind:'effort' is the C-priority / hilly framing with
    // no time at all. Never feeds the pace plan above.
    let coachGoal: Awaited<ReturnType<
      typeof import('@/lib/race/coach-goal-load').loadCoachGoalForRace
    >> = null;
    try {
      const daysAway = race.days ?? (race.date
        ? Math.round((Date.parse(race.date + 'T12:00:00Z') - Date.parse(todayISO + 'T12:00:00Z')) / 86400000)
        : null);
      const { loadCoachGoalForRace } = await import('@/lib/race/coach-goal-load');
      coachGoal = await loadCoachGoalForRace(userId, {
        slug: race.slug,
        name: race.name,
        priority: race.priority ?? null,
        statedGoalSec: goalSec != null && goalSec > 0 ? goalSec : null,
        distanceMi: race.distance_mi ?? null,
        metaTerrain: geoRow?.terrain ?? null,
        elevationGainFt: resolvedGainFt != null && resolvedGainFt > 0 ? resolvedGainFt : null,
        goalFraming: geoRow?.goal_framing ?? null,
        daysAway,
      });
    } catch { coachGoal = null; /* additive — never fail the detail over it */ }

    return NextResponse.json({
      slug: race.slug,
      name: race.name,
      dateLine: [raceDateWords(race.date), race.distance_label].filter(Boolean).join(' · '),
      goal: goalSec != null ? num(formatRaceTime(goalSec), false) : null,
      // Past: the finish the runner recorded, and a gap measured against the
      // goal — reads, not models, so no tilde. Upcoming: a projection off
      // VDOT, which is a model and carries the mark.
      projected: plate.middleSec != null
        ? num(formatRaceTime(plate.middleSec), plate.middleModelled)
        : null,
      gap: gapSec != null
        ? num(`${gapSec > 0 ? '+' : gapSec < 0 ? '−' : ''}${formatRaceTime(Math.abs(gapSec))}`, plate.gapModelled)
        : null,
      elevation, elevationMarks, elevationFootnotes,
      // How to pace a race that has already been run is not advice. The
      // course marks above are still derived from the same pacing call,
      // because the course itself did not stop being that shape.
      pacePlan: plate.showsForwardLooking ? pacePlan : [],
      taperProgress, taperEndpoints, taperCentreLabel,
      gear,
      coachLine,
      resultEntry,
      coachGoal,
      // 2026-09-01 · P0 · the four quantities and the bridge, additive.
      outlook: raceOutlookPayload(outlook),
    });
  } catch (err: unknown) {
    // Was `err?.message` in the body.
    return outage('v5/race/[slug]', err);
  }
}
