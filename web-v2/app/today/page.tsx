/**
 * /today · the daily home (v3 cutover · 2026-05-28).
 *
 * Server component:
 *   1. Loads GlanceState via the existing production loader (unchanged)
 *   2. Resolves the 11-state DayState via the Faff adapter
 *   3. Builds PosterPayload / SiblingPayload / WeekStripPayload
 *   4. Renders TodayClient with the legacy BriefingLoader injected as a
 *      slot for the LLM-backed coach voice (kept working during cutover)
 *
 * What changed vs v2:
 *   - Hero: readiness-ring + coach-hit + old WeekStrip → Poster + Sibling
 *     + new 4-char-vocab WeekStrip (per Faff design system)
 *   - All visual styling now driven by Faff tokens (Oswald 700 display,
 *     12 state gradients, 5 zone tokens)
 *
 * What stayed the same:
 *   - loadGlanceState (the data path)
 *   - BriefingLoader (the LLM coach voice loader)
 *   - TopNav (the global navigation)
 *
 * Cardinal Rule #1 · build it right. Cardinal Rule #4 · single source of
 * truth (tokens come from /lib/faff/types + design/tokens/*.css mirrored
 * into globals.css).
 */

import { TopNav } from '@/components/layout/TopNav';
import { BriefingLoader } from '@/components/cards/BriefingLoader';
import { loadGlanceState } from '@/lib/coach/glance-state';
import {
  resolveDayState,
  buildPoster,
  buildSibling,
  buildWeekStrip,
} from '@/lib/faff/glance-adapter';
import { TodayClient } from './TodayClient';

// Glance state is a handful of fast pg queries — page renders in ~200ms.
// The LLM-backed coach voice loads asynchronously via <BriefingLoader />.
export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function TodayPage() {
  let glance: Awaited<ReturnType<typeof loadGlanceState>> | null = null;
  let glanceError: string | null = null;
  try {
    glance = await loadGlanceState(DAVID_USER_ID);
  } catch (e: unknown) {
    const err = e as { message?: string };
    glanceError = err?.message ?? String(e);
  }

  // Hard-fail render: if the loader broke, show the error chip on top of
  // a minimum-state Poster so the page still has structure.
  if (!glance) {
    return (
      <>
        <TopNav />
        <ErrorSurface message={glanceError ?? 'Failed to load /today data.'} />
      </>
    );
  }

  const state = resolveDayState(glance);
  const poster = buildPoster(glance, state);
  const sibling = buildSibling(glance, state);
  const week = buildWeekStrip(glance);

  return (
    <>
      <TopNav />
      <TodayClient
        poster={poster}
        sibling={sibling}
        week={week}
        state={state}
        phaseLabel={glance.phaseLabel}
        briefingSlot={<BriefingLoader surface="today" renderCards={false} />}
        errorSlot={glanceError ? <ErrorChip message={glanceError} /> : null}
      />
    </>
  );
}

function ErrorSurface({ message }: { message: string }) {
  return (
    <main style={{ maxWidth: 1440, margin: '0 auto', padding: '40px 32px' }}>
      <div
        className="card"
        style={{
          padding: 24,
          background: 'rgba(252,77,100,0.04)',
          borderColor: 'rgba(252,77,100,0.22)',
        }}
      >
        <div className="card-eyebrow" style={{ color: 'var(--over)' }}>
          GLANCE DATA UNAVAILABLE
        </div>
        <pre
          style={{
            fontSize: 12,
            color: 'var(--ink)',
            whiteSpace: 'pre-wrap',
            marginTop: 12,
            fontFamily: 'var(--f-body)',
          }}
        >
          {message}
        </pre>
      </div>
    </main>
  );
}

function ErrorChip({ message }: { message: string }) {
  return (
    <div
      className="card"
      style={{
        marginTop: 24,
        padding: 18,
        background: 'rgba(252,77,100,0.04)',
        borderColor: 'rgba(252,77,100,0.22)',
      }}
    >
      <div className="card-eyebrow" style={{ color: 'var(--over)' }}>
        GLANCE DATA WARNING
      </div>
      <pre
        style={{
          fontSize: 11,
          color: 'var(--ink)',
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--f-body)',
        }}
      >
        {message}
      </pre>
    </div>
  );
}
