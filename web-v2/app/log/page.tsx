/**
 * /log — chronological history of every run, grouped by week.
 *
 * Pulls from the runs table (legacy-named strava_activities, holds runs
 * from watch / Apple Health / manual entry / Strava webhook — all sources
 * land here). Each row opens the full run detail modal.
 *
 * URL-driven filters (2026-05-28): the four axes (source, type, phase,
 * shoe) come from ?source=…&type=…&phase=…&shoe=… so every filter view
 * is a shareable URL. Composition is AND across axes. See
 * lib/coach/log-state.ts for the join + filter pipeline.
 */
import { LogTable } from '@/components/log/LogTable';
import { LogFilterStrip, LogEmptyMatch } from '@/components/log/LogFilterStrip';
import { ManualRunButton } from '@/components/today/ManualRunButton';
import { FaffPageShell } from '@/components/faff/FaffPageShell';
import { ReconnectBanner } from '@/components/strava/ReconnectBanner';
import { loadLogState } from '@/lib/coach/log-state';
import {
  loadStravaConnectionStatus,
  loadReauthFailedRunIds,
} from '@/lib/strava/connection-status';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

type LogSearchParams = {
  source?: string;
  type?: string;
  phase?: string;
  shoe?: string;
};

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<LogSearchParams>;
}) {
  const sp = await searchParams;
  const log = await loadLogState(DAVID_USER_ID, {
    filters: {
      source: sp.source ?? null,
      type: sp.type ?? null,
      phase: sp.phase ?? null,
      shoe: sp.shoe ?? null,
    },
  });

  // Strava connection health (P-STRAVA-401-UX). Drives the inline reauth
  // banner above the filter strip, plus the per-row ⚠ chip on rows whose
  // last push was a 401. Best-effort: errors degrade to "no chips, no
  // banner" and the rest of /log renders unchanged.
  const stravaStatus = await loadStravaConnectionStatus(DAVID_USER_ID)
    .then((s) => s.state)
    .catch(() => undefined);
  const visibleRunIds = log.weeks.flatMap((w) => w.runs.map((r) => r.id));
  const reauthFailedRunIds = visibleRunIds.length > 0
    ? await loadReauthFailedRunIds(DAVID_USER_ID, visibleRunIds).catch(() => new Set<string>())
    : new Set<string>();

  // Build the eyebrow — switches between the unfiltered headline and the
  // "X OF Y RUNS · Z MI MATCHING · <axes>" headline when any filter is set.
  const activeAxes: string[] = [];
  if (log.filters.type) activeAxes.push(log.filters.type.toUpperCase());
  if (log.filters.phase) activeAxes.push(log.filters.phase.toUpperCase());
  if (log.filters.source) activeAxes.push(log.filters.source.toUpperCase());
  if (log.filters.shoe) {
    const match = log.axes.shoes.find((s) => s.slug === log.filters.shoe);
    activeAxes.push((match?.name ?? log.filters.shoe).toUpperCase());
  }
  const hasFilters = activeAxes.length > 0;
  const eyebrow = hasFilters
    ? `${log.totalRuns} OF ${log.totalRunsUnfiltered} RUNS · ${log.totalMi.toFixed(0)} MI MATCHING · ${activeAxes.join(' · ')}`
    : `${log.totalRunsUnfiltered} RUNS · ${log.totalMiUnfiltered.toFixed(0)} MILES · CHRONOLOGICAL`;

  return (
    <FaffPageShell
      title="Log."
      eyebrow={eyebrow}
      maxWidth={1100}
      accent={<ManualRunButton />}
    >
      {/* Strava 401 reauth banner — top of the page, above the filter strip
          per spec 2026-05-28. Renders only when status is 'needs_reauth'. */}
      <div style={{ marginBottom: stravaStatus === 'needs_reauth' ? 14 : 0 }}>
        <ReconnectBanner initialState={stravaStatus} />
      </div>
      {log.totalRunsUnfiltered === 0 ? (
        <div style={{ borderTop: '1px solid var(--line)', padding: '40px 0', textAlign: 'center' }}>
          <div className="card-eyebrow" style={{ color: 'var(--mute)' }}>NO RUNS YET</div>
          <p style={{ color: 'var(--mute)', fontSize: 14, marginTop: 8 }}>
            When the watch syncs your first run, it'll show up here.
          </p>
        </div>
      ) : (
        <>
          <LogFilterStrip filters={log.filters} axes={log.axes} />
          {log.weeks.length === 0 ? (
            <LogEmptyMatch totalUnfiltered={log.totalRunsUnfiltered} />
          ) : (
            <LogTable
              weeks={log.weeks}
              reauthFailedRunIds={Array.from(reauthFailedRunIds)}
            />
          )}
        </>
      )}
    </FaffPageShell>
  );
}
