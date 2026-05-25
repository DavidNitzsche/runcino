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
import { ProfileGapInput } from '@/components/profile/ProfileGapInput';

const GAP_FIELD_LABEL: Record<string, string> = {
  height_cm:        'Height',
  birthday:         'Birthday',
  lthr:             'LTHR (threshold HR)',
  hrmax_observed:   'Max HR',
  experience_level: 'Experience level',
  sex:              'Sex',
  city:             'City',
};

const GAP_FIELD_WHY: Record<string, string> = {
  height_cm:        'Unlocks cadence target (180 spm baseline)',
  birthday:         'Unlocks age-based recovery + heat adjustments',
  lthr:             'Primary HR-zone anchor (Friel method)',
  hrmax_observed:   'Refines zones if LTHR is unknown',
  experience_level: 'Caps weekly mileage to a safe ceiling',
};

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
  payload: { field: string; why: string };
}) {
  // Use the inline editor — David doesn't want to leave /today to add data.
  const label = GAP_FIELD_LABEL[payload.field] ?? payload.field;
  const why = GAP_FIELD_WHY[payload.field] ?? payload.why ?? '';
  return (
    <ProfileGapInput field={payload.field} label={label} why={why} />
  );
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
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 14, color: 'var(--ink)' }}>{item.label}</div>
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
