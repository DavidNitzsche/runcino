'use client';

/**
 * /plan — full multi-month plan view.
 *
 * Renders one calendar grid per month for the next ~4 months. Each
 * cell shows the engine's prescribed work for that day: type label +
 * miles, or REST. Today is highlighted. Quality + long-run days get
 * accent colors. Past days fade slightly.
 *
 * Data: GET /api/plan-range?months=4 → array of CoachToday-shaped
 * day entries with date/type/label/distanceMi/isQuality/isLong/...
 *
 * The whole page is one Coach-driven surface — no inline numbers.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Topbar,
  Stage,
  Row,
  Card,
  CardHeader,
  CardLabel,
  EmptyState,
  Skeleton,
} from '@/app/components';
import { TopbarClock } from '@/app/components/TopbarClock';
import type { PlanRangeApiOk } from '@/app/api/plan-range/route';

type DayEntry = PlanRangeApiOk['days'][number];

function fmtPace(sPerMi: { lowS: number; highS: number } | number | null): string | null {
  if (!sPerMi) return null;
  const s = typeof sPerMi === 'number' ? sPerMi : Math.round((sPerMi.lowS + sPerMi.highS) / 2);
  const min = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${min}:${sec.toString().padStart(2, '0')}/mi`;
}

export default function PlanPage() {
  const [data, setData] = useState<PlanRangeApiOk | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/plan-range?months=4', { cache: 'no-store' });
        const json = (await res.json()) as PlanRangeApiOk | { ok: false; error: string };
        if (cancelled) return;
        if (!('ok' in json) || json.ok !== true) {
          setLoadError('error' in json ? json.error : 'Failed to load plan');
          return;
        }
        setData(json);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Stage>
      <Topbar activeTab="training" clock={<TopbarClock />} />

      <PlanGreet data={data} />

      {loadError && (
        <Row>
          <Card span={12}>
            <EmptyState
              variant="error"
              title="Couldn't load the plan"
              body={loadError}
              cta={<Link href="/training" className="btn btn-primary" style={{ textDecoration: 'none' }}>← BACK TO TRAINING</Link>}
            />
          </Card>
        </Row>
      )}

      {!data && !loadError && <PlanSkeleton />}

      {data && <PlanCalendars data={data} />}
    </Stage>
  );
}

function PlanGreet({ data }: { data: PlanRangeApiOk | null }) {
  const today = data?.today ?? null;
  const eyebrow = today
    ? `FULL PLAN · NEXT 4 MONTHS · ${new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase()}`
    : 'FULL PLAN · LOADING';
  const dayCount = data?.days.length ?? null;
  return (
    <div className="greet" style={{ display: 'block', padding: '14px 4px 24px' }}>
      <div className="hi" style={{
        fontFamily: 'var(--f-data)', fontSize: 11, letterSpacing: '2.4px',
        textTransform: 'uppercase', color: 'var(--t3)', fontWeight: 700,
      }}>{eyebrow}</div>
      <h1 style={{
        fontFamily: 'var(--f-display)', fontWeight: 600, fontSize: 48,
        letterSpacing: '-.02em', lineHeight: 1, textTransform: 'uppercase',
        marginTop: 6,
      }}>The whole plan</h1>
      <div style={{
        fontSize: 14, color: 'var(--t1)', marginTop: 8, maxWidth: '70ch',
      }}>
        Every day from this month through {data ? new Date(data.endISO + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'four months from now'} —
        same engine that prescribes today. {dayCount ? `${dayCount} days, ` : ''}same rest cadence, same quality cap.
        <Link href="/training" style={{ color: 'var(--coach)', marginLeft: 8, textDecoration: 'none' }}>← back to training</Link>
      </div>
    </div>
  );
}

function PlanSkeleton() {
  return (
    <Row>
      <Card span={12}>
        <Skeleton height={32} width="40%" />
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6,
          marginTop: 16,
        }}>
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} height={72} />
          ))}
        </div>
      </Card>
    </Row>
  );
}

function PlanCalendars({ data }: { data: PlanRangeApiOk }) {
  // Group days by YYYY-MM
  const byMonth = new Map<string, DayEntry[]>();
  for (const d of data.days) {
    const ym = d.date.slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym)!.push(d);
  }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <>
      {months.map(([ym, days]) => (
        <Row key={ym}>
          <MonthCard ym={ym} days={days} todayISO={data.today} />
        </Row>
      ))}
    </>
  );
}

const DOW_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function MonthCard({ ym, days, todayISO }: { ym: string; days: DayEntry[]; todayISO: string }) {
  const monthDate = new Date(ym + '-01T12:00:00Z');
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  // Compute leading blank cells so the month aligns to Mon→Sun.
  const firstDow = new Date(days[0].date + 'T12:00:00Z').getUTCDay(); // 0 = Sun
  const leadingBlanks = firstDow === 0 ? 6 : firstDow - 1;

  // Month totals.
  const totalMi = days.reduce((s, d) => s + d.distanceMi, 0);
  const quality = days.filter((d) => d.isQuality).length;
  const longs = days.filter((d) => d.isLong).length;
  const rests = days.filter((d) => d.type === 'rest').length;

  return (
    <Card span={12} padding="20px 22px">
      <CardHeader>
        <CardLabel>{monthLabel.toUpperCase()}</CardLabel>
        <span style={{
          fontFamily: 'var(--f-data)', fontSize: 11, color: 'var(--t2)',
          letterSpacing: '1.4px', fontWeight: 700, textTransform: 'uppercase',
        }}>
          {totalMi.toFixed(0)} MI · {quality} Q · {longs} LONG · {rests} REST
        </span>
      </CardHeader>

      {/* DOW header row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6,
        marginTop: 12, marginBottom: 6,
      }}>
        {DOW_LABELS.map((d) => (
          <div key={d} style={{
            fontFamily: 'var(--f-data)', fontSize: 9.5, letterSpacing: '1.4px',
            color: 'var(--t3)', fontWeight: 700, textAlign: 'center',
          }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6,
      }}>
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div key={`blank-${i}`} style={{ minHeight: 78 }} />
        ))}
        {days.map((d) => (
          <DayCellMonth key={d.date} day={d} todayISO={todayISO} />
        ))}
      </div>
    </Card>
  );
}

function DayCellMonth({ day, todayISO }: { day: DayEntry; todayISO: string }) {
  const isToday = day.date === todayISO;
  const isPast = day.date < todayISO;
  const isRest = day.type === 'rest';
  const strengthFocus = day.hasStrength
    ? (day.description?.toLowerCase().includes('lower') ? 'Lower + Core' : 'Upper + Core')
    : null;

  const typeColor = isToday
    ? 'var(--att)'
    : isRest
    ? 'var(--t3)'
    : day.isQuality
    ? 'var(--corp)'
    : day.isLong
    ? 'var(--good)'
    : 'var(--t2)';

  const dayN = parseInt(day.date.slice(8, 10), 10);
  const typeName = isRest
    ? 'Rest'
    : day.label.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div style={{
      borderRadius: 7,
      background: isToday ? 'rgba(209,168,90,.07)' : 'var(--l2)',
      border: `1px solid ${isToday ? 'rgba(209,168,90,.4)' : 'var(--l4)'}`,
      display: 'flex', flexDirection: 'column',
      minHeight: 90,
      overflow: 'hidden',
      opacity: isPast && !isToday ? 0.5 : 1,
    }}>
      {/* run body */}
      <div style={{ flex: 1, padding: '8px 10px 6px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span style={{
            fontFamily: 'var(--f-data)', fontSize: 11, fontWeight: 700,
            color: isToday ? 'var(--att)' : 'var(--t3)', lineHeight: 1,
          }}>{dayN}</span>
          {isToday && (
            <span style={{
              fontFamily: 'var(--f-data)', fontSize: 7, letterSpacing: '1px',
              color: 'var(--att)', fontWeight: 700,
            }}>TODAY</span>
          )}
        </div>
        {/* type name — big and colored */}
        <div style={{
          fontFamily: 'var(--f-data)', fontSize: 9.5, fontWeight: 700,
          letterSpacing: '.5px', textTransform: 'uppercase',
          color: typeColor, lineHeight: 1.2, marginBottom: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {typeName}
        </div>
        {/* distance hero */}
        {!isRest && day.distanceMi > 0 && (
          <div style={{
            fontFamily: 'var(--f-data)', fontSize: 24, fontWeight: 800,
            letterSpacing: '-.03em', color: 'var(--t0)', lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {day.distanceMi.toFixed(1)}
            <small style={{ fontSize: 10, fontWeight: 500, opacity: 0.4, marginLeft: 2 }}>mi</small>
          </div>
        )}
        {isRest && (
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 18, color: 'var(--t3)', lineHeight: 1 }}>—</div>
        )}
        {/* pace */}
        {!isRest && day.paceTargetSPerMi && (
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 8, color: 'var(--t3)', marginTop: 2 }}>
            {fmtPace(day.paceTargetSPerMi)}
          </div>
        )}
      </div>
      {/* strength strip — first-class session */}
      {strengthFocus && (
        <div style={{
          background: 'rgba(209,168,90,.1)',
          borderTop: '1px solid rgba(209,168,90,.25)',
          padding: '5px 10px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 9, lineHeight: 1 }}>🏋</span>
          <span style={{
            fontFamily: 'var(--f-data)', fontSize: 8, fontWeight: 700,
            color: 'var(--att)', letterSpacing: '.5px', textTransform: 'uppercase',
          }}>Strength</span>
          <span style={{
            fontFamily: 'var(--f-data)', fontSize: 7.5, fontWeight: 600,
            color: 'rgba(209,168,90,.65)', letterSpacing: '.3px', textTransform: 'uppercase',
            marginLeft: 'auto',
          }}>{strengthFocus}</span>
        </div>
      )}
    </div>
  );
}
