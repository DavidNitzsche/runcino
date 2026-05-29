/**
 * /runs/[id] — drill-down view for a single run.
 *
 * Phase 24 (2026-05-28) — adopted the FaffPageShell v3 chrome (matches
 * /log, /races, /health). Old inline title + bespoke "BigStat" grid +
 * card-eyebrow markup is gone. New structure:
 *
 *   FaffPageShell ─ title + eyebrow + accent
 *     ├─ StatTrio (compact, dark card)        · DISTANCE / PACE / TIME
 *     ├─ Plan vs. actual breakdown (BCard)    · phase_breakdown if present
 *     ├─ HR ZONES · DURATION (BCard)          · stacked bar w/ --zone-1..5
 *     ├─ MILE SPLITS (BCard)                  · 4-col grid, fastest/slowest
 *     └─ ELEVATION · ${total_ft} FT (BCard)   · SVG cumulative elev profile
 *
 * Constraints (per task spec):
 *  - No new server endpoints. Reuse `loadRunDetail`.
 *  - Don't fabricate data — render placeholders when fields are missing.
 *  - Don't touch /log click-through or the WeekStrip modal at /today.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FaffPageShell } from '@/components/faff/FaffPageShell';
import { BCard } from '@/components/faff/BCard';
import { StatTrio } from '@/components/faff/StatTrio';
import { WorkoutBreakdown, type WorkoutData } from '@/components/faff/WorkoutBreakdown';
import { loadRunDetail, type RunDetail, type RunSplit, type PhaseBreakdown } from '@/lib/coach/run-state';
import type { WorkoutSpec } from '@/lib/faff/types';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await loadRunDetail(DAVID_USER_ID, id);

  if (!run) {
    return (
      <FaffPageShell title="Run not found." eyebrow={`ID · ${id.toUpperCase()}`} maxWidth={1100}>
        <Link
          href="/log"
          style={{
            display: 'inline-block', color: 'var(--mute)', fontFamily: 'var(--f-body)',
            fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', fontWeight: 700,
          }}
        >
          ← BACK TO LOG
        </Link>
      </FaffPageShell>
    );
  }

  // ─── Title + eyebrow ─────────────────────────────────────────────────
  // Picked the "${distance}mi · ${date}" form — reads cleanest and gives
  // the headline a real anchor (the date alone was too thin against the
  // 80px Oswald display recipe). Use US-style date formatting so it
  // matches the rest of Faff (May 24 · 2026 → "May 24").
  // Always 1 decimal for the title — "27mi" reads as wrong for a 26.81mi
  // marathon (it's actually 26.2). "26.8mi" tracks closer to reality and
  // matches the precision the rest of the app shows in /log.
  const distanceStr = `${run.distance_mi.toFixed(1)}mi`;
  const dateLabel = formatDateLong(run.date);
  const title = `${distanceStr} · ${dateLabel}`;

  const eyebrowBits: string[] = [];
  if (run.pace) eyebrowBits.push(`${run.pace} AVG PACE`);
  if (run.hr_avg != null) eyebrowBits.push(`${run.hr_avg} BPM AVG`);
  if (run.cadence_avg != null) eyebrowBits.push(`${run.cadence_avg} SPM`);
  eyebrowBits.push(sourceLabel(run.source));
  const eyebrow = eyebrowBits.join(' · ');

  // Elevation badge — small accent chip at the title's right edge.
  const accent = run.elev_gain_ft != null && run.elev_gain_ft > 0 ? (
    <ElevAccent feet={run.elev_gain_ft} />
  ) : null;

  // ─── Stat trio ───────────────────────────────────────────────────────
  const stats = [
    { value: run.distance_mi.toFixed(run.distance_mi >= 10 ? 1 : 2), label: 'MILES', valueColor: 'dist' as const },
    { value: run.pace ?? '—', label: 'AVG PACE', valueColor: 'green' as const },
    { value: run.time_moving ?? '—', label: 'MOVING', valueColor: 'default' as const },
  ];

  // ─── Splits-derived insights (fastest / slowest highlighting) ────────
  const splitsWithPaceSec = run.splits.map((s) => ({ ...s, paceSec: parsePace(s.pace) }));
  const splitsWithPace = splitsWithPaceSec.filter((s): s is RunSplit & { paceSec: number } => s.paceSec != null);
  const fastestSplit = splitsWithPace.length > 0
    ? splitsWithPace.reduce((a, b) => (a.paceSec < b.paceSec ? a : b))
    : null;
  const slowestSplit = splitsWithPace.length > 0
    ? splitsWithPace.reduce((a, b) => (a.paceSec > b.paceSec ? a : b))
    : null;

  return (
    <FaffPageShell title={title} eyebrow={eyebrow} accent={accent} maxWidth={1100}>
      {/* Back link — sits just inside the body padding, above the trio.
          Faff convention from /races/[slug]: small caps-tracked link, no
          chevron art beyond the unicode arrow. */}
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/log"
          style={{
            color: 'var(--mute)', fontFamily: 'var(--f-body)',
            fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          ← BACK TO LOG
        </Link>
      </div>

      {/* ── Hero stat trio ── the three headline numbers in compact mode.
          Trio is wrapped in a tinted card so the Oswald display recipe
          gets the dark-background context the StatTrio module expects
          (its colors are calibrated against gradient overlays, see
          components/faff/StatTrio.module.css §"Lighter tints"). */}
      <div
        style={{
          background: 'linear-gradient(180deg, rgba(39,180,224,0.08), rgba(39,180,224,0) 70%)',
          border: '1px solid var(--line)',
          borderRadius: 18,
          padding: '26px 28px 18px',
          marginBottom: 18,
        }}
      >
        <StatTrio stats={stats} size="poster" />
      </div>

      {/* ── Planned structure ── Migration 120 wired the per-workout JSONB
          spec (Daniels VDOT pace targets, warmup/cooldown distances, rep
          pace, fuel checkpoints) into plan_workouts. When present, the
          WorkoutBreakdown component renders the SVG horizontal phase bar
          + structured header so the runner sees what was planned. The
          per-rep actuals still flow through PhaseBreakdownCard below
          (it's the WatchCompletion delta tier).

          Fallback when no spec: the placeholder card stays — runner
          either had no plan attached or the plan-builder authored this
          row without a VDOT (no race result yet). */}
      {run.planned_spec ? (
        <>
          <WorkoutBreakdown
            data={specToWorkoutData(run.planned_spec, run.planned_distance_mi)}
            runnerLthrBpm={run.hr_zones_from_lthr?.lthr ?? undefined}
          />
          <Spacer />
        </>
      ) : null}

      {/* ── HR target vs. actual ── Phase 31 (2026-05-28 · LTHR wire).
          The plan-builder emits HR caps / targets into workout_spec when
          the runner has a profile.lthr set (Friel · Research/03 §6 zones:
          easy ≤88% LTHR, long ≤85%, recovery ≤75%, threshold = LTHR
          direct, tempo/mp ≈92%). This card pulls the matching field off
          the spec, compares against the run's avg HR, and shows a colored
          delta (green if comfortably under, amber if 5% over, red if 10%
          over). Only renders when both a target AND an avg HR are
          present — silent when either is missing so cold-start runners
          don't see noise. */}
      {(() => {
        const target = pickHrTarget(run.planned_spec);
        if (target == null || run.hr_avg == null) return null;
        return (
          <>
            <HRTargetCard
              targetBpm={target.bpm}
              targetKind={target.kind}
              actualBpm={run.hr_avg}
            />
            <Spacer />
          </>
        );
      })()}

      {/* ── Plan vs. actual ── per-rep deltas from the WatchCompletion
          payload (Faff-watch runs only). When neither spec nor phases
          exist, render the placeholder. */}
      {run.phase_breakdown.length > 1 ? (
        <PhaseBreakdownCard phases={run.phase_breakdown} />
      ) : !run.planned_spec ? (
        <BCard header={{ label: 'PLAN VS. ACTUAL' }}>
          <Placeholder>
            No structured workout · open easy/long run · no phase plan to compare against
          </Placeholder>
        </BCard>
      ) : null}

      {/* ── HR zones ── stacked bar + per-zone labels with mm:ss + pct.
          Time per zone derives from total moving seconds × pct. */}
      <Spacer />
      <HRZonesCard pcts={run.hrZonePcts} movingTime={run.time_moving} />

      {/* ── Mile splits ── 4-col tabular grid. Highlights fastest (green)
          and slowest (amber) entries via BCard.valueColor on header
          column header? No — colours go on the row values. */}
      <Spacer />
      <SplitsCard
        splits={splitsWithPaceSec}
        fastestMile={fastestSplit?.mile ?? null}
        slowestMile={slowestSplit?.mile ?? null}
      />

      {/* ── Elevation profile ── cumulative line chart from per-mile
          elev_change_ft when available. */}
      <Spacer />
      <ElevationCard splits={run.splits} elevGainFt={run.elev_gain_ft} />
    </FaffPageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section spacer · 14px gap between BCards (matches /health Grid2 gap)
// ─────────────────────────────────────────────────────────────────────
function Spacer() {
  return <div style={{ height: 14 }} />;
}

// ─────────────────────────────────────────────────────────────────────
// Elevation accent chip · sits in the FaffPageShell.accent slot.
// ─────────────────────────────────────────────────────────────────────
function ElevAccent({ feet }: { feet: number }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 999,
        background: 'rgba(176,132,255,0.08)',
        border: '1px solid rgba(176,132,255,0.30)',
        color: 'var(--learn)',
        fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700,
        letterSpacing: '1.2px', textTransform: 'uppercase',
      }}
    >
      {Math.round(feet).toLocaleString()} FT GAIN
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// HR target card · Phase 31 (2026-05-28 · LTHR wire). Compares the run's
// actual avg HR against the planned target/cap (off workout_spec) and
// shows a colored delta. The kind label varies per spec:
//   easy / long / recovery / progression → "HR CAP"   (don't exceed)
//   tempo / mp                            → "HR TARGET" (sit on it)
//   threshold / intervals                  → "LTHR ANCHOR" (rep HR sits at)
// Cite: Friel · Research/03 §6 (LTHR-zone semantics).
// ─────────────────────────────────────────────────────────────────────
type HrTargetKind = 'cap' | 'target' | 'lthr';

function pickHrTarget(spec: WorkoutSpec | null): { bpm: number; kind: HrTargetKind } | null {
  if (!spec) return null;
  switch (spec.kind) {
    case 'easy':
    case 'long':
    case 'recovery':
    case 'progression':
      return spec.hr_cap_bpm != null ? { bpm: spec.hr_cap_bpm, kind: 'cap' } : null;
    case 'tempo':
    case 'mp':
      return spec.hr_target_bpm != null ? { bpm: spec.hr_target_bpm, kind: 'target' } : null;
    case 'threshold':
    case 'intervals':
      return spec.lthr_bpm != null ? { bpm: spec.lthr_bpm, kind: 'lthr' } : null;
    case 'fartlek':
      return null; // fartlek spec doesn't carry an HR field
    default:
      return null;
  }
}

function hrTargetLabel(kind: HrTargetKind): string {
  switch (kind) {
    case 'cap':    return 'HR CAP';
    case 'target': return 'HR TARGET';
    case 'lthr':   return 'LTHR ANCHOR';
  }
}

function HRTargetCard({
  targetBpm,
  targetKind,
  actualBpm,
}: {
  targetBpm: number;
  targetKind: HrTargetKind;
  actualBpm: number;
}) {
  // Delta semantics depend on the kind. For a CAP, "over by 10%" is a
  // miss (you blew past the ceiling). For a TARGET, "within ±5%" is on
  // (you sat where you should). For LTHR ANCHOR, the rep HR usually
  // lands NEAR or slightly above — Z5a sits at 100–102% LTHR so being
  // within ~5% is on-anchor. Research/03 §6.
  const deltaPct = ((actualBpm - targetBpm) / targetBpm) * 100;
  // Color:
  //   cap kind:    under = green; over 5% = amber; over 10% = red
  //   target kind: within 3% either side = green; outside 3% = amber;
  //                outside 8% = red
  //   lthr kind:   between -5% and +5% = green (on-anchor);
  //                outside ±5% but within ±10% = amber; beyond ±10% = red
  let color: 'green' | 'goal' | 'over' = 'green';
  if (targetKind === 'cap') {
    if (deltaPct >= 10) color = 'over';
    else if (deltaPct >= 5) color = 'goal';
    else color = 'green';
  } else if (targetKind === 'target') {
    const abs = Math.abs(deltaPct);
    if (abs > 8) color = 'over';
    else if (abs > 3) color = 'goal';
    else color = 'green';
  } else {
    // lthr
    const abs = Math.abs(deltaPct);
    if (abs > 10) color = 'over';
    else if (abs > 5) color = 'goal';
    else color = 'green';
  }
  const deltaSign = deltaPct >= 0 ? '+' : '';
  const deltaStr = `${deltaSign}${deltaPct.toFixed(1)}%`;
  const statusLabel = (() => {
    if (targetKind === 'cap') {
      if (color === 'green') return 'UNDER CAP';
      if (color === 'goal') return 'AT CAP';
      return 'OVER CAP';
    }
    if (targetKind === 'target') {
      if (color === 'green') return 'ON TARGET';
      if (color === 'goal') return 'OFF TARGET';
      return 'MISSED';
    }
    // lthr
    if (color === 'green') return 'ON ANCHOR';
    if (color === 'goal') return 'OFF ANCHOR';
    return 'WELL OFF';
  })();
  const label = hrTargetLabel(targetKind);
  return (
    <BCard header={{ label: `${label} · PLAN VS. ACTUAL`, value: statusLabel }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 18,
          padding: '4px 0 8px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              fontFamily: 'var(--f-body)', fontSize: 9.5, fontWeight: 700,
              letterSpacing: '1.2px', color: 'var(--mute)',
              textTransform: 'uppercase',
            }}
          >
            TARGET
          </div>
          <div
            className="tabular"
            style={{
              fontFamily: 'var(--f-display)', fontSize: 34,
              color: 'var(--ink)', letterSpacing: '-0.5px', lineHeight: 1,
            }}
          >
            {targetBpm}
          </div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)' }}>
            bpm
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              fontFamily: 'var(--f-body)', fontSize: 9.5, fontWeight: 700,
              letterSpacing: '1.2px', color: 'var(--mute)',
              textTransform: 'uppercase',
            }}
          >
            ACTUAL AVG
          </div>
          <div
            className="tabular"
            style={{
              fontFamily: 'var(--f-display)', fontSize: 34,
              color: 'var(--ink)', letterSpacing: '-0.5px', lineHeight: 1,
            }}
          >
            {actualBpm}
          </div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)' }}>
            bpm
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              fontFamily: 'var(--f-body)', fontSize: 9.5, fontWeight: 700,
              letterSpacing: '1.2px', color: 'var(--mute)',
              textTransform: 'uppercase',
            }}
          >
            DELTA
          </div>
          <div
            className="tabular"
            style={{
              fontFamily: 'var(--f-display)', fontSize: 34,
              color: `var(--${color})`, letterSpacing: '-0.5px', lineHeight: 1,
            }}
          >
            {deltaStr}
          </div>
          <div
            style={{
              fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700,
              letterSpacing: '1.2px', color: `var(--${color})`,
              textTransform: 'uppercase',
            }}
          >
            {statusLabel}
          </div>
        </div>
      </div>
    </BCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase breakdown card · plan-vs-actual table, ported from RunDetailModal
