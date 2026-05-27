import { TopNav } from '@/components/layout/TopNav';
import { ReadinessChipTrigger } from '@/components/readiness/ReadinessChipTrigger';
import { BriefingLoader } from '@/components/cards/BriefingLoader';
import { WeekStrip } from '@/components/today/WeekStrip';
import { TodayPlannedCard } from '@/components/today/TodayPlannedCard';
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
        {/* Greeting + readiness — uses glance state, no LLM needed.
         * #165: state-aware greeting in Faff coach voice — drops the
         * cold "Night, David." pattern for messages that actually know
         * what's happening today. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 32, alignItems: 'end', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 64, lineHeight: 1, margin: 0, letterSpacing: '0.5px' }}>
              {(() => {
                const g = greetingFor(glance);
                return (
                  <>
                    {g.lead}{g.lead ? ' ' : ''}
                    <span style={{ color: 'var(--green)' }}>{g.name}{g.terminal}</span>
                  </>
                );
              })()}
            </h1>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 10 }}>
              {todayLabel(glance?.today)}
              {glance?.phaseLabel ? ` · ${glance.phaseLabel}` : ''}
              {glance?.daysToARace != null ? ` · ${glance.daysToARace} DAYS TO ${glance.nextARaceName?.toUpperCase() ?? 'RACE'}` : ''}
            </div>
          </div>
          {glance?.readiness && (
            <ReadinessChipTrigger breakdown={glance.readiness} />
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
          {/* LEFT: today's planned/done card renders INSTANTLY from glance,
              then coach voice loads async beneath it */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {glance?.weekDays && (
              <TodayPlannedCard today={glance.today} weekDays={glance.weekDays} />
            )}
            <div style={{
              background: 'linear-gradient(180deg, rgba(62,189,65,0.04), rgba(62,189,65,0) 60%)',
              border: '1px solid var(--line)',
              borderRadius: 22,
              padding: '12px 12px',
              minHeight: 280,
            }}>
              <BriefingLoader surface="today" renderCards={false} />
            </div>
          </div>

          {/* RIGHT: cards rail loads async — only the coach's emitted topics
              (not the today-card duplicate) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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

// Right-rail cards — cards only, no coach voice (that lives in the left column).
// Shares the in-flight fetch w/ the left column via BriefingLoader's module-level
// cache, so it's ONE network call.
function BriefingCardsOnly() {
  return <BriefingLoader surface="today" renderCoach={false} renderCards={true} />;
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

/**
 * #165 state-aware greeting. Reads glance to decide what to say.
 * Returns three pieces:
 *   lead   — the coach-voice opener ("Nice."), can be empty for name-only
 *   name   — the runner's name (highlighted green by the caller)
 *   terminal — punctuation after the name ("." or "?" or ", today.")
 *
 * Priority (top match wins):
 *   1. race day (days=0)
 *   2. race tomorrow (days=1)
 *   3. race week (≤7 days)
 *   4. ran today
 *   5. rest day on the plan
 *   6. quality day (threshold/tempo/intervals)
 *   7. long run day
 *   8. easy day
 *   9. late night fallback
 */
function greetingFor(glance: any): { lead: string; name: string; terminal: string } {
  const name = glance?.greetingName ?? 'David';
  const today = glance?.today as string | undefined;
  const days  = glance?.daysToARace as number | null | undefined;
  const todayCell = today ? (glance?.weekDays ?? []).find((d: any) => d.date === today) : null;
  const ran = todayCell?.doneMi >= 0.5;
  const ptype = (todayCell?.plannedType ?? '') as string;
  const isQuality = ['threshold', 'tempo', 'intervals', 'vo2max'].includes(ptype);
  const isLong = ptype === 'long';
  const isRest = ptype === 'rest';

  // 1. Race day
  if (days === 0) {
    return { lead: "Today's the day,", name, terminal: '.' };
  }
  // 2. Tomorrow
  if (days === 1) {
    return { lead: 'Tomorrow,', name, terminal: '.' };
  }
  // 3. Race week
  if (days != null && days >= 2 && days <= 7) {
    return { lead: 'Race week,', name, terminal: '.' };
  }
  // 4. Ran today — the legs spoke first
  if (ran) {
    const sayings = ['Nice work,', 'Banked.', 'Got it done,', "That's the work,"];
    const idx = (today ?? '').split('-').reduce((a, x) => a + Number(x || 0), 0) % sayings.length;
    return { lead: sayings[idx], name, terminal: '.' };
  }
  // 5. Rest day
  if (isRest) {
    return { lead: 'Rest day,', name, terminal: '.' };
  }
  // 6. Quality day
  if (isQuality) {
    return { lead: 'Big one,', name, terminal: '.' };
  }
  // 7. Long run day
  if (isLong) {
    return { lead: 'Long run,', name, terminal: '.' };
  }
  // 8. Easy day with miles
  if (ptype === 'easy' || ptype === 'shakeout') {
    return { lead: 'Easy day,', name, terminal: '.' };
  }
  // 9. Late-night fallback (no plan match)
  const h = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
  }).format(new Date()), 10);
  if (h < 5)  return { lead: 'Up late,', name, terminal: '.' };
  if (h >= 21) return { lead: 'Wrapping up,', name, terminal: '.' };
  // Daylight, no plan cue — keep it minimal, no fake cheer.
  return { lead: '', name, terminal: '.' };
}
