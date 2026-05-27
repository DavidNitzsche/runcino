'use client';

/**
 * DayDetailModal — opens when any day tile in the week strip is tapped.
 * Handles all four states:
 *   - past + ran → shows run recap + link into the full run-detail modal
 *   - today/future + planned → shows planned workout details (type, distance,
 *     target pace/HR, notes, zone band)
 *   - rest day → quiet acknowledgement
 *   - empty/unplanned → "no plan for this day yet" hint
 */
import { useEffect, useState } from 'react';
import type { GlanceWeekDay } from '@/lib/coach/glance-state';
import type { RunDetail } from '@/lib/coach/run-state';
import type { Prescription, PrescriptionStep } from '@/lib/training/prescriptions';
import { RunDetailTrigger } from '@/components/runs/RunDetailModal';

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

interface Props {
  day: GlanceWeekDay;
  onClose: () => void;
  /**
   * Optional pre-fetched prescription. When provided, the modal renders
   * synchronously with no fetch on open — kills the pop-in. WeekStrip
   * pre-fetches all 7 days when it mounts and passes the matching one
   * in here. WeekAhead.tsx doesn't pass this (legacy caller); the
   * PlannedWorkoutBody falls back to the old on-mount fetch.
   */
  prefetchedPres?: Prescription | null;
  /**
   * Same idea for the past+ran case — pre-fetched run detail (pace,
   * time, HR avg) so the CompletedRunBody BigStats render synchronously.
   */
  prefetchedRun?: RunDetail | null;
}

