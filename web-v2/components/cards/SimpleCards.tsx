/**
 * Compact card renderers for the topic kinds that share a similar shape:
 *   - NextWorkoutCard   (rest/blue, distance-on-right)
 *   - RaceHorizonCard   (race/orange, countdown-on-right)
 *   - ProfileGapCard    (over/red, +Add button)
 *   - SleepDeficitCard  (goal/amber, big hours + bars)
 *   - WatchListCard     (goal/amber, list of items)
 *   - FunFactCard       (learn/purple, explainer + research link)
 */

import Link from 'next/link';
import { InlineGapEditor } from '@/components/profile/InlineGapEditor';

export function NextWorkoutCard({ payload, coach_note }: {
  payload: { dow?: string; type?: string; label?: string | null; mi?: number };
  coach_note: string | null;
}) {
  const dow = String(payload?.dow ?? 'TOMORROW').toUpperCase();
  const label = String(payload?.label || payload?.type || 'EASY').toUpperCase();
  const mi = Number(payload?.mi ?? 0);
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: 'var(--rest)' }}>UP NEXT · {dow}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 18, alignItems: 'center', marginTop: 4 }}>
        <div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--ink)', letterSpacing: '0.8px', lineHeight: 1 }}>
            {label}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, color: 'var(--rest)' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 60, lineHeight: 0.95, letterSpacing: '0.5px' }}>{mi.toFixed(1)}</span>
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>MI</span>
        </div>
      </div>
      {coach_note && <div className="coach-note">{coach_note}</div>}
    </div>
  );
}

