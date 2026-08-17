'use client';

/**
 * Faff Toolkit · Family H · Race Surfaces
 *
 *   CountdownLadder   · T-7 → T-0 vertical ladder. Closes line 1218.
 *   CourseAnnotations · editorial start/finish labels + "what to expect"
 *                       paragraph. Closes line 1258.
 */
/* ============================================================
   CountdownLadder · T-7 → T-0 with today highlighted.
   `dayLabels` is keyed by days-out; renderer maps to glow / past / race.
   ============================================================ */
interface CountdownEntry {
  daysOut: number;
  label: string;
}
export function CountdownLadder({
  entries,
  today,
}: {
  entries: CountdownEntry[];
  today: number; // current days-out from race
}) {
  if (!entries || entries.length === 0) return null;
  return (
    <div className="fa-ladder">
      {entries.map((e) => {
        const cls =
          e.daysOut === 0 ? 'is-race' :
          e.daysOut === today ? 'is-today' :
          e.daysOut < today ? 'is-past' : '';
        return (
          <div key={e.daysOut} className={`rung ${cls}`}>
            <span className="t">T-{e.daysOut}</span>
            <span className="lbl">{e.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* Default ladder shape for a marathon race week */
export const MARATHON_COUNTDOWN: CountdownEntry[] = [
  { daysOut: 7, label: 'Race week begins · drop volume 15%' },
  { daysOut: 5, label: 'Last threshold or interval session' },
  { daysOut: 3, label: 'Sharpener · short race-pace pickups' },
  { daysOut: 2, label: 'Easy short · feet up otherwise' },
  { daysOut: 1, label: 'Shakeout · 20 min easy + strides' },
  { daysOut: 0, label: 'Race day · trust the work' },
];

/* ============================================================
   CourseAnnotations · start/finish labels + free-text notes.
   ============================================================ */
export function CourseAnnotations({
  startLabel,
  finishLabel,
  notes,
}: {
  startLabel?: string | null;
  finishLabel?: string | null;
  notes?: string | null;
}) {
  if (!startLabel && !finishLabel && !notes) return null;
  return (
    <div className="fa-course">
      <div className="ends">
        {startLabel ? (
          <div className="e start">
            <span className="pin" />
            <span className="x">
              <small>START</small>
              {startLabel}
            </span>
          </div>
        ) : <span />}
        {finishLabel ? (
          <div className="e finish">
            <span className="x" style={{ textAlign: 'right' }}>
              <small>FINISH</small>
              {finishLabel}
            </span>
            <span className="pin" />
          </div>
        ) : <span />}
      </div>
      {notes ? (
        <div className="notes">
          <span className="lbl">What to expect</span>
          {notes}
        </div>
      ) : null}
    </div>
  );
}
