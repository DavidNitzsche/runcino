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
import { RunDetailTrigger } from '@/components/runs/RunDetailModal';

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

interface Props { day: GlanceWeekDay; onClose: () => void }

export function DayDetailModal({ day, onClose }: Props) {
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const ran = day.doneMi >= 0.5;
  const isRest = day.plannedType === 'rest';
  const isUnplanned = day.plannedType === 'unplanned' || (day.plannedMi === 0 && !isRest);

  // If past + ran, fetch detail to show splits + HR zone summary inline.
  useEffect(() => {
    if (!ran || !day.activityId) return;
    let mounted = true;
    fetch(`/api/runs/${encodeURIComponent(day.activityId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (mounted && d) setRunDetail(d); })
      .catch(() => {});
    return () => { mounted = false; };
  }, [ran, day.activityId]);

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
        {!ran && !isRest && !isUnplanned && <PlannedWorkoutBody day={day} typeColor={typeColor} />}
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
        <RunDetailTrigger activityId={day.activityId} label="Splits · route · form data →" />
      )}
    </>
  );
}

function PlannedWorkoutBody({ day, typeColor }: { day: GlanceWeekDay; typeColor: string }) {
  const t = day.plannedType;
  const target = targetFor(t);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14 }}>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 72, color: typeColor, lineHeight: 1, letterSpacing: '0.5px' }}>
          {day.plannedMi.toFixed(day.plannedMi % 1 === 0 ? 0 : 1)}
        </span>
        <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>MI</span>
      </div>

      <div className="card" style={{ background: '#1f2226', padding: '16px 18px', marginBottom: 12 }}>
        <div className="card-eyebrow" style={{ color: typeColor }}>TARGET</div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'rgba(246,247,248,0.90)', lineHeight: 1.6, marginTop: 6 }}>
          {target}
        </div>
      </div>

      <div className="card" style={{ background: '#1f2226', padding: '16px 18px', marginBottom: 12 }}>
        <div className="card-eyebrow" style={{ color: 'var(--mute)' }}>EXECUTION NOTES</div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 13.5, color: 'rgba(246,247,248,0.80)', lineHeight: 1.6, marginTop: 6 }}>
          {notesFor(t)}
        </div>
      </div>

      {day.isToday && (
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', marginTop: 12, fontStyle: 'italic' }}>
          The run will appear here once the watch syncs it back.
        </div>
      )}
    </>
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

function targetFor(t: string): string {
  switch (t) {
    case 'easy':       return 'Easy aerobic — HR in Z1-Z2 (true conversational, you should be able to speak in full sentences). 9:00/mi-ish, drift up in heat is normal.';
    case 'long':       return 'Long aerobic — HR mostly Z2 with late drift into low Z3. Steady, no surges. Fuel ~45 min in and every 30 after.';
    case 'tempo':      return 'Tempo — sub-threshold steady, just below the line where breathing becomes labored. Marathon pace or a hair faster.';
    case 'threshold':  return 'Threshold reps — at LTHR, comfortably hard, controlled. 3×1mi at T-pace with 2:00 jog recoveries is the canonical version.';
    case 'intervals':  return 'Intervals — at or above LTHR, race-finish effort. 6×800m at I-pace with 90s jog recoveries; even splits from start to finish.';
    case 'shakeout':   return '2 mi easy plus 4×20s strides. Loosen the legs, fire the system, then go rest.';
    case 'race':       return 'Race day. Execute the plan. Negative-split if possible — go out controlled, finish strong.';
    default:           return 'See plan for target pace + HR zone.';
  }
}

function notesFor(t: string): string {
  switch (t) {
    case 'easy':       return 'The discipline is keeping it easy. Most runners run their easy runs too hard — that\'s the "gray zone" trap that leaves you flat for the workouts that matter. Cap effort, hold form, walk if you have to.';
    case 'long':       return 'Time on feet > pace. Build the engine. Drift in pace late is fine and expected; drift in form is not.';
    case 'tempo':      return 'Warm up 1.5mi easy, build into target, hold steady, cool down 1mi. Even effort across the rep, not the first half faster than the second.';
    case 'threshold':  return 'Warm up 1.5mi. Reps at T-pace (your engine\'s ceiling). Recoveries are honest jogs, not standing. Cool down 1mi.';
    case 'intervals':  return 'Warm up 1.5mi + 4×20s strides. Hit even splits — rep 6 should match rep 1. Slowing means the pace was too aggressive; drop 2-3s/lap and finish clean.';
    case 'shakeout':   return 'Day-before-race ritual. Don\'t skip strides — they fire the neuromuscular system without taxing it. Keep total time under 25 minutes.';
    case 'race':       return 'Hold the plan in the first 5K. Pacing decisions made in the first mile cost you in the last 10K.';
    default:           return '';
  }
}

function BigStat({ v, u, color }: { v: string; u: string; color: string }) {
  return (
    <div style={{ padding: '12px 14px', background: '#1f2226', borderRadius: 12 }}>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 30, color, lineHeight: 1 }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase', marginTop: 4 }}>{u}</div>
    </div>
  );
}