export function RaceHorizonCard({ payload, coach_note }: {
  payload: { race_name?: string; race_date?: string; days_to_race?: number; tone?: string; goal?: string | null };
  coach_note: string | null;
}) {
  const TONE_LABEL: Record<string, string> = { building: 'BUILDING', sharpening: 'SHARPENING', race_week: 'RACE WEEK' };
  const name = String(payload?.race_name ?? 'NEXT RACE');
  const date = payload?.race_date ?? '';
  const days = Number(payload?.days_to_race ?? 0);
  const tone = String(payload?.tone ?? 'building');
  const goal = payload?.goal ?? null;
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: 'var(--race)' }}>
        RACE · {TONE_LABEL[tone] ?? 'BUILDING'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 18, alignItems: 'center', marginTop: 4 }}>
        <div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1.1 }}>
            {name}
          </div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 600, color: 'var(--mute)', letterSpacing: '0.5px', marginTop: 4 }}>
            {date}{goal ? ` · GOAL ${goal}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, color: 'var(--race)' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 56, lineHeight: 0.95, letterSpacing: '0.5px' }}>{days}</span>
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>DAYS</span>
        </div>
      </div>
      {coach_note && <div className="coach-note">{coach_note}</div>}
    </div>
  );
}

export function ProfileGapCard({ payload }: {
  payload: { field?: string; why?: string };
}) {
  // Inline editor — David doesn't want to leave /today to add data.
  // Defensive: if the LLM emits a malformed payload (missing/empty field),
  // InlineGapEditor falls back to a quiet "edit in profile" link.
  const field = (payload?.field ?? '').trim();
  if (!field) {
    // Nothing actionable. Drop the card silently rather than render junk.
    return null;
  }
  return <InlineGapEditor field={field} fallbackWhy={payload?.why ?? null} />;
}

export function SleepDeficitCard({ payload, coach_note }: {
  payload: { avg_h_7n?: number; deficit_h_7n?: number; last_night_h?: number | null; direction?: string };
  coach_note: string | null;
}) {
  const avg7 = Number(payload?.avg_h_7n ?? 0);
  const def7 = Number(payload?.deficit_h_7n ?? 0);
  const last = payload?.last_night_h != null ? Number(payload.last_night_h) : null;
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: 'var(--goal)' }}>SLEEP · LAST 7 NIGHTS</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, margin: '4px 0 12px' }}>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 48, fontWeight: 400, color: 'var(--goal)', letterSpacing: '0.5px', lineHeight: 1 }}>
          {avg7.toFixed(1)}h
        </span>
        <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 600, color: 'var(--mute)', letterSpacing: '0.5px' }}>
          7-NIGHT AVG
          {last != null && <> · last night <span style={{ color: 'var(--ink)', fontWeight: 700 }}>{last.toFixed(1)}h</span></>}
        </span>
      </div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 11.5, color: 'var(--mute)', marginTop: 6 }}>
        About <span style={{ color: 'var(--goal)', fontWeight: 600 }}>{def7.toFixed(1)}h of sleep debt</span> this week.
      </div>
      {coach_note && <div className="coach-note">{coach_note}</div>}
    </div>
  );
}

export function WatchListCard({ payload }: {
  payload: { items: { label: string; status: string; note: string }[] };
}) {
  return (
    <div className="card" style={{ borderColor: 'rgba(243,173,56,0.25)', background: 'rgba(243,173,56,0.04)' }}>
      <div className="card-eyebrow" style={{ color: 'var(--goal)' }}>
        WATCH LIST · {payload.items.length} {payload.items.length === 1 ? 'ITEM' : 'ITEMS'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
        {payload.items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: item.status === 'red' ? 'var(--over)' : 'var(--goal)',
              marginTop: 6, flexShrink: 0,
            }} />
            <div>
              <div style={{ fontFamily: 'var(--f-label)', fontSize: 14, color: 'var(--ink)' }}>{item.label}</div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 11.5, color: 'var(--mute)', lineHeight: 1.55, marginTop: 2 }}>
                {item.note}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FunFactCard({ payload }: {
  payload: { term: string; body: string; link_slug: string };
}) {
  return (
    <div className="card" style={{ background: 'rgba(176,132,255,0.04)', border: '1px solid rgba(176,132,255,0.18)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 18, height: 18, borderRadius: '50%', background: 'var(--learn)',
          color: '#1a0f33', fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>ⓘ</div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--learn)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>
          {payload.term}
        </div>
      </div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, lineHeight: 1.55, color: 'rgba(246,247,248,0.82)', margin: '4px 0 8px' }}>
        {payload.body}
      </div>
      <Link href={`/learn/${payload.link_slug}`} style={{
        fontFamily: 'var(--f-body)', fontSize: 10.5, fontWeight: 600, color: 'var(--learn)',
        letterSpacing: '0.5px',
      }}>
        Read the research →
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// P-RIGHT-RAIL-TOPICS 2026-05-27 — new cards so the right rail can
// surface a tile for everything the coach mentions in voice.
// ─────────────────────────────────────────────────────────────────────

export function NiggleCard({ payload, coach_note }: {
  payload: { body_part: string; severity: 'mild' | 'moderate' | 'flare' | null; description: string; days_ago: number };
  coach_note: string | null;
}) {
  const sevColor = payload.severity === 'flare' ? 'var(--over)'
    : payload.severity === 'moderate' ? 'var(--goal)'
    : 'var(--mute)';
  const when = payload.days_ago === 0 ? 'today'
    : payload.days_ago === 1 ? 'yesterday'
    : `${payload.days_ago}d ago`;
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: 'var(--over)' }}>
        WATCHING · {payload.body_part.toUpperCase()}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)', letterSpacing: '0.4px' }}>
          {payload.severity ? payload.severity.toUpperCase() : 'FLAGGED'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--mute)', letterSpacing: '0.5px' }}>· {when}</span>
      </div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'rgba(246,247,248,0.75)', lineHeight: 1.5, marginTop: 6, fontStyle: 'italic' }}>
        "{payload.description}"
      </div>
      <div style={{ marginTop: 10, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ height: '100%', width: payload.severity === 'flare' ? '100%' : payload.severity === 'moderate' ? '60%' : '30%', background: sevColor, borderRadius: 2 }} />
      </div>
      {coach_note && <div className="coach-note">{coach_note}</div>}
    </div>
  );
}

export function LoadRampCard({ payload, coach_note }: {
  payload: { acwr: number; acute_mi_per_day: number; chronic_mi_per_day: number; band: 'detraining' | 'building' | 'sweet_spot' | 'elevated' | 'spike' };
  coach_note: string | null;
}) {
  const BAND_LABEL: Record<string, string> = {
    detraining: 'DETRAINING',
    building:   'BUILDING',
    sweet_spot: 'SWEET SPOT',
    elevated:   'ELEVATED',
    spike:      'SPIKE',
  };
  const BAND_COLOR: Record<string, string> = {
    detraining: 'var(--rest)',
    building:   'var(--green)',
    sweet_spot: 'var(--green)',
    elevated:   'var(--goal)',
    spike:      'var(--over)',
  };
  const bandColor = BAND_COLOR[payload.band] ?? 'var(--mute)';
  // Marker position on a 0–2.0 ratio scale.
  const markerPct = Math.max(0, Math.min(100, (payload.acwr / 2) * 100));
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: bandColor }}>
        LOAD · {BAND_LABEL[payload.band]}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 32, color: bandColor, letterSpacing: '0.4px', lineHeight: 1 }}>
          {payload.acwr.toFixed(2)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--mute)', letterSpacing: '0.5px' }}>ACWR</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--mute)', marginTop: 4, letterSpacing: '0.3px' }}>
        acute {payload.acute_mi_per_day.toFixed(1)} · chronic {payload.chronic_mi_per_day.toFixed(1)} mi/day
      </div>
      <div style={{ marginTop: 12, position: 'relative', height: 22 }}>
        {/* Scale track 0–2 */}
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 10, height: 3, borderRadius: 2,
          background: 'linear-gradient(90deg, rgba(0,143,236,0.30) 0%, rgba(62,189,65,0.5) 40%, rgba(62,189,65,0.5) 65%, rgba(243,173,56,0.55) 75%, rgba(252,77,100,0.6) 100%)',
        }}/>
        {/* Spike line marker at 1.5 */}
        <div style={{ position: 'absolute', left: '75%', top: 6, width: 1, height: 11, background: 'rgba(255,255,255,0.4)' }}/>
        <div style={{ position: 'absolute', left: '75%', top: 18, transform: 'translateX(-50%)', fontSize: 8, color: 'rgba(255,255,255,0.55)', fontWeight: 700, letterSpacing: '0.4px' }}>1.5</div>
        {/* You marker */}
        <div style={{ position: 'absolute', left: `${markerPct}%`, top: 5, transform: 'translateX(-50%)', width: 5, height: 13, background: bandColor, borderRadius: 2, boxShadow: `0 0 0 2px ${bandColor}30` }}/>
      </div>
      {coach_note && <div className="coach-note">{coach_note}</div>}
    </div>
  );
}

export function WeeklyVolumeCard({ payload, coach_note }: {
  payload: { done_mi: number; projected_mi: number; planned_mi: number; phase_label: string | null };
  coach_note: string | null;
}) {
  const overPlanBy = Math.round((payload.projected_mi - payload.planned_mi) * 10) / 10;
  const ahead = overPlanBy >= 3;
  const behind = overPlanBy <= -3;
  const accent = ahead ? 'var(--goal)' : behind ? 'var(--mute)' : 'var(--green)';
  const donePct = payload.projected_mi > 0
    ? Math.min(100, (payload.done_mi / payload.projected_mi) * 100)
    : 0;
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: accent }}>
        THIS WEEK{payload.phase_label ? ` · ${payload.phase_label.toUpperCase()}` : ''}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 32, color: 'var(--ink)', letterSpacing: '0.4px', lineHeight: 1 }}>
          {payload.done_mi.toFixed(1)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--mute)' }}>/ {payload.projected_mi.toFixed(1)} mi</span>
      </div>
      <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${donePct}%`, background: accent }}/>
      </div>
      {ahead && (
        <div style={{ fontSize: 11, color: 'var(--goal)', marginTop: 6, letterSpacing: '0.3px' }}>
          +{overPlanBy.toFixed(1)} mi above the {payload.planned_mi.toFixed(1)} planned
        </div>
      )}
      {behind && (
        <div style={{ fontSize: 11, color: 'var(--mute)', marginTop: 6, letterSpacing: '0.3px' }}>
          {overPlanBy.toFixed(1)} mi under the {payload.planned_mi.toFixed(1)} planned
        </div>
      )}
      {coach_note && <div className="coach-note">{coach_note}</div>}
    </div>
  );
}

export function LongRunHorizonCard({ payload, coach_note }: {
  payload: { date: string; dow: string; mi: number; label: string | null; days_away: number };
  coach_note: string | null;
}) {
  const when = payload.days_away === 0 ? 'TODAY'
    : payload.days_away === 1 ? 'TOMORROW'
    : `IN ${payload.days_away} DAYS`;
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: 'var(--dist)' }}>
        LONG RUN · {payload.dow.toUpperCase()} · {when}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 18, alignItems: 'center', marginTop: 4 }}>
        <div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1.1 }}>
            {payload.label ? payload.label.toUpperCase() : 'LONG'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, color: 'var(--dist)' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 60, lineHeight: 0.95, letterSpacing: '0.5px' }}>{payload.mi.toFixed(1)}</span>
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>MI</span>
        </div>
      </div>
      {coach_note && <div className="coach-note">{coach_note}</div>}
    </div>
  );
}
