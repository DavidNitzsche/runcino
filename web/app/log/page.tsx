'use client';

/**
 * /log · Run-history scanner (May 2026 port).
 *
 * Mockup: designs/log-2026-05-09.html — locked.
 *
 * Architecture mirrors /overview, /training, /races, /health:
 *   - Single useEffect loads via /api/log (server-side coach bundle).
 *   - Skeleton + error fallback via <EmptyState>.
 *   - Cards composed from @/app/components primitives.
 *   - Run rows link to /runs/[id] (existing legacy detail route; the
 *     locked Run Detail template will replace that surface later).
 *
 * Row plan (1:1 with mockup):
 *   1 · YearInRunningCard  (span 12) — 53-week heatmap + KPI strip
 *   2 · MonthlyVolumeCard  (span 6)  — 2026 vs 2025 bar chart
 *   2 · PersonalBestsCard  (span 6)  — 6-card PR shelf
 *   3 · RecentRunsCard     (span 12) — last-7 runs feed
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Topbar,
  Stage,
  Row,
  Card,
  CardHeader,
  CardLabel,
  CardPin,
  CardFoot,
  Greet,
  GreetId,
  GreetState,
  GreetTile,
  EmptyState,
  Skeleton,
} from '@/app/components';
import {
  loadLogData,
  formatTopbarClock,
  formatTime,
  formatPace,
  type LogData,
  type HeatCell,
  type MonthBar,
  type PrCard,
  type RunRow,
} from './data';

export default function LogPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [data, setData] = useState<LogData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  useEffect(() => {
    if (!now) return;
    let cancelled = false;
    setLoadError(null);
    loadLogData()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [now]);

  const clock = now ? formatTopbarClock(now) : null;

  return (
    <Stage>
      <Topbar
        activeTab="log"
        clock={clock !== null ? clock : <Skeleton width={140} height={12} />}
      />

      <LogGreet data={data} />

      {loadError && (
        <Row>
          <Card span={12}>
            <EmptyState
              variant="error"
              title="Couldn't load Log"
              body={loadError}
            />
          </Card>
        </Row>
      )}

      {data ? (
        <LogBody data={data} />
      ) : (
        !loadError && <LogSkeleton />
      )}
    </Stage>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Greet band — eyebrow KPIs + 4 GreetTiles for TOTAL/WEEK/LAST/LONGEST
// ─────────────────────────────────────────────────────────────────────

function LogGreet({ data }: { data: LogData | null }) {
  if (!data) {
    return (
      <Greet>
        <GreetId
          eyebrow={<Skeleton width={300} height={11} />}
          title={<Skeleton width={120} height={48} />}
        />
        <GreetState>
          {[0, 1, 2, 3, 4].map((i) => (
            <GreetTile key={i} eyebrow="—" value={<Skeleton width={56} height={20} />} />
          ))}
        </GreetState>
      </Greet>
    );
  }

  const y = data.yearSummary;
  const totalsTone = y.vsLastYearMi >= 0 ? 'good' : 'amber';
  const eoyTone = y.eoyProjMiles >= 1500 ? 'good' : 'coach';

  return (
    <Greet>
      <GreetId eyebrow={data.greetEyebrow} title="LOG" />
      <GreetState>
        <GreetTile
          variant={totalsTone}
          eyebrow="YTD TOTAL"
          value={String(y.ytdMiles)}
          unit="MI"
          delta={`${y.vsLastYearMi >= 0 ? '+' : ''}${y.vsLastYearMi} vs ${y.year - 1}`}
          deltaColor={y.vsLastYearMi >= 0 ? 'var(--good)' : 'var(--warn)'}
        />
        <GreetTile
          variant="coach"
          eyebrow="YTD RUNS"
          value={String(y.ytdRuns)}
          unit={`/${y.dayOfYear}d`}
          delta={`${y.ytdDaysRun} unique days`}
          deltaColor="var(--coach)"
        />
        <GreetTile
          variant={eoyTone}
          eyebrow="EOY PROJ"
          value={String(y.eoyProjMiles)}
          unit="MI"
          delta={`DAY ${y.dayOfYear}/365`}
          deltaColor="var(--coach)"
        />
        <GreetTile
          variant="race"
          eyebrow="LONGEST"
          value={data.longestRunMi.toFixed(1)}
          unit="MI"
          delta={data.longestRunName?.toUpperCase() ?? ''}
          deltaColor="var(--race)"
        />
        {/* 5th tile · weekly volume pace · pulls from same ytd numbers, gives
            a fresh angle (planning baseline) not duplicated by YTD TOTAL or
            EOY PROJ. */}
        <GreetTile
          variant="amber"
          eyebrow="AVG / WEEK"
          value={((y.ytdMiles / Math.max(1, y.dayOfYear / 7))).toFixed(1)}
          unit="MI"
          delta={`${y.ytdRuns} RUNS · ${(y.ytdRuns / Math.max(1, y.dayOfYear / 7)).toFixed(1)}/WK`}
          deltaColor="var(--att)"
        />
      </GreetState>
    </Greet>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────────

