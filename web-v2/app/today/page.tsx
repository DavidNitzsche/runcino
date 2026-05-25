import { TopNav } from '@/components/layout/TopNav';
import { ReadinessChipTrigger } from '@/components/readiness/ReadinessChipTrigger';
import { BriefingLoader } from '@/components/cards/BriefingLoader';
import { WeekStrip } from '@/components/today/WeekStrip';
import { loadGlanceState } from '@/lib/coach/glance-state';

// Glance state is a handful of fast pg queries — page renders in ~200ms.
// The LLM-backed coach voice loads asynchronously via <BriefingLoader />.
export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function TodayPage() {
  let glance: Awaited<ReturnType<typeof loadGlanceState>> | null = null;
  let glanceError: string | null = null;
  try {
    glance = await loadGlanceState(DAVID_USER_ID);
  } catch (e: any) {
    glanceError = e?.message ?? String(e);
  }

  return (
    <main>
      <TopNav />

      <div style={{ padding: '40px 40px 8px', maxWidth: 1440, margin: '0 auto' }}>
        {/* Greeting + readiness — uses glance state, no LLM needed */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 32, alignItems: 'end', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 64, lineHeight: 1, margin: 0, letterSpacing: '0.5px' }}>
              Morning, <span style={{ color: 'var(--green)' }}>{glance?.greetingName ?? 'David'}.</span>
            </h1>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 10 }}>
              {todayLabel(glance?.today)}
              {glance?.phaseLabel ? ` · ${glance.phaseLabel}` : ''}
              {glance?.daysToARace != null ? ` · ${glance.daysToARace} DAYS TO ${glance.nextARaceName?.toUpperCase() ?? 'RACE'}` : ''}
            </div>
          </div>
          {glance?.readiness && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div>
                <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase' }}>READINESS</div>
                <div style={{ fontFamily: 'var(--f-display)', fontSize: 20, color: 'var(--ink)', marginTop: 2 }}>{glance.readiness.label}</div>
              </div>
              <ReadinessChipTrigger breakdown={glance.readiness} />
            </div>
          )}
        </div>

        {/* Week strip — past days w/ a run click through to /runs/[id] */}
        {glance?.weekDays && glance.weekDays.length > 0 && (
          <div style={{ marginBottom: 24, marginLeft: -24, marginRight: -24 }}>
            <WeekStrip
              days={glance.weekDays}
              weekDone={glance.weekDone}
              weekPlanned={glance.weekPlanned}
              phaseLabel={glance.phaseLabel}
            />
          </div>
        )}
      </div>

      {/* Two-column desktop / single column mobile. Coach voice loads async. */}
      <div style={{ padding: '0 40px 80px', maxWidth: 1440, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 32 }} className="today-grid">
          <div style={{
            background: 'linear-gradient(180deg, rgba(62,189,65,0.04), rgba(62,189,65,0) 60%)',
            border: '1px solid var(--line)',
            borderRadius: 22,
            padding: '12px 12px',
            minHeight: 360,
          }}>
            <BriefingLoader surface="today" renderCards={false} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Cards rail loads in the same loader (renderCards=true on this side) */}
            <BriefingCardsOnly />
          </div>
        </div>

        {glance && (
          <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <MicroStat k="SLEEP · 7N" v={glance.sleep7Avg != null ? `${glance.sleep7Avg.toFixed(1)}h` : '—'}
                       delta={glance.sleep7Avg != null && glance.sleep7Avg < 7.5 ? `−${(7.5 - glance.sleep7Avg).toFixed(1)} vs target` : 'at target'}
                       color={glance.sleep7Avg != null && glance.sleep7Avg < 7.5 ? 'var(--goal)' : 'var(--green)'} />
            <MicroStat k="RHR"
                       v={glance.rhrCurrent != null ? `${glance.rhrCurrent}` : '—'}
                       delta={glance.rhrCurrent != null && glance.rhrBaseline != null ? `${glance.rhrCurrent - glance.rhrBaseline >= 0 ? '+' : ''}${glance.rhrCurrent - glance.rhrBaseline} vs baseline` : ''}
                       color={glance.rhrCurrent != null && glance.rhrBaseline != null && (glance.rhrCurrent - glance.rhrBaseline) >= 5 ? 'var(--over)' : 'var(--green)'} />
            <MicroStat k="CADENCE · 60D" v={glance.cadenceBaseline != null ? `${glance.cadenceBaseline} spm` : '—'} delta="60d baseline" color="var(--green)" />
            <MicroStat k="WEEK MI"       v={glance.weekDone != null && glance.weekPlanned != null ? `${glance.weekDone} / ${glance.weekPlanned}` : '—'} delta="this week" color="var(--rest)" />
          </div>
        )}

        {glanceError && (
          <div className="card" style={{ marginTop: 24, padding: 18, background: 'rgba(252,77,100,0.04)', borderColor: 'rgba(252,77,100,0.22)' }}>
            <div className="card-eyebrow" style={{ color: 'var(--over)' }}>GLANCE DATA ERROR</div>
            <pre style={{ fontSize: 11, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{glanceError}</pre>
          </div>
        )}
      </div>

      {/* Mobile single-column overrides */}
      <style>{`
        @media (max-width: 1099px) {
          .today-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}

// Renders the cards rail (right column) — loaded from the same briefing
// endpoint but only the topics are displayed here. CoachBlock skipped.
function BriefingCardsOnly() {
  // Just reuse BriefingLoader and ask it to NOT render the coach block.
  // It will fetch /api/briefing once and React's dedupe means we don't pay
  // twice (Next caches the fetch in the same render tree). But here we're
  // in two separate client component trees so we'd fetch twice. Accept
  // the duplicate for now — solve with SWR or context in P8.
  return <BriefingLoader surface="today" renderCards={true} />;
}

function MicroStat({ k, v, delta, color }: { k: string; v: string; delta: string; color: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase' }}>{k}</div>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color, lineHeight: 1, marginTop: 4 }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', marginTop: 4 }}>{delta}</div>
    </div>
  );
}

function todayLabel(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${days[d.getUTCDay()]} · ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
