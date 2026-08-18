'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { RunDetail } from '@/lib/coach/run-state';
import type { WorkoutSpec } from '@/lib/faff/types';
import { Tile } from '@/components/redesign/core/Tile';
import { Badge, type BadgeTone } from '@/components/redesign/core/Badge';
import { Button } from '@/components/redesign/core/Button';
import { Stat } from '@/components/redesign/core/Stat';
import { SessionHeadline } from '@/components/redesign/core/SessionHeadline';
import { CoachSay } from '@/components/redesign/coach/CoachSay';
import { RangeScale } from '@/components/redesign/graphics/RangeScale';
import { MetricRow, type MetricRowItem } from '@/components/redesign/graphics/MetricRow';
import { Splits } from '@/components/redesign/graphics/Splits';
import { ElevationProfile } from '@/components/redesign/graphics/ElevationProfile';
import { SegmentBar } from '@/components/redesign/nav/SegmentBar';
import { Dialog } from '@/components/redesign/feedback/Dialog';

/**
 * components/redesign/runs/RunDetailClient.tsx
 *
 * The redesigned Run Detail screen, wired to the SAME real data path the
 * live /runs/[id] route renders: lib/coach/run-state.ts#loadRunDetail for
 * everything about the run itself, and GET /api/runs/[id]/recap (deriveRecap)
 * for the coach verdict. Structurally ported from the outside-studio
 * handoff's WebRunDetail.jsx (designs/design-review-0818/ui_kits/web/
 * WebRunDetail.jsx) — this file is the page-local composition, matching how
 * WebRunDetail.jsx itself is a page, not a shared component.
 *
 * SCOPE (see task report for the full honesty-gap list):
 *   · Plain-run view only. WebRunDetail.jsx also doubles as a race-result
 *     view via a `race` prop (official badge, chip-time headline). Wiring
 *     that honestly means reading races.actual_result first per this
 *     project's locked race-data doctrine (CLAUDE.md "Race-data
 *     source-of-truth") and never presenting Strava-elapsed as a chip time
 *     — real work beyond this pass, deferred, not silently half-wired.
 *   · The design's own SegmentBar (pace / heart rate / elevation) only
 *     actually changes the chart for 'elevation' in the source WebRunDetail.jsx
 *     — 'pace' and 'heart rate' both render the same <Splits> (which only
 *     ever plots the `pace` series). That is a limitation in the source
 *     component, not something introduced here; ported faithfully rather
 *     than silently "fixed" by relabeling HR as pace.
 *
 * Every number on this page traces to a RunDetail / recap field. Where the
 * design's mock had a number with no honest real-data source (the 1-10
 * "Effort" score, the fabricated comfortable-temperature band, the fixed
 * 172-182 cadence band, the placeholder route SVG), the row is either
 * dropped, replaced with the closest real field, or wired to the real
 * component that already exists elsewhere in the app — see the inline
 * comments at each such spot.
 */

// Lazy, client-only — RouteMap talks to the DOM via Leaflet and must never
// run during SSR. Reused as-is from the live app (components/faff-app/
// RouteMap.tsx): real CartoDB dark tiles + pace-graded polyline decoded
// from the same route_polyline this page already has. Not re-implemented.
const RouteMap = dynamic(() => import('@/components/faff-app/RouteMap').then((m) => m.RouteMap), { ssr: false });

export interface RecapPayload {
  verdict: string;
  facts: string[];
  coach_tip: string | null;
  conditions_note: string | null;
}

type Lens = 'pace' | 'heart rate' | 'elevation';

const SOURCE_LABEL: Record<string, string> = {
  watch: 'Apple Watch', apple_watch: 'Apple Watch', apple_health: 'Apple Health',
  strava: 'Strava', manual: 'Manual entry', treadmill: 'Treadmill',
};

