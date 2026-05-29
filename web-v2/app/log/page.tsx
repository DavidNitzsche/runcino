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
import { loadLogState } from '@/lib/coach/log-state';

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
      {log.totalRunsUnfiltered === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
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
            <LogTable weeks={log.weeks} />
          )}
        </>
      )}
    </FaffPageShell>
  );
}