function LogBody({ data }: { data: LogData }) {
  return (
    <>
      <Row>
        <YearInRunningCard data={data} />
      </Row>
      <Row>
        <MonthlyVolumeCard data={data} />
        <PersonalBestsCard data={data} />
      </Row>
      <Row>
        <RecentRunsCard data={data} />
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 1 · YearInRunningCard (span 12)
// 53-week heatmap + EOY/YTD/vs-prior-year stats.
// ─────────────────────────────────────────────────────────────────────

function YearInRunningCard({ data }: { data: LogData }) {
  const y = data.yearSummary;
  return (
    <Card span={12} padding="18px 22px">
      <CardHeader>
        <CardLabel>YEAR IN RUNNING · {y.year} · DAY {y.dayOfYear}/365</CardLabel>
        <div
          style={{
            display: 'flex',
            gap: 14,
            fontFamily: 'var(--f-data)',
            fontSize: 11,
            letterSpacing: '1.4px',
            fontWeight: 700,
            textTransform: 'uppercase',
          }}
        >
          <span>
            <b style={{ color: 'var(--good)' }}>{y.eoyProjMiles.toLocaleString()}</b>{' '}
            <span style={{ color: 'var(--t3)' }}>EOY PROJ</span>
          </span>
          <span>
            <b style={{ color: 'var(--corp)' }}>{y.ytdMiles.toLocaleString()}</b>{' '}
            <span style={{ color: 'var(--t3)' }}>YTD</span>
          </span>
          <span>
            <b style={{ color: y.vsLastYearMi >= 0 ? 'var(--good)' : 'var(--warn)' }}>
              {y.vsLastYearMi >= 0 ? '+' : ''}{y.vsLastYearMi}
            </b>{' '}
            <span style={{ color: 'var(--t3)' }}>vs {y.year - 1}</span>
          </span>
        </div>
      </CardHeader>

      <YearHeatStrip cells={data.yearHeat} />

      <MonthAxis months={data.months} />

      <CardFoot
        left="A year in cells. Each square is a week — color and intensity track your mileage; red marks race weeks."
      />
    </Card>
  );
}

function YearHeatStrip({ cells }: { cells: HeatCell[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.max(53, cells.length)}, 1fr)`,
        gap: 2,
        marginTop: 14,
      }}
    >
      {cells.map((c, i) => {
        const baseGreen = `rgba(62,189,65, ${Math.max(0.10, c.intensity * 0.9)})`;
        const bg = c.tone === 'race'
          ? '#FF5722'
          : c.tone === 'amber'
          ? `rgba(243,173,56, ${Math.max(0.35, c.intensity * 0.9)})`
          : c.tone === 'rest'
          ? 'var(--l3)'
          : baseGreen;
        return (
          <div
            key={i}
            title={`${c.weekStartISO} · ${c.miles.toFixed(1)} mi${c.hasRace ? ' · race' : ''}`}
            style={{
              aspectRatio: '1',
              background: bg,
              borderRadius: 2,
              outline: c.isCurrent ? '2px solid var(--att)' : undefined,
              outlineOffset: c.isCurrent ? -1 : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

function MonthAxis({ months }: { months: MonthBar[] }) {
  // 12 evenly-spaced month labels under the 53-week strip.
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontFamily: 'var(--f-data)',
        fontSize: 9,
        letterSpacing: '1.2px',
        color: 'var(--t3)',
        fontWeight: 700,
        marginTop: 8,
      }}
    >
      {months.map((m) => {
        const color = m.isCurrent ? 'var(--corp)' : m.isPeak ? 'var(--att)' : m.isFuture ? 'var(--t4)' : 'var(--t3)';
        const suffix = m.isCurrent ? ' ▶' : m.isPeak ? ' ★' : '';
        return (
          <span key={m.monthIdx} style={{ color }}>
            {m.label}{suffix}
          </span>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 2A · MonthlyVolumeCard (span 6)
// 2026 vs 2025 bar chart — SVG, mirrors the mockup.
// ─────────────────────────────────────────────────────────────────────

function MonthlyVolumeCard({ data }: { data: LogData }) {
  const months = data.months;
  // Compute the max across all bars so y-scale is shared.
  const maxMi = Math.max(
    1,
    ...months.flatMap((m) => [m.milesThisYear, m.milesPriorYear]),
  );
  const W = 720;
  const H = 200;
  const colWidth = W / 12; // 60px each
  const barWidth = 20;
  const valid = months.some((m) => m.milesThisYear > 0);

  return (
    <Card span={6} padding="18px 20px">
      <CardHeader>
        <CardLabel>MONTHLY VOLUME · {data.yearSummary.year} vs {data.yearSummary.year - 1}</CardLabel>
        <CardPin variant={data.yearSummary.vsLastYearMi >= 0 ? 'green' : 'amber'}>
          {data.yearSummary.vsLastYearMi >= 0 ? '+' : ''}{data.yearSummary.vsLastYearMi} YTD
        </CardPin>
      </CardHeader>

      {valid ? (
        <svg
          style={{ width: '100%', height: 200, marginTop: 10 }}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
        >
          {/* Reference grid lines */}
          {[50, 100, 150].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2={W}
              y2={y}
              stroke="rgba(244,246,248,.06)"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {months.map((m) => {
            const cx = m.monthIdx * colWidth + colWidth / 2;
            const thisH = (m.milesThisYear / maxMi) * (H - 30);
            const priorH = (m.milesPriorYear / maxMi) * (H - 30);
            const thisY = H - thisH - 10;
            const priorY = H - priorH - 10;
            const thisX = cx - barWidth - 2;
            const priorX = cx + 2;
            const isPeakCurr = m.isPeak;
            const isCurrent = m.isCurrent;
            const fillThis = m.isFuture
              ? 'var(--l3)'
              : isPeakCurr
              ? 'var(--good)'
              : isCurrent
              ? 'rgba(0,143,236,.7)'
              : 'rgba(62,189,65,.7)';
            return (
              <g key={m.monthIdx}>
                {/* prior year — shaded gray */}
                {m.milesPriorYear > 0 && (
                  <rect
                    x={priorX}
                    y={priorY}
                    width={barWidth}
                    height={priorH}
                    fill="var(--t3)"
                    opacity="0.4"
                    rx="2"
                  />
                )}
                {/* this year — solid */}
                <rect
                  x={thisX}
                  y={thisY}
                  width={barWidth}
                  height={m.isFuture ? 10 : Math.max(10, thisH)}
                  fill={fillThis}
                  rx="2"
                />
                {/* value label on top of this-year bar */}
                {!m.isFuture && m.milesThisYear > 0 && (
                  <text
                    x={thisX + barWidth / 2}
                    y={thisY - 6}
                    textAnchor="middle"
                    fontFamily="JetBrains Mono"
                    fontSize="11"
                    fontWeight="700"
                    fill={isPeakCurr ? '#F3AD38' : isCurrent ? '#008FEC' : '#F4F6F8'}
                  >
                    {m.milesThisYear}{isPeakCurr ? '★' : ''}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      ) : (
        <div
          style={{
            height: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--t3)',
            fontFamily: 'var(--f-data)',
            fontSize: 11,
            letterSpacing: '1.4px',
          }}
        >
          NO ACTIVITY YET THIS YEAR
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: 3,
          marginTop: 6,
        }}
      >
        {months.map((m) => {
          const color = m.isCurrent ? 'var(--corp)' : m.isFuture ? 'var(--t3)' : 'var(--t2)';
          const suffix = m.isCurrent ? ' ▶' : '';
          return (
            <div
              key={m.monthIdx}
              style={{
                textAlign: 'center',
                fontFamily: 'var(--f-data)',
                fontSize: 9,
                color,
                fontWeight: 700,
              }}
            >
              {m.label}{suffix}
            </div>
          );
        })}
      </div>

      <CardFoot
        left={`This year vs last year, side by side. Shaded bars are ${data.yearSummary.year - 1}; solid bars are ${data.yearSummary.year}.`}
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 2B · PersonalBestsCard (span 6)
// 6 PR cards (5K · 10K · Half · Marathon · 1 mi · Longest).
// ─────────────────────────────────────────────────────────────────────

function PersonalBestsCard({ data }: { data: LogData }) {
  return (
    <Card span={6} padding="18px 20px">
      <CardHeader>
        <CardLabel>PERSONAL BESTS · {data.yearSummary.year}</CardLabel>
        <CardPin variant={data.newPrCount > 0 ? 'green' : 'muted'}>
          {data.newPrCount > 0 ? `${data.newPrCount} NEW PRs` : 'NO NEW PRs'}
        </CardPin>
      </CardHeader>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginTop: 6,
        }}
      >
        {data.prs.map((p) => <PrTile key={p.label} pr={p} />)}
      </div>

      <CardFoot
        left="Your fastest times across canonical distances. NEW = set this year. Tap a card to jump to the run."
      />
    </Card>
  );
}

function PrTile({ pr }: { pr: PrCard }) {
  const has = pr.timeDisplay != null;
  const isLongest = pr.label === 'LONGEST';

  // Style — NEW PRs get a left accent in good color; old PRs are quieter.
  const accentColor = pr.isNew ? 'var(--good)' : 'transparent';
  const tile = (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--l2)',
        borderRadius: 6,
        borderLeft: pr.isNew ? '3px solid var(--good)' : 'none',
        opacity: has ? 1 : 0.55,
        cursor: has && pr.activityId ? 'pointer' : 'default',
        textDecoration: 'none',
        color: 'inherit',
        display: 'block',
      }}
    >
      <div
        className="mono-sm"
        style={{
          color: pr.isNew ? 'var(--good)' : 'var(--t2)',
          fontSize: 10,
          letterSpacing: '1.4px',
        }}
      >
        {pr.isNew ? '★ ' : ''}{pr.label}
        {pr.isNew ? ' · NEW' : pr.yearLabel ? ` · ${pr.yearLabel}` : ''}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: 30,
          marginTop: 4,
          letterSpacing: '-.015em',
          lineHeight: 0.95,
          fontVariantNumeric: 'tabular-nums',
          color: has ? 'var(--t0)' : 'var(--t3)',
        }}
      >
        {has ? pr.timeDisplay : '—'}
        {isLongest && has && (
          <small style={{ fontSize: '.4em', opacity: 0.5, fontWeight: 700, marginLeft: 3 }}>
            mi
          </small>
        )}
      </div>
      <div
        className="mono-sm"
        style={{
          color: 'var(--t2)',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '.4px',
          marginTop: 6,
        }}
      >
        {has && pr.sourceName && pr.dateISO
          ? `${pr.sourceName.toUpperCase().slice(0, 26)}${pr.sourceName.length > 26 ? '…' : ''} · ${formatShortMonth(pr.dateISO)}${pr.paceDisplay && !isLongest ? ` · ${pr.paceDisplay}` : ''}`
          : has
          ? 'IN YOUR LOG'
          : 'NOT YET SET'}
      </div>
    </div>
  );

  if (has && pr.activityId) {
    return (
      <Link href={`/runs/${pr.activityId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        {tile}
      </Link>
    );
  }
  // accentColor is consumed via borderLeft above; reference to avoid lint
  void accentColor;
  return tile;
}

function formatShortMonth(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

// ─────────────────────────────────────────────────────────────────────
// ROW 3 · RecentRunsCard (span 12)
// Last-7 runs feed — tabular layout with date / workout / dist / time /
// pace / hr / rpe columns. Each row links to /runs/[id].
// ─────────────────────────────────────────────────────────────────────

function RecentRunsCard({ data }: { data: LogData }) {
  const runs = data.recentRuns;
  return (
    <Card span={12} padding="18px 22px">
      <CardHeader>
        <CardLabel>RECENT RUNS · LAST {runs.length}</CardLabel>
        <CardPin variant="muted">
          {data.totalRunsYtd} YTD · VIEW ALL →
        </CardPin>
      </CardHeader>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          marginTop: 6,
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '90px 1fr 90px 90px 90px 90px 70px',
            gap: 14,
            padding: '6px 10px',
            fontFamily: 'var(--f-data)',
            fontSize: 9,
            letterSpacing: '1.2px',
            color: 'var(--t3)',
            fontWeight: 700,
            textTransform: 'uppercase',
            borderBottom: '1px solid var(--l4)',
          }}
        >
          <span>DATE</span>
          <span>WORKOUT</span>
          <span style={{ textAlign: 'right' }}>DIST</span>
          <span style={{ textAlign: 'right' }}>TIME</span>
          <span style={{ textAlign: 'right' }}>PACE</span>
          <span style={{ textAlign: 'right' }}>HR</span>
          <span style={{ textAlign: 'right' }}>RPE</span>
        </div>

        {runs.length === 0 ? (
          <div
            style={{
              padding: '32px 10px',
              fontFamily: 'var(--f-data)',
              fontSize: 12,
              color: 'var(--t3)',
              fontWeight: 600,
              letterSpacing: '.8px',
              textTransform: 'uppercase',
              textAlign: 'center',
            }}
          >
            No runs yet · connect Strava to populate
          </div>
        ) : (
          runs.map((r) => <RunFeedRow key={r.id} run={r} />)
        )}
      </div>

      <CardFoot
        left="Every run, scanned at a glance. Tap a row to open the per-run detail with map, splits, and heart-rate trace."
      />
    </Card>
  );
}

