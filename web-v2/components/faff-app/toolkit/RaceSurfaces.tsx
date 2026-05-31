'use client';

/**
 * Faff Toolkit · Family H · Race Surfaces
 *
 *   RaceResultHero    · FINISHED block (gold styling if PR). Closes line 1182.
 *   RaceLogisticsTile · bib / wave / start time + A/B target. Closes line 1198.
 *   CountdownLadder   · T-7 → T-0 vertical ladder. Closes line 1218.
 *   GelMileMarkers    · gel-mile points + tick marks on elevation chart.
 *                       Closes line 1146.
 *   CourseAnnotations · editorial start/finish labels + "what to expect"
 *                       paragraph. Closes line 1258.
 *   CrowdSourcedNote  · "crowd-sourced by N runners" caption. Closes line 1087.
 */
import React from 'react';
import { RaceStatusDot, type RaceStatus } from './atoms';

/* ============================================================
   RaceResultHero
   ============================================================ */
export function RaceResultHero({
  finishTime,
  pb,
  raceName,
  date,
  matchedRunId,
  onOpenRun,
}: {
  finishTime: string;
  pb?: boolean;
  raceName?: string;
  date?: string;
  matchedRunId?: string;
  onOpenRun?: () => void;
}) {
  return (
    <article className={`fa-result${pb ? ' is-pr' : ''}`}>
      <span className="eyebrow">{pb ? 'PR · FINISHED' : 'FINISHED'}</span>
      <div className="time">{finishTime}</div>
      {(raceName || date) ? (
        <div className="meta">
          {raceName}
          {raceName && date ? ' · ' : ''}
          {date}
        </div>
      ) : null}
      {(matchedRunId || onOpenRun) ? (
        <button
          type="button"
          className="view"
          onClick={onOpenRun ?? (() => { if (matchedRunId) window.location.assign(`/runs/${matchedRunId}`); })}
        >
          <span className="t">View the run</span>
          <ArrowRight />
        </button>
      ) : null}
    </article>
  );
}

/* ============================================================
   RaceLogisticsTile · bib / wave / start + A/B target overlay.
   ============================================================ */
export function RaceLogisticsTile({
  bib,
  wave,
  startTime,
  aTarget,
  bTarget,
}: {
  bib?: string | number | null;
  wave?: string | null;
  startTime?: string | null;
  aTarget?: string | null;
  bTarget?: string | null;
}) {
  const allEmpty = !bib && !wave && !startTime && !aTarget && !bTarget;
  if (allEmpty) return null;
  return (
    <div>
      <div className="fa-logistics">
        <div className="cell">
          <div className="k">BIB</div>
          <div className="v">{bib ?? '—'}</div>
        </div>
        <div className="cell">
          <div className="k">WAVE</div>
          <div className="v">{wave ?? '—'}</div>
        </div>
        <div className="cell">
          <div className="k">START</div>
          <div className="v">{startTime ?? '—'}</div>
        </div>
      </div>
      {(aTarget || bTarget) ? (
        <div className="fa-abtarget">
          {aTarget ? (
            <div className="t a">
              <span className="lbl">A · GOAL</span>
              <span className="v">{aTarget}</span>
            </div>
          ) : null}
          {bTarget ? (
            <div className="t b">
              <span className="lbl">B · SAFE</span>
              <span className="v">{bTarget}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
   CountdownLadder · T-7 → T-0 with today highlighted.
   `dayLabels` is keyed by days-out; renderer maps to glow / past / race.
   ============================================================ */
export interface CountdownEntry {
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
   GelMileMarkers · numeric list + tick marks on elevation chart.
   ============================================================ */
export function GelMileMarkers({ markers }: { markers: number[] }) {
  if (!markers || markers.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="fa-eyebrow" style={{ color: 'var(--amber-bright)' }}>GELS</span>
      <span style={{ color: 'var(--txt)', fontWeight: 600, fontFamily: 'var(--font-display)' }}>
        {markers.map((m) => `mi ${m.toFixed(1)}`).join(' · ')}
      </span>
    </div>
  );
}

/* SVG-anchor variant for overlaying tick marks on an elevation polyline.
   Caller positions the parent <svg viewBox>. We render only the marks. */
export function GelMileTicks({
  markers,
  totalMi,
  height = 36,
  topOffset = 4,
}: {
  markers: number[];
  totalMi: number;
  height?: number;
  topOffset?: number;
}) {
  if (!markers || totalMi <= 0) return null;
  return (
    <>
      {markers.map((m, i) => {
        const x = (m / totalMi) * 100;
        return (
          <g key={i} transform={`translate(${x},0)`}>
            <line
              x1={0} x2={0} y1={topOffset} y2={height}
              stroke="var(--amber-bright)" strokeWidth="0.8" strokeDasharray="2 1.5"
            />
            <circle cx={0} cy={topOffset} r={1.2} fill="var(--amber-bright)" />
          </g>
        );
      })}
    </>
  );
}

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

/* ============================================================
   CrowdSourcedNote · subtle credit text under the course map.
   Closes line 1087 (web side; iOS already shipped).
   ============================================================ */
export function CrowdSourcedNote({
  source,
  contributorCount,
}: {
  source: 'editorial' | 'crowd-sourced' | 'stub';
  contributorCount?: number;
}) {
  const text =
    source === 'editorial' ? 'Curated by Faff' :
    source === 'crowd-sourced'
      ? `Crowd-sourced by ${contributorCount ?? 0} runner${(contributorCount ?? 0) === 1 ? '' : 's'}`
      : 'Course preview unavailable · upload GPX to contribute';
  return (
    <p className="fa-prov" style={{ textAlign: 'center', marginTop: 6 }}>
      {text}
    </p>
  );
}

/* ============================================================
   RaceHeaderStatus · convenience wrapper combining the chip atom
   with the race-header status field.
   ============================================================ */
export function RaceHeaderStatus({
  status,
  reason,
}: {
  status: RaceStatus | null | undefined;
  reason?: string;
}) {
  if (!status) return null;
  return <RaceStatusDot status={status} reason={reason} />;
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}
