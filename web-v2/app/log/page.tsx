/**
 * /log — chronological history of every run, grouped by week.
 *
 * Pulls from the runs table (legacy-named strava_activities, holds runs
 * from watch / Apple Health / manual entry / Strava webhook — all sources
 * land here). Each row opens the full run detail modal.
 */
import { LogTable } from '@/components/log/LogTable';
import { ManualRunButton } from '@/components/today/ManualRunButton';
import { FaffPageShell } from '@/components/faff/FaffPageShell';
import { loadLogState } from '@/lib/coach/log-state';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function LogPage() {
  const log = await loadLogState(DAVID_USER_ID);

  const eyebrow = `${log.totalRuns} RUNS · ${log.totalMi.toFixed(0)} MILES · CHRONOLOGICAL`;

  return (
    <FaffPageShell
      title="Log."
      eyebrow={eyebrow}
      maxWidth={1100}
      accent={
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <ManualRunButton />
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--dim)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>
            ALL SOURCES · WATCH · STRAVA · APPLE HEALTH · MANUAL
          </div>
        </div>
      }
    >
      {log.weeks.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div className="card-eyebrow" style={{ color: 'var(--mute)' }}>NO RUNS YET</div>
          <p style={{ color: 'var(--mute)', fontSize: 14, marginTop: 8 }}>
            When the watch syncs your first run, it'll show up here.
          </p>
        </div>
      ) : (
        <LogTable weeks={log.weeks} />
      )}
    </FaffPageShell>
  );
}
