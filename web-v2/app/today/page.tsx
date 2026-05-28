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

  // Today cell drives the hero coach hit.
  const todayCell = glance?.today
    ? glance.weekDays.find((d) => d.date === glance.today)
    : null;
  const hit = heroCoachHit(todayCell, glance);
  const breadcrumb = heroBreadcrumb(glance);

  return (
    <main>
      <TopNav />

      <div style={{ padding: '40px 40px 8px', maxWidth: 1440, margin: '0 auto' }}>
        {/* v3 Direction D — readiness ring on the left, breadcrumb + a real
         *  2-line coach hit promoted to hero status. No workout-name headline
         *  (that lives in the week-strip today tile below). */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 28,
          alignItems: 'center', marginBottom: 28,
        }}>
          {/* LEFT — big readiness ring */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 156,
          }}>
            {glance?.readiness && (
              <ReadinessChipTrigger breakdown={glance.readiness} size="lg" />
            )}
          </div>

          {/* RIGHT — breadcrumb + the coach hit */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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

            {/* The hit. Lower-case prose, brand-voice. ~22-24px, two lines. */}
            <div style={{
              fontFamily: 'var(--f-body)', fontSize: 22, lineHeight: 1.4,
              fontWeight: 500, color: 'var(--ink)',
              maxWidth: 720,
            }}>
              {hit}
            </div>
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

          {/* RIGHT: today's workout / run. Self-aware: if ran → DoneRunBar
              (link to run modal). If rest → rest acknowledgement. Else →
              TodayPlannedCard with the planned workout details. 2026-05-27:
              swapped from <BriefingCardsOnly /> (LLM topic cards, always
              empty under the deterministic path) — David: "lets just make
              a fucking TODAY dashboard page that knows wtf is going on." */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {glance?.weekDays && glance.today && (
              <TodayPlannedCard today={glance.today} weekDays={glance.weekDays} />
            )}
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

function MicroStat({ k, v, delta, color }: { k: string; v: string; delta: string; color: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontFamily: 'var(--f-label)', fontSize: 10, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase' }}>{k}</div>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color, lineHeight: 1, marginTop: 4 }}>{v}</div>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', marginTop: 4 }}>{delta}</div>
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

/**
 * heroCoachHit (#178) — the two-line coach voice that lives in the
 * /today hero. Deterministic, sourced from glance state. No LLM call,
 * no em-dashes, brand-voice. Picks one of many templates based on the
 * day's state; daily rotation gives variety without feeling random.
 *
 * Priority (top match wins):
 *   1. race day (days=0) / tomorrow (days=1) / race week (≤7d)
 *   2. ran today (by type)
 *   3. pre-run (by type)
 *   4. rest day
 */
function heroCoachHit(todayCell: any, glance: any): string {
  if (!todayCell || !glance) return 'Welcome back. Open a workout or check in to get started.';

  const ran = todayCell.doneMi >= 0.5;
  const ptype = String(todayCell.plannedType ?? '').toLowerCase();
  const days = glance.daysToARace as number | null | undefined;
  const raceName = glance.nextARaceName ?? 'the race';
  const tomorrow = nextWorkout(glance.weekDays, todayCell.date);
  const tDesc = tomorrow ? describeWorkout(tomorrow) : null;

  // Pick a deterministic-but-rotating index from today's date so the
  // same day gives the same hit; different days rotate variants.
  const dateSeed = (todayCell.date ?? '').split('-').reduce((a: number, x: string) => a + Number(x || 0), 0);
  const pick = <T,>(arr: T[]): T => arr[dateSeed % arr.length];

  // 1. RACE STATES
  if (days === 0) {
    return pick([
      `Today is the day. Run the plan, trust the work.`,
      `Race day. The training is done. Just run.`,
      `${raceName} day. You've earned every mile to get here.`,
    ]);
  }
  if (days === 1) {
    return pick([
      `${raceName} tomorrow. Light shake-out, early to bed, dial in the kit.`,
      `Race goes tomorrow. The work is done. Protect the sleep tonight.`,
    ]);
  }
  if (days != null && days >= 2 && days <= 7) {
    return pick([
      `Race week. Volume drops, intensity stays sharp. Trust the taper.`,
      `${days} days to ${raceName}. Rest matters more than miles this week.`,
      `Race week ${raceName}. Sharpen, don't strengthen. The base is banked.`,
    ]);
  }

  // 2. RAN TODAY — celebrate + cue tomorrow
  if (ran) {
    if (isQuality(ptype)) {
      const next = tDesc ? ` Tomorrow's ${tDesc}.` : '';
      return pick([
        `Threshold banked.${next}`,
        `That's the work. Quality session done.${next}`,
        `Hit the reps. Recovery starts now.${next}`,
      ]);
    }
    if (ptype === 'tempo') {
      const next = tDesc ? ` Tomorrow's ${tDesc}.` : '';
      return `Tempo banked.${next}`;
    }
    if (ptype === 'long') {
      const next = tDesc ? ` Tomorrow's ${tDesc}.` : ' Refuel within the hour, sleep early.';
      return pick([
        `Long run in the books.${next}`,
        `Big aerobic day banked.${next}`,
      ]);
    }
    if (ptype === 'race') {
      return `Race in the books. Take the day. The work paid off.`;
    }
    if (ptype === 'easy') {
      const next = tDesc ? ` Tomorrow's ${tDesc}.` : '';
      return pick([
        `Easy banked. Legs get to breathe.${next}`,
        `Conversational miles done.${next}`,
      ]);
    }
    // Default ran
    return tDesc ? `Run in the books. Tomorrow's ${tDesc}.` : `Run in the books. Recovery wins now.`;
  }

  // 3. PRE-RUN — cue the work
  if (isQuality(ptype)) {
    return pick([
      `Big one today. Lock the target pace, the splits hold themselves.`,
      `Quality day. Warm up well, then trust the legs.`,
      `Threshold today. Form first, pace second, the rest follows.`,
    ]);
  }
  if (ptype === 'tempo') {
    return `Tempo today. Sustained and controlled. Find the line and ride it.`;
  }
  if (ptype === 'long') {
    return pick([
      `Long day. Keep it aerobic. Fuel by 45 minutes.`,
      `Long run today. The point is time on feet, not the pace.`,
      `Long today. Conversational, even if the legs feel fresh early.`,
    ]);
  }
  if (ptype === 'race') {
    return `Race day. Hold back early, spend it late. The plan is the plan.`;
  }
  if (ptype === 'easy' || ptype === 'shakeout') {
    return pick([
      `Easy day. If you can't chat the whole way, you're going too hard.`,
      `Easy miles today. The point is recovery, not training stimulus.`,
      `Easy run. Save the legs for the next quality day.`,
    ]);
  }

  // 4. REST DAY
  if (ptype === 'rest') {
    return pick([
      `Rest day. The legs earned it. Sleep, mobility, recovery.`,
      `Rest is the work today. Stretch, hydrate, take a real day off.`,
      `No miles today. This is where the adaptations happen.`,
    ]);
  }

  // Unplanned / default
  return `Nothing on the calendar. Open a workout or log a run when you're done.`;
}

function isQuality(ptype: string): boolean {
  return ['threshold', 'intervals', 'vo2max'].includes(ptype);
}

function nextWorkout(weekDays: any[], today: string): any | null {
  const idx = weekDays.findIndex((d) => d.date === today);
  if (idx < 0 || idx + 1 >= weekDays.length) return null;
  return weekDays[idx + 1];
}

/** Plain-English description of an upcoming workout, used in tomorrow cues.
 *  No em-dashes, no clever punctuation. */
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
