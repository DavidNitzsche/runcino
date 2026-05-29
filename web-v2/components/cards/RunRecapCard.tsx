import { RunDetailTrigger } from '@/components/runs/RunDetailModal';

/**
 * Renders the run_recap topic — distance / pace / time / chips, with coach_note.
 * §8.4 closed loop: tap "Splits · route · form data" → opens a MODAL on /today
 * (never leaves the page). Modal lazy-fetches /api/runs/[id].
 */
export function RunRecapCard({ payload, coach_note }: {
  payload: { activity_id?: string | null; distance_mi: number; pace: string | null; time_moving: string | null; hr: number | null; cadence: number | null; weather_chip: string | null };
  coach_note: string | null;
}) {
  return (
    <section style={{ padding: '8px 24px 18px' }}>
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 9, fontWeight: 700, color: 'var(--mute)',
        letterSpacing: '1.6px', textTransform: 'uppercase', marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span>YOUR RUN</span>
        <span style={{
          background: 'rgba(62,189,65,0.14)', color: 'var(--green)',
          padding: '3px 9px', borderRadius: 999, fontSize: 9, fontWeight: 800, letterSpacing: '1.2px',
        }}>COMPLETED</span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 14, marginBottom: 10,
      }}>
        <Stat value={Number(payload.distance_mi ?? 0).toFixed(1)} unit="miles" color="var(--dist)" />
        {payload.pace && <Stat value={String(payload.pace)} unit="avg pace" color="var(--green)" />}
        {payload.time_moving && <Stat value={String(payload.time_moving)} unit="moving" color="var(--ink)" />}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {payload.hr != null     && <Chip k="HR"  v={String(payload.hr)} />}
        {payload.cadence != null && <Chip k="CAD" v={String(payload.cadence)} />}
        {payload.weather_chip   && <Chip warm>{payload.weather_chip}</Chip>}
      </div>

      {coach_note && (
        <div className="coach-note" style={{ marginTop: 14 }}>
          {coach_note}
        </div>
      )}

      {/* §8.4 drill-down — modal on /today, never navigate away */}
      <RunDetailTrigger activityId={payload.activity_id} />
    </section>
  );
}

function Stat({ value, unit, color }: { value: string; unit: string; color: string }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--f-display)', fontSize: 56, fontWeight: 400, lineHeight: 0.95,
        letterSpacing: '0.5px', fontVariantNumeric: 'tabular-nums', color,
      }}>{value}</div>
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 600, color: 'var(--mute)',
        letterSpacing: '1.2px', textTransform: 'uppercase', marginTop: 4,
      }}>{unit}</div>
    </div>
  );
}

function Chip({ k, v, warm, children }: { k?: string; v?: string; warm?: boolean; children?: React.ReactNode }) {
  return (
    <span style={{
      background: warm ? 'rgba(243,173,56,0.08)' : 'var(--card-2)',
      border: warm ? '1px solid rgba(243,173,56,0.30)' : '1px solid var(--line)',
      borderRadius: 999, padding: '6px 11px', fontSize: 11, fontWeight: 500,
      color: warm ? 'var(--goal)' : 'var(--mute)',
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      {k && <span style={{ color: 'var(--mute)', fontSize: 9, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' }}>{k}</span>}
      {v && <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{v}</span>}
      {children}
    </span>
  );
}