function RunFeedRow({ run }: { run: RunRow }) {
  const dateColor = run.kind === 'race' ? 'var(--good)' : 'var(--t1)';
  const paceColor =
    run.paceTone === 'good' ? 'var(--good)'
    : run.paceTone === 'corp' ? 'var(--corp)'
    : run.paceTone === 'warn' ? 'var(--warn)'
    : 'var(--t1)';
  const rpeColor =
    run.rpe == null ? 'var(--t3)'
    : run.rpe <= 3 ? 'var(--good)'
    : run.rpe <= 6 ? 'var(--t1)'
    : 'var(--warn)';
  const timeColor = run.kind === 'race' ? 'var(--good)' : 'var(--t1)';
  const dateLabel = run.isStar ? `${run.dateLabel} ★` : run.dateLabel;

  return (
    <Link
      href={`/runs/${run.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr 90px 90px 90px 90px 70px',
        gap: 14,
        padding: '12px 10px',
        borderBottom: '1px solid var(--l3)',
        alignItems: 'center',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <span
        className="mono-sm"
        style={{
          color: dateColor,
          fontSize: 10,
          letterSpacing: '1.4px',
        }}
      >
        {dateLabel}
      </span>
      <div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 600,
            fontSize: 14,
            lineHeight: 1.05,
            textTransform: 'uppercase',
            letterSpacing: '-.005em',
            color: 'var(--t0)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 420,
          }}
        >
          {run.name}
        </div>
        <div
          className="mono-sm"
          style={{
            color: 'var(--t3)',
            fontSize: 9,
            marginTop: 2,
          }}
        >
          {run.subLabel}
        </div>
      </div>
      <span style={cellStyle('var(--t1)', 'right')}>{run.distanceMi.toFixed(1)} mi</span>
      <span style={cellStyle(timeColor, 'right')}>{formatTime(run.movingTimeS)}</span>
      <span style={cellStyle(paceColor, 'right')}>{run.paceSPerMi > 0 ? `${formatPace(run.paceSPerMi)}/mi` : '—'}</span>
      <span style={cellStyle(run.avgHr == null ? 'var(--t3)' : 'var(--t1)', 'right')}>
        {run.avgHr != null ? `${Math.round(run.avgHr)} avg` : '—'}
      </span>
      <span style={cellStyle(rpeColor, 'right')}>{run.rpe ?? '—'}</span>
    </Link>
  );
}

function cellStyle(color: string, textAlign: 'left' | 'right' | 'center'): React.CSSProperties {
  return {
    fontFamily: 'var(--f-data)',
    fontSize: 11.5,
    color,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '.6px',
    textAlign,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────

function LogSkeleton() {
  return (
    <>
      <Row>
        <Card span={12} style={{ minHeight: 200 }}>
          <Skeleton height={160} />
        </Card>
      </Row>
      <Row>
        <Card span={6}><Skeleton height={260} /></Card>
        <Card span={6}><Skeleton height={260} /></Card>
      </Row>
      <Row>
        <Card span={12}><Skeleton height={320} /></Card>
      </Row>
    </>
  );
}
