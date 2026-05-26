/**
 * /log — chronological history of every run, grouped by week.
 *
 * Pulls from the runs table (legacy-named strava_activities, holds runs
 * from watch / Apple Health / manual entry / Strava webhook — all sources
 * land here). Each row opens the full run detail modal.
 */
import { TopNav } from '@/components/layout/TopNav';
import { LogTable } from '@/components/log/LogTable';
import { loadLogState } from '@/lib/coach/log-state';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function LogPage() {
  const log = await loadLogState(DAVID_USER_ID);

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 64, lineHeight: 1, margin: 0, letterSpacing: '0.5px' }}>
              Log.
            </h1>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 10 }}>
              {log.totalRuns} RUNS · {log.totalMi.toFixed(0)} MILES · CHRONOLOGICAL
            </div>
          </div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--dim)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>
            ALL SOURCES · WATCH · MANUAL · STRAVA · APPLE HEALTH
          </div>
        </div>

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
      </div>
    </main>
  );
}