// but using BCard chrome so it lives consistently inside the new shell.
// ─────────────────────────────────────────────────────────────────────
function PhaseBreakdownCard({ phases }: { phases: PhaseBreakdown[] }) {
  const workCount = phases.filter((p) => p.type === 'work').length;
  return (
    <BCard
      header={{
        label: 'PLAN VS. ACTUAL',
        value: workCount > 0 ? `${workCount} WORK ${workCount === 1 ? 'PHASE' : 'PHASES'}` : undefined,
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--f-body)', fontSize: 12 }}>
        <thead>
          <tr
            style={{
              color: 'var(--mute)', fontSize: 9.5, letterSpacing: '1.1px',
              textTransform: 'uppercase', fontWeight: 700,
            }}
          >
            <th style={{ textAlign: 'left',  padding: '6px 4px' }}>PHASE</th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>TARGET</th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>ACTUAL</th>
            <th style={{ textAlign: 'right', padding: '6px 4px' }}>HR</th>
            <th style={{ textAlign: 'right', padding: '6px 4px', width: 50 }}>·</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((p) => {
            const showPace = p.type === 'work';
            const targetCell = showPace
              ? (p.target_pace ?? '—')
              : (p.target_duration_sec ? fmtDur(p.target_duration_sec) : (p.target_pace ?? '—'));
            const actualCell = showPace
              ? (p.actual_pace ?? '—')
              : (p.actual_duration_sec ? fmtDur(p.actual_duration_sec) : (p.actual_pace ?? '—'));
            return (
              <tr key={p.index} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '8px 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                        background: 'rgba(255,255,255,0.05)',
                        color: phaseTypeColor(p.type),
                        fontSize: 8.5, letterSpacing: '0.9px', fontWeight: 700,
                      }}
                    >
                      {phaseTypeLabel(p.type)}
                    </span>
                    <span style={{ color: 'var(--ink)', fontSize: 12.5 }}>{p.label}</span>
                  </div>
                  {p.actual_distance_mi != null && (
                    <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 2 }}>
                      {p.actual_distance_mi.toFixed(2)}mi
                      {p.actual_duration_sec && showPace ? ` · ${fmtDur(p.actual_duration_sec)}` : ''}
                    </div>
                  )}
                </td>
                <td
                  className="tabular"
                  style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--mute)', fontSize: 13 }}
                >
                  {targetCell}
                </td>
                <td
                  className="tabular"
                  style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--ink)', fontSize: 13.5 }}
                >
                  {actualCell}
                </td>
                <td
                  className="tabular"
                  style={{ padding: '8px 4px', textAlign: 'right', color: p.avg_hr ? 'var(--ink)' : 'var(--mute)', fontSize: 13 }}
                >
                  {p.avg_hr ?? '—'}
                </td>
                <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                  <span
                    style={{
                      fontSize: 8.5, letterSpacing: '1px', fontWeight: 700,
                      color: phaseStatusColor(p.status),
                    }}
                  >
                    {phaseStatusLabel(p.status)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </BCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
// HR zones card · stacked horizontal bar + per-zone caption row.
// ─────────────────────────────────────────────────────────────────────
function HRZonesCard({
  pcts,
  movingTime,
}: {
  pcts: { z1: number; z2: number; z3: number; z4: number; z5: number };
  movingTime: string | null;
}) {
  const total = pcts.z1 + pcts.z2 + pcts.z3 + pcts.z4 + pcts.z5;
  if (total <= 0) {
    return (
      <BCard header={{ label: 'HR ZONES · DURATION' }}>
        <Placeholder>HR data not in this run · likely a manual entry</Placeholder>
      </BCard>
    );
  }

  // Derive total moving seconds for the per-zone mm:ss labels. If we
  // don't have a parseable moving time, fall back to percentage-only.
  const totalSec = parseTimeToSeconds(movingTime);

  const zones = (['z1', 'z2', 'z3', 'z4', 'z5'] as const).map((z, i) => {
    const pct = pcts[z];
    const zoneNum = i + 1;
    const seconds = totalSec != null ? Math.round((pct / 100) * totalSec) : null;
    return {
      key: z,
      label: `Z${zoneNum}`,
      pct,
      seconds,
      color: `var(--zone-${zoneNum})`,
    };
  });

  // Headline value = the dominant zone.
  const dominant = zones.reduce((a, b) => (a.pct >= b.pct ? a : b));
  const headerValue = dominant.pct > 0 ? `${dominant.label} ${Math.round(dominant.pct)}%` : undefined;

  return (
    <BCard header={{ label: 'HR ZONES · DURATION', value: headerValue }}>
      {/* Stacked bar */}
      <div
        style={{
          display: 'flex', height: 18, borderRadius: 5, overflow: 'hidden',
          background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line2)',
        }}
      >
        {zones.map((z) => {
          if (z.pct <= 0) return null;
          return (
            <div
              key={z.key}
              style={{ flex: z.pct, background: z.color, opacity: 0.92 }}
              title={`${z.label} ${Math.round(z.pct)}%`}
            />
          );
        })}
      </div>

      {/* Per-zone caption row */}
      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8,
          marginTop: 14,
        }}
      >
        {zones.map((z) => (
          <div key={z.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 8, height: 8, borderRadius: 2, background: z.color, flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '1.2px', color: 'var(--ink)',
                }}
              >
                {z.label}
              </span>
            </div>
            <div
              className="tabular"
              style={{
                fontFamily: 'var(--f-body)', fontSize: 12, color: z.pct > 0 ? 'var(--ink)' : 'var(--mute)',
                fontWeight: 600,
              }}
            >
              {z.seconds != null ? formatMmSs(z.seconds) : '—'}
            </div>
            <div
              className="tabular"
              style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '0.4px' }}
            >
              {Math.round(z.pct)}%
            </div>
          </div>
        ))}
      </div>
    </BCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Mile splits card · 4-col grid (MI · PACE · HR · ELEV)
