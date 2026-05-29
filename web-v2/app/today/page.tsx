/**
 * /today · the daily home (v3 cutover · 2026-05-28).
 *
 * Server component:
 *   1. Loads GlanceState via the existing production loader (unchanged) —
 *      OR substitutes a persona fixture when `?persona=<key>` is on the URL
 *      (simulator mode, Phase 13).
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
 *   - loadGlanceState (the data path) for the real-data branch
 *   - BriefingLoader (the LLM coach voice loader) for the real-data branch
 *   - TopNav (the global navigation)
 *
 * Simulator path · Phase 13 (2026-05-28):
 *   `/today?persona=<key>` bypasses the DB lookup and feeds the persona's
 *   deterministic GlanceState directly to the adapter. Lets us visually
 *   verify every day-state without seeding a runner per archetype in the
 *   DB. The persona catalogue lives in lib/faff/personas.ts (read-only;
 *   mirror of Faff repo's canonical fixtures).
 *
 *   The LLM briefing is suppressed in persona mode — BriefingLoader hits
 *   Anthropic with the real user's data, which is meaningless for a
 *   simulated persona. We render a static "simulator mode" placeholder
 *   in its slot instead.
 *
 * Cardinal Rule #1 · build it right. Cardinal Rule #4 · single source of
 * truth (tokens come from /lib/faff/types + design/tokens/*.css mirrored
 * into globals.css).
 */

import { TopNav } from '@/components/layout/TopNav';
import { BriefingLoader } from '@/components/cards/BriefingLoader';
import { loadGlanceState, type GlanceState } from '@/lib/coach/glance-state';
import {
  resolveDayState,
  buildPoster,
  buildSibling,
  buildWeekStrip,
} from '@/lib/faff/glance-adapter';
import {
  PERSONA_CATALOGUE,
  getPersonaGlanceState,
  type PersonaKey,
} from '@/lib/faff/personas';
import { loadStravaConnectionStatus } from '@/lib/strava/connection-status';
import { TodayClient } from './TodayClient';

// Glance state is a handful of fast pg queries — page renders in ~200ms.
// The LLM-backed coach voice loads asynchronously via <BriefingLoader />.
export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ persona?: string }>;
}) {
  const params = await searchParams;
  const personaKey = isPersonaKey(params.persona) ? params.persona : null;

  let glance: GlanceState | null = null;
  let glanceError: string | null = null;

  if (personaKey) {
    // Simulator path · deterministic, no DB lookup, no LLM briefing.
    glance = getPersonaGlanceState(personaKey);
  } else {
    try {
      glance = await loadGlanceState(DAVID_USER_ID);
    } catch (e: unknown) {
      const err = e as { message?: string };
      glanceError = err?.message ?? String(e);
    }
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

  // Strava connection health (P-STRAVA-401-UX). Best-effort: if the lookup
  // throws we silently render no banner — the rest of /today still loads.
  // Suppressed entirely in simulator mode (persona fixtures don't have
  // real OAuth state).
  const stravaStatus = personaKey
    ? undefined
    : await loadStravaConnectionStatus(DAVID_USER_ID)
        .then((s) => s.state)
        .catch(() => undefined);

  // In persona mode, suppress the LLM briefing — BriefingLoader hits
  // Anthropic with the real user's data and doesn't know about the
  // simulated persona. Render a static placeholder instead so the
  // slot's visual footprint is preserved.
  const briefingSlot = personaKey ? (
    <SimulatorBriefingPlaceholder />
  ) : (
    <BriefingLoader surface="today" renderCards={false} />
  );

  return (
    <>
      <TopNav />
      <TodayClient
        poster={poster}
        sibling={sibling}
        week={week}
        state={state}
        phaseLabel={glance.phaseLabel}
        briefingSlot={briefingSlot}
        errorSlot={glanceError ? <ErrorChip message={glanceError} /> : null}
        activePersona={personaKey}
        stravaStatus={stravaStatus}
        activeNiggle={glance.activeNiggle}
        activeSick={glance.activeSick}
        sleep7Avg={glance.sleep7Avg}
        rhrCurrent={glance.rhrCurrent}
        rhrBaseline={glance.rhrBaseline}
      />
    </>
  );
}

/**
 * Type-guard: only accept strings that match a known PersonaKey from the
 * catalogue. Keeps URL handling tight — typos route to the real-data path
 * rather than throwing.
 */
function isPersonaKey(s: string | undefined): s is PersonaKey {
  if (!s) return false;
  return PERSONA_CATALOGUE.some((p) => p.key === s);
}

function SimulatorBriefingPlaceholder() {
  return (
    <div
      style={{
        fontFamily: 'var(--f-body)',
        fontSize: 12,
        color: 'var(--mute)',
        padding: '12px 4px',
        letterSpacing: '0.2px',
      }}
    >
      Coach voice · simulator mode · LLM briefing suppressed for personas.
    </div>
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
