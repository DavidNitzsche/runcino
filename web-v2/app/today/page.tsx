import { TopNav } from '@/components/layout/TopNav';
import { TodayLayouts } from '@/components/layout/TodayLayouts';
import { generateBriefing } from '@/lib/coach/engine';

// LLM call gated by topic-prereq filter, not by Next's route cache.
// Every render regenerates so a fresh check-in reflects on the next view.
export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function TodayPage() {
  let briefing: Awaited<ReturnType<typeof generateBriefing>> | null = null;
  let error: string | null = null;
  try {
    briefing = await generateBriefing(DAVID_USER_ID, 'today');
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  return (
    <main>
      <TopNav />

      {error && (
        <div style={{ padding: '40px', maxWidth: 1440 }}>
          <div className="card" style={{ background: 'rgba(252,77,100,0.04)', borderColor: 'rgba(252,77,100,0.22)' }}>
            <div className="card-eyebrow" style={{ color: 'var(--over)' }}>BRIEFING ERROR</div>
            <pre style={{ color: 'var(--ink)', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{error}</pre>
          </div>
        </div>
      )}

      {briefing && (
        <>
          <TodayLayouts
            lead={briefing.lead}
            voice={briefing.voice}
            topics={briefing.topics}
            mode={briefing.mode}
            briefingId={`${briefing._state.user_id}|${briefing._state.today}|${briefing.surface}`}
            greetingName="David"
            todayLabel={todayLabel(briefing._state.today)}
            metaLine={metaLineFor(briefing)}
            askPrompt={askPromptFor(briefing.mode)}
            readinessBreakdown={briefing._state.readiness}
            glance={{
              sleep7Avg:       briefing._state.sleep7Avg,
              sleep7Deficit:   briefing._state.sleep7Deficit,
              rhrCurrent:      briefing._state.rhrCurrent,
              rhrBaseline:     briefing._state.rhrBaseline,
              cadenceBaseline: briefing._state.cadenceBaseline,
              weekDone:        briefing._state.weekDone,
              weekPlanned:     briefing._state.weekPlanned,
            }}
          />

          {/* Debug strip — dev only. */}
          {process.env.NODE_ENV !== 'production' && (
            <div style={{
              maxWidth: 1440, margin: '0 auto',
              padding: '12px 40px', fontFamily: 'var(--f-body)', fontSize: 10,
              color: 'var(--dim)', letterSpacing: '0.5px',
              borderTop: '1px dashed var(--line-2)',
            }}>
              <div>SURFACE: {briefing.surface} · MODE: {briefing.mode}</div>
              <div>CANDIDATES: {briefing._state.candidateKinds.join(', ')}</div>
              <div>ELIGIBLE: {briefing._state.eligibleKinds.join(', ')}</div>
              <div>EMITTED: {briefing.topics.map(t => t.kind).join(', ')}</div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function todayLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${days[d.getUTCDay()]} · ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function askPromptFor(mode: string): string {
  switch (mode) {
    case 'post-run':  return 'Let me know how it felt.';
    case 'pre-run':   return 'How are the legs?';
    case 'rest-day':  return 'Anything sore?';
    case 'race-day':  return 'Ready?';
    default:          return 'Let me know.';
  }
}

function metaLineFor(briefing: Awaited<ReturnType<typeof generateBriefing>>): string | undefined {
  const lines: string[] = [];
  // The state-loader puts phaseLabel / next A-race countdown into _state in P3+;
  // for now we synthesize from what we know.
  return lines.length ? lines.join(' · ') : undefined;
}