export function DayDetailModal({ day, onClose, prefetchedPres, prefetchedRun }: Props) {
  const [runDetail, setRunDetail] = useState<RunDetail | null>(prefetchedRun ?? null);
  const ran = day.doneMi >= 0.5;
  const isRest = day.plannedType === 'rest';
  const isUnplanned = day.plannedType === 'unplanned' || (day.plannedMi === 0 && !isRest);

  // If past + ran AND no prefetch came in, fetch detail to show splits
  // + HR zone summary inline. WeekStrip path always pre-fetches so this
  // is only the WeekAhead-on-/training fallback.
  useEffect(() => {
    if (prefetchedRun) { setRunDetail(prefetchedRun); return; }
    if (!ran || !day.activityId) return;
    let mounted = true;
    fetch(`/api/runs/${encodeURIComponent(day.activityId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (mounted && d) setRunDetail(d); })
      .catch(() => {});
    return () => { mounted = false; };
  }, [ran, day.activityId, prefetchedRun]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Color + label for the workout type
  const typeColor = ran        ? 'var(--green)'
    : isRest                   ? 'var(--rest)'
    : day.plannedType === 'long'      ? 'var(--dist)'
    : day.plannedType === 'race'      ? 'var(--race)'
    : day.plannedType === 'tempo'     ? 'var(--goal)'
    : day.plannedType === 'threshold' ? 'var(--goal)'
    : day.plannedType === 'intervals' ? 'var(--goal)'
    : day.plannedType === 'easy'      ? 'var(--learn)'  // distinct from long/quality/rest
    : day.plannedType === 'shakeout'  ? 'var(--learn)'
    :                                   'var(--mute)';
  const typeLabel = ran     ? 'COMPLETED'
    : isRest                ? 'REST DAY'
    : isUnplanned           ? 'NO PLAN'
    : day.plannedLabel ?? day.plannedType.toUpperCase();

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.78)', backdropFilter: 'blur(10px)',
        zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#181a1d', border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)', borderRadius: 20,
          padding: '28px 32px', maxWidth: 600, width: '100%', maxHeight: '85vh', overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
          <div>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: typeColor, letterSpacing: '1.6px', fontWeight: 700, textTransform: 'uppercase' }}>
              {typeLabel}{day.isToday ? ' · TODAY' : ''}
            </div>
            <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 38, letterSpacing: '0.5px', margin: '8px 0 4px', lineHeight: 1, color: 'var(--ink)' }}>
              {DOW_LONG[day.dow]}
            </h2>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', letterSpacing: '1.2px' }}>
              {fmtDate(day.date)}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--mute)', fontSize: 26, cursor: 'pointer', lineHeight: 1,
          }} aria-label="Close">×</button>
        </div>

        {/* Body — branches on state */}
        {ran && <CompletedRunBody day={day} detail={runDetail} />}
        {!ran && !isRest && !isUnplanned && <PlannedWorkoutBody day={day} typeColor={typeColor} prefetchedPres={prefetchedPres ?? null} />}
        {isRest && !ran && <RestBody />}
        {isUnplanned && !ran && <UnplannedBody day={day} />}
      </div>
    </div>
  );
}

// ── Body variants ───────────────────────────────────────────────────────

function CompletedRunBody({ day, detail }: { day: GlanceWeekDay; detail: RunDetail | null }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
        <BigStat v={day.doneMi.toFixed(1)} u="miles" color="var(--dist)" />
        {detail?.pace        && <BigStat v={detail.pace}        u="avg pace" color="var(--green)" />}
        {detail?.time_moving && <BigStat v={detail.time_moving} u="moving"   color="var(--ink)" />}
        {detail?.hr_avg != null && <BigStat v={String(detail.hr_avg)} u="avg hr" color="var(--mute)" />}
      </div>
      {day.activityId && (
        // Pass the already-fetched detail down so the deeper RunDetailModal
        // also opens with no skeleton flash — same prefetch chain.
        <RunDetailTrigger
          activityId={day.activityId}
          label="Splits · route · form data →"
          prefetchedData={detail}
        />
      )}
    </>
  );
}

function PlannedWorkoutBody({ day, typeColor, prefetchedPres }: { day: GlanceWeekDay; typeColor: string; prefetchedPres: Prescription | null }) {
  // If parent pre-fetched (WeekStrip path), render synchronously with no
  // loading state — kills the pop-in. Otherwise (WeekAhead path), fall
  // back to the on-mount fetch.
  const [pres, setPres] = useState<Prescription | null>(prefetchedPres);
  const [loading, setLoading] = useState(prefetchedPres == null);

  useEffect(() => {
    if (prefetchedPres) { setPres(prefetchedPres); setLoading(false); return; }
    let mounted = true;
    // We don't yet know the week's planned mileage from glance, so pass
    // the day's planned mi as a proxy weekly volume (the prescriptions
    // module scales rep counts off this — close enough for reasonable
    // bands).
    const proxyWeekly = Math.max(day.plannedMi * 6, 25);
    fetch(`/api/prescription?type=${encodeURIComponent(day.plannedType)}&weeklyMi=${proxyWeekly}&targetMi=${day.plannedMi}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (mounted) { setPres(d); setLoading(false); } })
      .catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [day.plannedType, day.plannedMi, prefetchedPres]);

  return (
    <>
      {/* Hero: distance + headline */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 72, color: typeColor, lineHeight: 1, letterSpacing: '0.5px' }}>
          {day.plannedMi.toFixed(day.plannedMi % 1 === 0 ? 0 : 1)}
        </span>
        <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>MI</span>
      </div>
      {pres?.headline && (
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)', letterSpacing: '0.3px', marginBottom: 4 }}>
          {pres.headline}
        </div>
      )}
      {pres?.why && (
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 13.5, color: 'rgba(246,247,248,0.78)', lineHeight: 1.55, marginBottom: 16, fontStyle: 'italic' }}>
          {pres.why}
        </div>
      )}

      {loading && (
        <div style={{ color: 'var(--mute)', fontSize: 13, padding: '12px 0' }}>Loading prescription…</div>
      )}

      {/* Structured steps — one card per step (warmup, reps, recovery, cooldown).
          Repeat blocks (step.recovery present) render as a section header
          ("REPEAT 4×") plus two separate boxes underneath: gold reps box +
          purple recovery box. */}
      {pres?.steps && pres.steps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          {pres.steps.map((step, i) => step.recovery
            ? <RepeatBlock key={i} step={step} />
            : <StepCard key={i} step={step} />
          )}
        </div>
      )}

      {day.isToday && (
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', marginTop: 14, fontStyle: 'italic' }}>
          The run will appear here once the watch syncs it back.
        </div>
      )}
    </>
  );
}

