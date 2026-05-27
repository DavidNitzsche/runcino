import { TopNav } from '@/components/layout/TopNav';
import { ReadinessChipTrigger } from '@/components/readiness/ReadinessChipTrigger';
import { BriefingLoader } from '@/components/cards/BriefingLoader';
import { WeekStrip } from '@/components/today/WeekStrip';
import { RunDetailTrigger } from '@/components/runs/RunDetailModal';
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

  // Today cell — drives the hero headline + narrative + click target.
  const todayCell = glance?.today
    ? glance.weekDays.find((d) => d.date === glance.today)
    : null;
  const ran = (todayCell?.doneMi ?? 0) >= 0.5;
  const headline = heroHeadline(todayCell, glance?.daysToARace);
  const narrative = heroNarrative(todayCell, glance);
  const breadcrumb = heroBreadcrumb(glance);

  return (
    <main>
      <TopNav />

      <div style={{ padding: '40px 40px 8px', maxWidth: 1440, margin: '0 auto' }}>
        {/* Direction 4 hero — readiness ring left, breadcrumb + headline +
         *  narrative on the right. Drops the cheesy greeting. */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 40,
          alignItems: 'center', marginBottom: 28,
        }}>
          {/* LEFT — big readiness ring */}
          <div style={{
            paddingRight: 36, borderRight: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 196,
          }}>
            {glance?.readiness && (
              <ReadinessChipTrigger breakdown={glance.readiness} size="lg" />
            )}
          </div>

          {/* RIGHT — copy stack */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700,
              color: 'var(--mute)', letterSpacing: '1.5px',
              textTransform: 'uppercase',
            }}>
              {breadcrumb.before}
              {breadcrumb.race && (
                <>
                  {breadcrumb.before ? ' · ' : ''}
                  <span style={{ color: 'var(--race)' }}>{breadcrumb.race}</span>
                </>
              )}
            </div>

            {/* Big mileage headline — clickable when ran today (opens run modal) */}
            {ran && todayCell ? (
              <RunDetailTrigger
                activityId={todayCell.activityId ?? `${todayCell.date}-${todayCell.doneMi.toFixed(2)}`}
                label=""
                style={{
                  marginTop: 0, padding: 0,
                  textAlign: 'left', display: 'block',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  letterSpacing: 'normal',
                }}
              >
                <HeadlineMileage headline={headline} clickable />
              </RunDetailTrigger>
            ) : (
              <HeadlineMileage headline={headline} clickable={false} />
            )}

            {narrative && (
              <div style={{
                fontFamily: 'var(--f-body)', fontSize: 15, lineHeight: 1.55,
                color: 'rgba(246,247,248,0.85)', maxWidth: 540,
              }}>
                {narrative}
              </div>
            )}
          </div>
        </div>

        {/* Week strip — Direction E (color band over neutral card) */}
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
          {/* LEFT — coach voice (TodayPlannedCard's role is now in the hero) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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

          {/* RIGHT: cards rail loads async */}
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

// Right-rail cards — cards only, no coach voice.
function BriefingCardsOnly() {
  return <BriefingLoader surface="today" renderCoach={false} renderCards={true} />;
}

function MicroStat({ k, v, delta, color }: { k: string; v: string; delta: string; color: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontFamily: 'var(--f-label)', fontSize: 10, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase' }}>{k}</div>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color, lineHeight: 1, marginTop: 4 }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', marginTop: 4 }}>{delta}</div>
    </div>
  );
}

/** Big "7.6 MI DONE" headline. Optional click affordance hint when ran. */
function HeadlineMileage({ headline, clickable }: { headline: ReturnType<typeof heroHeadline>; clickable: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 14,
      lineHeight: 0.98,
    }}>
      <span style={{
        fontFamily: 'var(--f-display)', fontSize: 56, fontWeight: 800,
        color: headline.numColor, letterSpacing: '0.2px',
      }}>{headline.num}</span>
      {headline.post && (
        <span style={{
          fontFamily: 'var(--f-display)', fontSize: 28, fontWeight: 700,
          color: headline.postColor, letterSpacing: '0.3px',
        }}>{headline.post}</span>
      )}
      {clickable && (
        <span style={{
          marginLeft: 'auto',
          fontFamily: 'var(--f-label)', fontSize: 11, fontWeight: 700,
          color: 'var(--mute)', letterSpacing: '1.2px',
          alignSelf: 'center',
        }}>
          TAP FOR DETAILS →
        </span>
      )}
    </div>
  );
}

