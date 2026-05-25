import { TopNav } from '@/components/layout/TopNav';
import { CoachBlock } from '@/components/cards/CoachBlock';
import { TopicRenderer } from '@/components/cards/TopicRenderer';
import { generateBriefing } from '@/lib/coach/engine';

// LLM call gated by topic-prereq filter, not by Next's route cache.
// Every render regenerates so a fresh check-in reflects on the next view.
export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

// Server component — fetches the briefing at request time. Phase 2 adds cache.
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
        <div style={{
          maxWidth: 460,
          margin: '0 auto',
          background: 'var(--bg)',
          paddingBottom: 40,
        }}>
          {/* Mobile-first column matching iPhone deck width. Web companion lands in P2. */}
          <CoachBlock
            lead={briefing.lead}
            voice={briefing.voice}
            briefingId={`${briefing._state.user_id}|${briefing._state.today}|${briefing.surface}`}
            askPrompt={
              briefing.mode === 'post-run'  ? 'Let me know how it felt.' :
              briefing.mode === 'pre-run'   ? 'How are the legs?' :
              briefing.mode === 'rest-day'  ? 'Anything sore?' :
                                              'Ready?'
            }
          />

          <div style={{ padding: '4px 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {briefing.topics.map((topic, i) => (
              <TopicRenderer key={i} topic={topic} />
            ))}
          </div>

          {/* Debug strip — visible only in dev. Drops in P2 with full styling pass. */}
          {process.env.NODE_ENV !== 'production' && (
            <div style={{
              padding: '12px 24px', fontFamily: 'var(--f-body)', fontSize: 10,
              color: 'var(--dim)', letterSpacing: '0.5px',
              borderTop: '1px dashed var(--line-2)',
            }}>
              <div>SURFACE: {briefing.surface} · MODE: {briefing.mode}</div>
              <div>CANDIDATES: {briefing._state.candidateKinds.join(', ')}</div>
              <div>ELIGIBLE: {briefing._state.eligibleKinds.join(', ')}</div>
              <div>EMITTED: {briefing.topics.map(t => t.kind).join(', ')}</div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