// ─────────────────────────────────────────────────────────────────────
function SplitsCard({
  splits,
  fastestMile,
  slowestMile,
}: {
  splits: (RunSplit & { paceSec: number | null })[];
  fastestMile: number | null;
  slowestMile: number | null;
}) {
  if (splits.length === 0) {
    return (
      <BCard header={{ label: 'MILE SPLITS' }}>
        <Placeholder>Mile splits aren't in this activity · likely a manual entry</Placeholder>
      </BCard>
    );
  }

  return (
    <BCard header={{ label: 'MILE SPLITS', value: `${splits.length} ${splits.length === 1 ? 'MILE' : 'MILES'}` }}>
      {/* Header row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '48px 1fr 1fr 1fr',
          gap: 12,
          fontFamily: 'var(--f-body)', fontSize: 9.5, fontWeight: 700,
          letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--mute)',
          padding: '4px 0 8px',
          borderBottom: '1px solid var(--line2)',
        }}
      >
        <span>MI</span>
        <span style={{ textAlign: 'right' }}>PACE</span>
        <span style={{ textAlign: 'right' }}>HR AVG</span>
        <span style={{ textAlign: 'right' }}>ELEV</span>
      </div>

      {/* Rows */}
      {splits.map((s) => {
        const isFastest = fastestMile != null && s.mile === fastestMile;
        const isSlowest = slowestMile != null && s.mile === slowestMile;
        const paceColor = isFastest ? 'var(--green)' : isSlowest ? 'var(--goal)' : 'var(--ink)';

        return (
          <div
            key={s.mile}
            style={{
              display: 'grid',
              gridTemplateColumns: '48px 1fr 1fr 1fr',
              gap: 12,
              fontFamily: 'var(--f-body)', fontSize: 13,
              padding: '10px 0',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
              alignItems: 'center',
            }}
          >
            <span style={{ color: 'var(--mute)', fontWeight: 600 }} className="tabular">
              {s.mile}
            </span>
            <span
              className="tabular"
              style={{ textAlign: 'right', color: paceColor, fontWeight: isFastest || isSlowest ? 700 : 500 }}
            >
              {s.pace ?? '—'}
            </span>
            <span className="tabular" style={{ textAlign: 'right', color: s.hr ? 'var(--ink)' : 'var(--mute)' }}>
              {s.hr ?? '—'}
            </span>
            <span className="tabular" style={{ textAlign: 'right', color: 'var(--mute)' }}>
              {s.elev_change_ft != null
                ? `${s.elev_change_ft > 0 ? '+' : ''}${Math.round(s.elev_change_ft)}`
                : '—'}
            </span>
          </div>
        );
      })}
    </BCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Elevation profile card · SVG line chart of cumulative gain.
// ─────────────────────────────────────────────────────────────────────
function ElevationCard({ splits, elevGainFt }: { splits: RunSplit[]; elevGainFt: number | null }) {
  // Build cumulative elevation series from per-mile elev_change_ft.
  const hasElevPerSplit = splits.some((s) => s.elev_change_ft != null);

  if (!hasElevPerSplit) {
    return (
      <BCard
        header={{
          label: elevGainFt != null ? `ELEVATION · ${Math.round(elevGainFt).toLocaleString()} FT` : 'ELEVATION',
        }}
      >
        <Placeholder>Per-mile elevation isn't in this activity · only total gain available</Placeholder>
      </BCard>
    );
  }

  // Cumulative series — start at 0, accumulate split-by-split.
  let cum = 0;
  const series: { mile: number; cum: number }[] = [{ mile: 0, cum: 0 }];
  for (const s of splits) {
    cum += s.elev_change_ft ?? 0;
    series.push({ mile: s.mile, cum });
  }

  const maxCum = Math.max(...series.map((p) => p.cum));
  const minCum = Math.min(...series.map((p) => p.cum));
  const range = Math.max(50, maxCum - minCum); // 50 ft floor so flat runs still show a line
  const totalMiles = series[series.length - 1].mile || splits.length;

  // Project onto 0–100 × 0–100 viewBox. Y is inverted (SVG top-left origin).
  const points = series.map((p) => {
    const x = (p.mile / totalMiles) * 100;
    const yNorm = (p.cum - minCum) / range; // 0 (low) → 1 (high)
    const y = 96 - yNorm * 80; // leave 16px top margin, 4px bottom margin
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L 100,100 L 0,100 Z`;

  const headerLabel = elevGainFt != null
    ? `ELEVATION · ${Math.round(elevGainFt).toLocaleString()} FT`
    : `ELEVATION · ${Math.round(maxCum).toLocaleString()} FT`;

  return (
    <BCard header={{ label: headerLabel }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: '100%', height: 140, display: 'block' }}
        aria-label="Cumulative elevation gain across the run"
      >
        <defs>
          <linearGradient id="elev-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--learn)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--learn)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#elev-fill)" />
        <path d={linePath} fill="none" stroke="var(--learn)" strokeWidth="0.6" strokeLinejoin="round" />
      </svg>

      {/* Axis captions */}
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 8,
          fontFamily: 'var(--f-body)', fontSize: 9.5, color: 'var(--mute)',
          letterSpacing: '1.2px', textTransform: 'uppercase', fontWeight: 700,
        }}
      >
        <span>MILE 0</span>
        <span>MILE {Math.round(totalMiles)}</span>
      </div>
    </BCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Placeholder · used when a data field isn't available.
// ─────────────────────────────────────────────────────────────────────
function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '24px 16px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px dashed var(--line2)',
        borderRadius: 8,
        fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)',
        textAlign: 'center', lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────

/** "2026-05-24" → "MAY 24" */
function formatDateLong(iso: string): string {
  // Parse the YYYY-MM-DD as a *local* date — never use new Date(iso)
  // because that interprets bare ISO as UTC and shifts the day by tz.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const [, , monthStr, dayStr] = m;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthIdx = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);
  if (monthIdx < 0 || monthIdx > 11 || isNaN(day)) return iso;
  return `${months[monthIdx]} ${day}`;
}

/** "watch" → "WATCH", "apple_health" → "APPLE HEALTH". */
function sourceLabel(source: string): string {
  return source.replace(/_/g, ' ').toUpperCase();
}

/** "8:50" → 530 seconds; "1:08:50" → 4130. */
function parsePace(s: string | null | undefined): number | null {
  if (!s) return null;
  const mm = s.match(/^(\d+):(\d{2})$/);
  if (mm) return parseInt(mm[1], 10) * 60 + parseInt(mm[2], 10);
  return null;
}

/** "54:29" → 3269; "1:54:29" → 6869. */
function parseTimeToSeconds(s: string | null | undefined): number | null {
  if (!s) return null;
  const hms = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hms) return parseInt(hms[1], 10) * 3600 + parseInt(hms[2], 10) * 60 + parseInt(hms[3], 10);
  const ms = s.match(/^(\d+):(\d{2})$/);
  if (ms) return parseInt(ms[1], 10) * 60 + parseInt(ms[2], 10);
  return null;
}

/** 530 → "8:50"; 4130 → "1:08:50". */
function formatMmSs(secs: number): string {
  if (!isFinite(secs) || secs < 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Phase breakdown duration helper · "—" for zero/null. */
function fmtDur(s: number | null): string {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  if (m === 0) return `${r}s`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function phaseTypeLabel(t: PhaseBreakdown['type']): string {
  switch (t) {
    case 'warmup':   return 'WARMUP';
    case 'cooldown': return 'COOLDOWN';
    case 'recovery': return 'RECOVERY';
    case 'work':     return 'WORK';
    default:         return 'PHASE';
  }
}

function phaseTypeColor(t: PhaseBreakdown['type']): string {
  switch (t) {
    case 'warmup':
    case 'cooldown': return 'var(--rest)';
    case 'recovery': return 'var(--mute)';
    case 'work':     return 'var(--goal)';
    default:         return 'var(--ink)';
  }
}

function phaseStatusLabel(st: PhaseBreakdown['status']): string {
  return st === 'on' ? 'ON' : st === 'fast' ? 'FAST' : st === 'slow' ? 'SLOW' : '—';
}

// ─────────────────────────────────────────────────────────────────────
// WorkoutSpec (migration 120 JSONB) → WorkoutData (component prop).
//
// The DB schema and the WorkoutBreakdown component use slightly different
// field names for the same conceptual shape — the DB stores
// pace_target_s_per_mi_lo/hi as a flat pair, while the component groups
// them under `pace_target: { s, band }` for easy / `pace_band: [lo, hi]`
// for long. This translator does the mapping. Mismatched kinds (e.g. a
// fartlek spec we don't yet render) fall through to a placeholder easy
// shape so the chart still renders something — the placeholder is fine
// because fartlek/MP/recovery components are deferred per the
// WorkoutBreakdown spec (designs/components/WorkoutBreakdown.md).
// ─────────────────────────────────────────────────────────────────────
function specToWorkoutData(spec: WorkoutSpec, fallbackDistanceMi: number | null): WorkoutData {
  switch (spec.kind) {
    case 'easy':
      return {
        type: 'easy',
        distance_mi: fallbackDistanceMi ?? 0,
        pace_target: {
          s: Math.round((spec.pace_target_s_per_mi_lo + spec.pace_target_s_per_mi_hi) / 2),
          band: [spec.pace_target_s_per_mi_lo, spec.pace_target_s_per_mi_hi],
        },
        hr_cap: spec.hr_cap_bpm,
      };
    case 'long':
      return {
        type: 'long',
        distance_mi: fallbackDistanceMi ?? 0,
        pace_band: [spec.pace_target_s_per_mi_lo, spec.pace_target_s_per_mi_hi],
        fuel_checkpoints_mi: spec.fuel_mi,
      };
    case 'threshold':
    case 'intervals':
      return {
        type: 'intervals',
        warmup_mi: spec.warmup_mi,
        reps: spec.rep_count,
        rep_distance_m: spec.rep_distance_m
          ?? (spec.rep_distance_mi ? Math.round(spec.rep_distance_mi * 1609) : 1000),
        rep_pace_s_per_mi: spec.rep_pace_s_per_mi,
        rest_jog_s: spec.rep_rest_s,
        cooldown_mi: spec.cooldown_mi,
      };
    case 'tempo':
      return {
        type: 'tempo',
        warmup_mi: spec.warmup_mi,
        tempo_distance_mi: spec.tempo_distance_mi,
        tempo_pace_s_per_mi: spec.tempo_pace_s_per_mi,
        cooldown_mi: spec.cooldown_mi,
      };
    case 'progression':
      // Progression chart variant is post-v1 per the WorkoutBreakdown
      // spec. Render the placeholder via the component's default case.
      return {
        type: 'progression',
        total_mi: spec.warmup_mi + spec.prog_distance_mi + spec.cooldown_mi,
        start_pace_s_per_mi: spec.prog_start_s_per_mi,
        end_pace_s_per_mi: spec.prog_end_s_per_mi,
        phase_breakpoints_mi: [spec.warmup_mi, spec.warmup_mi + spec.prog_distance_mi],
      };
    case 'recovery':
      // Recovery has no dedicated chart variant — render as a soft "easy"
      // shape (pace band + light HR cap if known).
      return {
        type: 'easy',
        distance_mi: fallbackDistanceMi ?? 0,
        pace_target: {
          s: Math.round((spec.pace_target_s_per_mi_lo + spec.pace_target_s_per_mi_hi) / 2),
          band: [spec.pace_target_s_per_mi_lo, spec.pace_target_s_per_mi_hi],
        },
        hr_cap: spec.hr_cap_bpm,
      };
    case 'mp':
      // MP block ≈ tempo at marathon pace · borrow the tempo chart.
      return {
        type: 'tempo',
        warmup_mi: spec.warmup_mi,
        tempo_distance_mi: spec.mp_distance_mi,
        tempo_pace_s_per_mi: spec.mp_pace_s_per_mi,
        cooldown_mi: spec.cooldown_mi,
      };
    case 'fartlek':
      // Fartlek has no dedicated chart variant yet — fall through to the
      // post-v1 placeholder via the 'hills' branch (component renders
      // "<type> chart variant lands post-v1 per spec").
      return {
        type: 'hills',
        warmup_mi: spec.warmup_mi,
        reps: spec.segments.length,
        hill_distance_m: 0,
        hill_grade_pct: 0,
        recovery_s: 0,
        cooldown_mi: spec.cooldown_mi,
      };
    default: {
      // Exhaustive guard — TS won't let unknown kinds through.
      const _exhaustive: never = spec;
      void _exhaustive;
      return {
        type: 'easy',
        distance_mi: fallbackDistanceMi ?? 0,
        pace_target: { s: 0, band: [0, 0] },
        hr_cap: null,
      };
    }
  }
}

function phaseStatusColor(st: PhaseBreakdown['status']): string {
  return st === 'on' ? 'var(--green)'
    : st === 'fast' ? 'var(--over)'
    : st === 'slow' ? 'var(--goal)'
    : 'var(--mute)';
}