/** Build the breadcrumb pieces. Race chunk separated so it can render in race-orange. */
function heroBreadcrumb(glance: any): { before: string; race: string | null } {
  if (!glance) return { before: '', race: null };
  const before = [
    todayLabel(glance.today),
    glance.phaseLabel,
  ].filter(Boolean).join(' · ');
  const race = glance.daysToARace != null
    ? `${glance.daysToARace} DAYS TO ${(glance.nextARaceName ?? 'RACE').toUpperCase()}`
    : null;
  return { before, race };
}

/** Build the big mileage headline. State-aware. */
function heroHeadline(
  todayCell: any,
  daysToRace: number | null | undefined,
): { num: string; post: string; numColor: string; postColor: string } {
  if (daysToRace === 0) {
    return { num: 'RACE', post: 'DAY', numColor: 'var(--race)', postColor: 'var(--mute)' };
  }
  if (!todayCell) {
    return { num: '—', post: '', numColor: 'var(--dim)', postColor: 'var(--mute)' };
  }
  const ran = todayCell.doneMi >= 0.5;
  if (ran) {
    return {
      num: todayCell.doneMi.toFixed(todayCell.doneMi % 1 === 0 ? 0 : 1),
      post: 'MI · DONE',
      numColor: 'var(--green)',
      postColor: 'var(--mute)',
    };
  }
  if (todayCell.plannedType === 'rest' || todayCell.plannedMi === 0) {
    return { num: 'REST', post: 'DAY', numColor: 'var(--rest)', postColor: 'var(--mute)' };
  }
  // Pre-run, planned
  const t = (todayCell.plannedType ?? '').toUpperCase();
  return {
    num: todayCell.plannedMi.toFixed(todayCell.plannedMi % 1 === 0 ? 0 : 1),
    post: `MI · ${t}`,
    numColor: 'var(--ink)',
    postColor: 'var(--mute)',
  };
}

/** Build the one-line plain-English coach summary that sits under the headline.
 *  Deterministic — no LLM. Sources from glance state only. */
function heroNarrative(todayCell: any, glance: any): string {
  if (!todayCell || !glance) return '';
  const ran = todayCell.doneMi >= 0.5;
  const ptype = (todayCell.plannedType ?? '').toLowerCase();

  // Tomorrow's plan for "tomorrow's X" cue
  const tomorrowCell = nextWorkout(glance.weekDays, todayCell.date);

  if (glance.daysToARace === 0) {
    return `Race day. Run the plan, trust the work.`;
  }
  if (glance.daysToARace === 1) {
    return `Light shake-out and early to bed — race goes tomorrow.`;
  }

  if (ran) {
    const banked = isQuality(ptype) ? 'Threshold banked'
      : ptype === 'long'   ? 'Long banked'
      : ptype === 'tempo'  ? 'Tempo banked'
      : ptype === 'race'   ? 'Race in the books'
      : ptype === 'easy'   ? 'Easy in the bank'
      : 'Run in the books';
    const next = tomorrowCell ? ` Tomorrow's ${describeWorkout(tomorrowCell)}.` : '';
    return `${banked}.${next}`;
  }
  if (ptype === 'rest') {
    return `Sleep, mobility, recovery. The legs earned it.`;
  }
  // Pre-run, planned
  const cue = isQuality(ptype) ? 'Lock the target pace. Form holds, splits hold.'
    : ptype === 'long'   ? 'Keep it aerobic. Fuel by 45 minutes.'
    : ptype === 'tempo'  ? 'Sustained, controlled — find the line and ride it.'
    : ptype === 'race'   ? 'Trust the plan. Hold back early, spend it late.'
    : ptype === 'easy'   ? 'Conversational. If you can\'t chat, you\'re going too hard.'
    : '';
  return cue;
}

function isQuality(ptype: string): boolean {
  return ['threshold', 'intervals', 'vo2max'].includes(ptype);
}

function nextWorkout(weekDays: any[], today: string): any | null {
  const idx = weekDays.findIndex((d) => d.date === today);
  if (idx < 0 || idx + 1 >= weekDays.length) return null;
  return weekDays[idx + 1];
}

function describeWorkout(cell: any): string {
  const mi = cell.plannedMi?.toFixed(cell.plannedMi % 1 === 0 ? 0 : 1) ?? '?';
  const t = (cell.plannedType ?? '').toLowerCase();
  if (t === 'rest') return 'rest day';
  if (t === 'easy' || t === 'shakeout') return `${mi}mi easy is a recovery shake-out`;
  if (t === 'long') return `${mi}mi long run`;
  if (isQuality(t)) return `${mi}mi quality session`;
  if (t === 'race') return 'race day';
  return `${mi}mi ${t}`;
}

function todayLabel(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${days[d.getUTCDay()]} · ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