const TYPE_LABEL: Record<string, string> = {
  easy: 'Easy', recovery: 'Recovery', long: 'Long', tempo: 'Tempo', threshold: 'Threshold',
  intervals: 'Intervals', fartlek: 'Fartlek', progression: 'Progression', shakeout: 'Shakeout',
  race: 'Race', rest: 'Rest',
};
const TYPE_BADGE_TONE: Record<string, BadgeTone> = {
  easy: 'easy', recovery: 'easy', long: 'long', tempo: 'signal', threshold: 'signal',
  intervals: 'signal', fartlek: 'signal', progression: 'signal', shakeout: 'quiet',
  race: 'race', rest: 'quiet',
};

function specHrCap(spec: WorkoutSpec | null | undefined): number | null {
  if (!spec) return null;
  const s = spec as unknown as { hr_cap_bpm?: number | null; hr_target_bpm?: number | null; lthr_bpm?: number | null };
  return s.hr_cap_bpm ?? s.hr_target_bpm ?? s.lthr_bpm ?? null;
}
function specPaceBand(spec: WorkoutSpec | null | undefined): [number, number] | null {
  if (!spec) return null;
  const s = spec as unknown as { pace_target_s_per_mi_lo?: number; pace_target_s_per_mi_hi?: number };
  return typeof s.pace_target_s_per_mi_lo === 'number' && typeof s.pace_target_s_per_mi_hi === 'number'
    ? [s.pace_target_s_per_mi_lo, s.pace_target_s_per_mi_hi]
    : null;
}