function StepCard({ step }: { step: PrescriptionStep; accent?: string }) {
  // Color the step border by EFFORT TIER, not workout type. Three tiers
  // so warmup/cooldown read distinctly from the recovery-inside-REPEAT
  // block (which lives inside RepeatBlock with purple).
  //   - warmup, cooldown                       → blue   (var(--rest))
  //   - easy build, easy run, recovery-between → purple (var(--learn))
  //   - reps, tempo, threshold, MP finish      → gold   (var(--goal))
  //   - race                                   → orange (var(--race))
  //   - rest-only day                          → blue   (var(--rest))
  const label = step.label.toLowerCase();
  const isRest = label.includes('today') && (step.note ?? '').toLowerCase().includes('no running');
  const isWarmupCooldown = label.includes('warmup') || label.includes('cooldown');
  const isEasy = label.includes('easy') || label.includes('recovery');
  const isRace = label.includes('race');
  const isHard = label.includes('reps') || label.includes('tempo') ||
                 label.includes('threshold') || label.includes('marathon-pace') ||
                 label.includes('finish') || label.includes('strides') ||
                 label.includes('interval');
  const accent =
    isRest           ? 'var(--rest)' :
    isWarmupCooldown ? 'var(--rest)' :
    isRace           ? 'var(--race)' :
    isHard           ? 'var(--goal)' :
    isEasy           ? 'var(--learn)' :
                       'var(--mute)';

  // Volume label — describes what one rep / the whole step looks like.
  // For repeat blocks with recovery, the volume label shows the EACH unit.
  let volumeLabel: string;
  const isRepeatBlock = step.recovery != null && step.reps != null;
  if (step.reps != null && step.rep_distance_mi != null) {
    const repFmt = step.rep_distance_mi < 1
      ? `${Math.round(step.rep_distance_mi * 1609)} m`
      : `${step.rep_distance_mi % 1 === 0 ? step.rep_distance_mi : step.rep_distance_mi.toFixed(1)} mi`;
    volumeLabel = isRepeatBlock ? `each: ${repFmt}` : `${step.reps} × ${repFmt}`;
  } else if (step.reps != null && step.duration) {
    volumeLabel = `${step.reps} × ${step.duration}`;
  } else if (step.distance_mi != null) {
    volumeLabel = `${step.distance_mi % 1 === 0 ? step.distance_mi : step.distance_mi.toFixed(1)} mi`;
  } else if (step.duration) {
    volumeLabel = step.duration;
  } else {
    volumeLabel = '';
  }

  return (
    <div style={{
      background: '#1f2226', borderRadius: 12, padding: '14px 18px',
      border: '1px solid rgba(255,255,255,0.05)',
      borderLeft: `3px solid ${accent}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: accent, letterSpacing: '1.4px', textTransform: 'uppercase' }}>
          {step.label}
        </div>
        {volumeLabel && (
          <div style={{ fontFamily: 'var(--f-label)', fontSize: 17, color: 'var(--ink)', letterSpacing: '0.3px' }}>
            {volumeLabel}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontFamily: 'var(--f-body)', fontSize: 12.5, marginBottom: 6 }}>
        {step.pace_target && (
          <span><span style={{ color: 'var(--mute)' }}>PACE</span>{' '}<span style={{ color: 'var(--ink)', fontWeight: 600 }}>{step.pace_target}</span></span>
        )}
        {step.hr_target && (
          <span><span style={{ color: 'var(--mute)' }}>HR</span>{' '}<span style={{ color: 'var(--ink)', fontWeight: 600 }}>{step.hr_target}</span></span>
        )}
      </div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 12.5, color: 'rgba(246,247,248,0.72)', lineHeight: 1.55 }}>
        {step.note}
      </div>

    </div>
  );
}

/** Repeat block — "REPEAT N×" header (no box) + a hard-effort box for the
 *  reps + an easy-effort box for the recovery. Replaces the single-card-with-
 *  dashed-divider that read as all one color. */
function RepeatBlock({ step }: { step: PrescriptionStep }) {
  if (!step.recovery || step.reps == null) return <StepCard step={step} />;

  // Volume label for the reps line ("4 × 1 mi" or similar)
  const repFmt = step.rep_distance_mi != null
    ? (step.rep_distance_mi < 1
        ? `${Math.round(step.rep_distance_mi * 1609)} m`
        : `${step.rep_distance_mi % 1 === 0 ? step.rep_distance_mi : step.rep_distance_mi.toFixed(1)} mi`)
    : (step.duration ?? '');
  const repsVolume = `${step.reps} × ${repFmt}`;

  // Race vs threshold/intervals — race gets race-orange, default gold.
  const isRace = step.label.toLowerCase().includes('race');
  const repsAccent = isRace ? 'var(--race)' : 'var(--goal)';

  return (
    <div style={{
      // Vertical breathing room around the whole REPEAT group so it reads as
      // a contained sub-section between warmup + cooldown.
      marginTop: 14, marginBottom: 14,
    }}>
      {/* Section header — floats above the boxes, no box around it */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        padding: '0 4px 10px', marginBottom: 2,
      }}>
        <div style={{
          fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--ink)',
          letterSpacing: '0.5px',
        }}>
          {step.label.toUpperCase()}
        </div>
        <div style={{
          fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)',
          letterSpacing: '1.2px', fontWeight: 700, textTransform: 'uppercase',
        }}>
          {repsVolume} + {step.recovery.duration} rest
        </div>
      </div>

      {/* Indented child group — rep + recovery boxes pulled in so they
          visually nest under the REPEAT header. */}
      <div style={{ marginLeft: 14, paddingLeft: 4, borderLeft: '1px dashed rgba(255,255,255,0.10)' }}>
      {/* Reps box — hard effort accent (gold/race-orange) */}
      <div style={{
        background: '#1f2226', borderRadius: 12, padding: '14px 18px',
        border: '1px solid rgba(255,255,255,0.05)',
        borderLeft: `3px solid ${repsAccent}`,
        marginBottom: 8,
        marginLeft: 6,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: repsAccent, letterSpacing: '1.4px', textTransform: 'uppercase' }}>
            REP · EACH
          </div>
          <div style={{ fontFamily: 'var(--f-label)', fontSize: 17, color: 'var(--ink)', letterSpacing: '0.3px' }}>
            {repFmt}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontFamily: 'var(--f-body)', fontSize: 12.5, marginBottom: 6 }}>
          {step.pace_target && (
            <span><span style={{ color: 'var(--mute)' }}>PACE</span>{' '}<span style={{ color: 'var(--ink)', fontWeight: 600 }}>{step.pace_target}</span></span>
          )}
          {step.hr_target && (
            <span><span style={{ color: 'var(--mute)' }}>HR</span>{' '}<span style={{ color: 'var(--ink)', fontWeight: 600 }}>{step.hr_target}</span></span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 12.5, color: 'rgba(246,247,248,0.72)', lineHeight: 1.55 }}>
          {step.note}
        </div>
      </div>

      {/* Recovery box — easy effort accent (purple) */}
      <div style={{
        background: '#1f2226', borderRadius: 12, padding: '14px 18px',
        border: '1px solid rgba(255,255,255,0.05)',
        borderLeft: '3px solid var(--learn)',
        marginLeft: 6,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--learn)', letterSpacing: '1.4px', textTransform: 'uppercase' }}>
            RECOVERY BETWEEN
          </div>
          <div style={{ fontFamily: 'var(--f-label)', fontSize: 17, color: 'var(--ink)', letterSpacing: '0.3px' }}>
            {step.recovery.duration}
          </div>
        </div>
        {step.recovery.pace_target && (
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 12.5, marginBottom: 6 }}>
            <span style={{ color: 'var(--mute)' }}>PACE</span>{' '}<span style={{ color: 'var(--ink)', fontWeight: 600 }}>{step.recovery.pace_target}</span>
          </div>
        )}
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 12.5, color: 'rgba(246,247,248,0.72)', lineHeight: 1.55 }}>
          {step.recovery.note}
        </div>
      </div>
      </div>{/* /indented child group */}
    </div>
  );
}

function RestBody() {
  return (
    <div style={{ padding: '8px 0 4px' }}>
      <p style={{ fontFamily: 'var(--f-body)', fontSize: 15, lineHeight: 1.6, color: 'rgba(246,247,248,0.85)', margin: '0 0 12px' }}>
        Rest is the work today. Sleep, mobility, recovery — the legs earned it.
      </p>
      <p style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', lineHeight: 1.55 }}>
        Skip the rest and you skip the adaptation. Glycogen restocks, micro-tears repair, the nervous system
        resets. A week of two hard days plus rest produces more fitness than a week of seven moderate days.
      </p>
    </div>
  );
}

function UnplannedBody({ day }: { day: GlanceWeekDay }) {
  return (
    <div style={{ padding: '8px 0 4px' }}>
      <p style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'var(--mute)', lineHeight: 1.55 }}>
        No plan for this day yet. {day.isPast ? "If you ran, log it manually from /today." : "When a plan is generated, the workout for this day will appear here."}
      </p>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function BigStat({ v, u, color }: { v: string; u: string; color: string }) {
  return (
    <div style={{ padding: '12px 14px', background: '#1f2226', borderRadius: 12 }}>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 30, color, lineHeight: 1 }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase', marginTop: 4 }}>{u}</div>
    </div>
  );
}