function paceLabel(spm: number | null | undefined): string | null {
  if (!spm || spm <= 0) return null;
  const total = Math.round(spm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
/** "8:09" → 489. Inverse of paceLabel, for feeding RunDetail's formatted
 *  split strings into Splits' seconds-based y-axis. */
function parsePaceStr(p: string | null): number | null {
  if (!p) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(p.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
function weekdayDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function RunDetailClient({ detail, recap, runId }: {
  detail: RunDetail | null;
  recap: RecapPayload | null;
  runId: string;
}) {
  const [lens, setLens] = useState<Lens>('pace');
  const [retiring, setRetiring] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);
  const [retiredOk, setRetiredOk] = useState(false);

  const shoe = useMemo(
    () => (detail?.shoe_id != null ? detail.shoes.find((s) => s.id === detail.shoe_id) ?? null : null),
    [detail],
  );

  async function confirmRetire() {
    if (!shoe) return;
    setRetireBusy(true);
    try {
      const res = await fetch('/api/shoe', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: shoe.id, retired: true }),
      });
      if (res.ok) setRetiredOk(true);
    } finally {
      setRetireBusy(false);
      setRetiring(false);
    }
  }

  if (!detail) {
    return (
      <div style={{ display: 'grid', gap: 'var(--sp-6)', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
        <div className="faff-kicker">Run</div>
        <div className="faff-display" style={{ fontSize: 'var(--type-display-3)' }}>Run not found</div>
        <div style={{ color: 'var(--text-quiet)', fontSize: 'var(--type-body-s)' }}>
          No run matched id &ldquo;{runId}&rdquo; for this account.
        </div>
      </div>
    );
  }

  const typeKey = (detail.type ?? '').toLowerCase();
  // `detail.type` is the raw stored value — on watch-source rows it is
  // frequently the generic Strava-style "Run", not a coach classification
  // (the real classification, when known, lives in a plan_workouts row for
  // the date, surfaced separately as planned_sub_label / planned_spec).
  // Only badge the run with a session-vocabulary word when the stored type
  // actually IS one; otherwise show the honest generic label instead of
  // inventing "Threshold" the way the design mock does.
  const typeLabel = TYPE_LABEL[typeKey] ?? detail.planned_sub_label ?? 'Run';
  const badgeTone: BadgeTone = TYPE_BADGE_TONE[typeKey] ?? 'neutral';

  const sourceLabel = SOURCE_LABEL[detail.source] ?? detail.source;
  const kicker = `${weekdayDate(detail.date)} · ${sourceLabel}`;
  // The run's real, twin-coalesced display name (lib/runs/log-enrich.ts via
  // loadRunDetail — e.g. "Pre race dry run"), shown as SessionHeadline's
  // `note` slot ("one quiet line of context, e.g. the workout's library
  // name" — an exact fit). Dropped when it's just the generic "Run" stub,
  // which carries no information beyond what the badge already shows.
  const runNote = detail.name && detail.name.trim().toLowerCase() !== 'run' ? detail.name : null;

  const dose = `${detail.distance_mi.toFixed(1)} mi${detail.time_moving ? ` · ${detail.time_moving}` : ''}`;

  // ── Pace / HR / drift metric row ──────────────────────────────────────
  const band = specPaceBand(detail.planned_spec);
  const hrCap = specHrCap(detail.planned_spec);

  const paceItem: MetricRowItem | null = detail.pace_s_per_mi
    ? {
        label: 'Pace', sub: 'What you ran', value: detail.pace ?? paceLabel(detail.pace_s_per_mi) ?? '·',
        scale: band
          ? (() => {
              const pad = Math.max(20, (band[1] - band[0]) * 0.6);
              const min = band[0] - pad;
              const max = band[1] + pad;
              return (
                <RangeScale style={{ marginTop: 0 }} min={min} max={max} band={{ low: band[0], high: band[1] }}
                  value={detail.pace_s_per_mi ?? undefined} endpoints={[paceLabel(min) ?? '', paceLabel(max) ?? '']} hue="pace" />
              );
            })()
          : null,
      }
    : null;

  const hrItem: MetricRowItem | null = detail.hr_avg
    ? {
        label: 'Average HR', sub: hrCap ? `Ceiling ${hrCap}` : 'No plan ceiling for this run', value: String(detail.hr_avg), unit: 'bpm',
        scale: hrCap
          ? (() => {
              const zoneLow = detail.hr_zones_from_lthr?.ranges[0]?.lower ?? Math.max(80, hrCap - 60);
              const max = Math.max(hrCap + 10, detail.hr_max ?? 0);
              return (
                <RangeScale style={{ marginTop: 0 }} mode="ceiling" min={zoneLow} max={max}
                  band={{ low: zoneLow, high: hrCap }} value={detail.hr_avg ?? undefined}
                  endpoints={[String(zoneLow), String(max)]} hue="heart" />
              );
            })()
          : null,
      }
    : null;

  // HR drift · reuses aerobic_decoupling's real h1/h2 average HR (the same
  // first-half / second-half split lib/training/aerobic-decoupling.ts
  // already computed server-side for long, steady-state runs) rather than
  // re-deriving a drift number here. Null (and this column omitted) on any
  // run that metric doesn't cover — intervals, tempo, races, runs under 6mi.
  const drift = detail.aerobic_decoupling ? Math.round(detail.aerobic_decoupling.h2_hr - detail.aerobic_decoupling.h1_hr) : null;
  const driftItem: MetricRowItem | null = drift != null && detail.aerobic_decoupling
    ? {
        label: 'HR drift', sub: `${Math.round(detail.aerobic_decoupling.h1_hr)} to ${Math.round(detail.aerobic_decoupling.h2_hr)} across the run`,
        value: `${drift >= 0 ? '+' : ''}${drift}`, unit: 'bpm',
        scale: (
          <RangeScale style={{ marginTop: 0 }} min={0} max={20} band={{ low: 0, high: 10 }}
            value={Math.abs(drift)} endpoints={['0', '20']} hue="heart" />
        ),
      }
    : null;

  const metricItems = [paceItem, hrItem, driftItem].filter((x): x is MetricRowItem => x != null);

  // ── Splits / elevation lens ───────────────────────────────────────────
  const splitsForChart = detail.splits.map((s) => ({ pace: parsePaceStr(s.pace), hr: s.hr ?? undefined }));
  const hasElevSplits = detail.splits.some((s) => s.elev_change_ft != null);
  const lensOptions = hasElevSplits ? (['pace', 'heart rate', 'elevation'] as const) : (['pace', 'heart rate'] as const);
  // Plain derived value, not a hook — this must not sit after the `if
  // (!detail) return` above changes the hook count between the "run not
  // found" render and the real one (React's Rules of Hooks). A 13-entry
  // cumulative sum is cheap enough that memoizing it bought nothing anyway.
  const elevPoints: number[] | null = (() => {
    if (!hasElevSplits) return null;
    const pts = [0];
    let running = 0;
    for (const s of detail.splits) {
      running += s.elev_change_ft ?? 0;
      pts.push(running);
    }
    return pts;
  })();

  const showElevation = lens === 'elevation' && elevPoints;

  // ── Coach verdict ─────────────────────────────────────────────────────
  const coachLine = recap ? recap.facts.join(' ') : null;

  // ── Effort (grade-adjusted pace, for judging only) ───────────────────
  // lib/terrain/grade-adjust.ts's own header: "GRADE-ADJUSTED PACE IS FOR
  // JUDGING EFFORT. IT IS NEVER WHAT THE RUNNER RAN." The design mock's
  // fabricated 1-10 "Effort" score (with an arbitrary 5-7 "band") had no
  // real source anywhere in the engine, so it is replaced here with the
  // actual grade-adjusted pace this app already computes per run — the same
  // number the recap and quality-drift checks judge sessions against.
  const effortSub = detail.terrain_label
    ? detail.terrain_label.charAt(0).toUpperCase() + detail.terrain_label.slice(1)
    : detail.terrain_basis === 'treadmill-incline-unknown'
      ? 'Treadmill, incline not recorded'
      : detail.terrain_surface === 'treadmill'
        ? 'Treadmill, flat belt'
        : 'Flat course — pace reads straight';

  // ── Shoes ──────────────────────────────────────────────────────────────
  const shoeMileageCap = shoe?.mileage_cap ?? null;

  return (
    <div style={{ display: 'grid', gap: 'var(--stack-gap)', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 'var(--sp-6)', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <Tile pad="lg" radius="2xl">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="faff-kicker">{kicker}</div>
              <Badge tone={badgeTone}>{typeLabel}</Badge>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <SessionHeadline style={{ marginTop: 'var(--sp-7)' }} type={typeLabel} dose={dose} note={runNote} />
            </div>

            {metricItems.length > 0 && <MetricRow style={{ marginTop: 'var(--sp-9)' }} items={metricItems} />}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--sp-11)' }}>
              <div style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>Splits</div>
              <SegmentBar value={lens} onChange={(v) => setLens(v as Lens)}
                options={lensOptions.map((o) => ({ value: o, label: o }))} />
            </div>
            {showElevation && elevPoints ? (
              <ElevationProfile style={{ marginTop: 'var(--sp-7)' }} points={elevPoints}
                footnotes={[
                  detail.elev_gain_ft != null ? `Gain ${Math.round(detail.elev_gain_ft)} ft` : 'Gain unknown',
                  `Net ${elevPoints[elevPoints.length - 1] >= 0 ? '+' : ''}${Math.round(elevPoints[elevPoints.length - 1])} ft`,
                ]} />
            ) : detail.splits.length > 0 ? (
              <Splits style={{ marginTop: 'var(--sp-7)' }} splits={splitsForChart} band={band ? { low: band[0], high: band[1] } : null} />
            ) : (
              <div style={{ marginTop: 'var(--sp-7)', fontSize: 'var(--type-body-s)', color: 'var(--text-quiet)' }}>
                {detail.splits_unreliable ? 'Mile splits were flagged unreliable for this run.' : 'No mile splits recorded for this run.'}
              </div>
            )}

            {coachLine && <CoachSay size="md" style={{ padding: 'var(--sp-10) 0 0' }}>{coachLine}</CoachSay>}
            {!coachLine && recap === null && (
              <div style={{ marginTop: 'var(--sp-9)', fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>
                No coach read available for this run yet.
              </div>
            )}
          </Tile>
        </div>

        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <Tile>
            <div style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>Route</div>
            {detail.has_route && detail.route_polyline ? (
              <div style={{ marginTop: 'var(--sp-6)', height: 220 }}>
                <RouteMap polyline={detail.route_polyline} splits={detail.splits.map((s) => ({ mile: s.mile, pace: s.pace }))} height={220} />
              </div>
            ) : (
              <div style={{ marginTop: 'var(--sp-6)', fontSize: 'var(--type-meta)', color: 'var(--text-quiet)' }}>
                No GPS route recorded for this run.
              </div>
            )}
          </Tile>

          {detail.grade_adjusted_pace_s_per_mi != null && (
            <Tile>
              <Stat label="Effort" sub={effortSub} value={paceLabel(detail.grade_adjusted_pace_s_per_mi) ?? '·'} unit="/mi" size="md" />
              <div style={{ marginTop: 'var(--sp-6)', fontSize: 'var(--type-meta)', color: 'var(--text-quiet)' }}>
                For judging effort against a target · never shown as the pace you ran ({detail.pace ?? paceLabel(detail.pace_s_per_mi) ?? '·'}/mi).
              </div>
            </Tile>
          )}

          {detail.cadence_avg != null && (
            <Tile>
              <Stat label="Cadence" value={Math.round(detail.cadence_avg)} unit="spm" size="md"
                sub={detail.cadence_avg_work != null && Math.round(detail.cadence_avg_work) !== Math.round(detail.cadence_avg)
                  ? `${Math.round(detail.cadence_avg_work)} spm in the work` : 'Average across the run'} />
            </Tile>
          )}

          {detail.temp_f != null && (
            <Tile>
              <Stat label="Weather" value={Math.round(detail.temp_f)} unit="°F" size="md"
                sub={detail.weather_context?.message
                  ?? (detail.temp_range_f?.start != null && detail.temp_range_f?.end != null
                    ? `${Math.round(detail.temp_range_f.start)}°F to ${Math.round(detail.temp_range_f.end)}°F across the run`
                    : 'Recorded at start')} />
            </Tile>
          )}

          {shoe && (
            <Tile style={{ position: 'relative' }}>
              <Stat label="Shoes" sub={`${shoe.brand} ${shoe.model}`} value={Math.round(shoe.mileage ?? 0)}
                unit={shoeMileageCap ? `of ${shoeMileageCap} mi` : 'mi'} size="md" />
              {shoeMileageCap != null && (
                <RangeScale mode="progress" min={0} max={shoeMileageCap} value={shoe.mileage ?? 0}
                  endpoints={[String(Math.round(shoe.mileage ?? 0)), `Retire at ${shoeMileageCap}`]} />
              )}
              {!shoe.retired && (
                <div style={{ marginTop: 'var(--sp-6)' }}>
                  {retiredOk ? (
                    <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>Retired.</div>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setRetiring(true)}>Retire these shoes</Button>
                  )}
                </div>
              )}
              <Dialog open={retiring} title={`Retire the ${shoe.brand} ${shoe.model}?`} destructive
                confirmLabel={retireBusy ? 'Retiring…' : 'Retire shoes'} cancelLabel="Keep logging to them"
                onCancel={() => setRetiring(false)} onConfirm={confirmRetire}>
                They&rsquo;ll stop appearing as an option when you log a run, and their mileage total is final at {Math.round(shoe.mileage ?? 0)} mi. This can&rsquo;t be undone.
              </Dialog>
            </Tile>
          )}
        </div>
      </div>
    </div>
  );
}
