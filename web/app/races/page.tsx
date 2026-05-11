'use client';

/**
 * /races · Phase-3 port of the May 2026 mockup.
 *
 * Source mockup: designs/races-2026-05-09.html
 *
 * Architecture mirrors /overview/page.tsx and /training/page.tsx:
 *   - Single useEffect loads data via /api/races-page (server-side
 *     Coach bundle that wraps raceFitnessPrediction · taperDepth ·
 *     bodySystems · trajectory14wk plus the saved-race calendar).
 *   - Skeleton + error fallback via <EmptyState>.
 *   - Every coaching judgment threads through data.predictions /
 *     data.aRaceHero / data.latestRecap or a clearly-marked stub in
 *     data.ts.
 *
 * Sections (mapped 1:1 to the mockup):
 *   1. TopBar + Greet band (5 KPI tiles)
 *   2. A-RACE hero (span-8, race wash, gradient) + LATEST RESULT recap
 *      (span-4)
 *   3. 2026 SEASON · full-width year timeline with race markers
 *   4. UPCOMING list (span-6) + 2026 RESULTS list (span-6)
 *
 * Sub-routes /races/new + /races/[slug] are NOT touched — they ship as
 * their own page.tsx files and continue to serve the existing race-plan
 * creation + detail experience.
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
  CardPin,
  CardFoot,
  Greet,
  GreetId,
  GreetState,
  GreetTile,
  EmptyState,
  Skeleton,
} from '@/app/components';
import { useActivities } from '@/lib/strava-activities';
import type { SavedRace } from '@/lib/storage-types';
import { loadRacesData, type RacesData, type SeasonMarker, formatShortDate } from './data';

export default function RacesPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [data, setData] = useState<RacesData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { activities } = useActivities();

  useEffect(() => {
    setNow(new Date());
  }, []);

  useEffect(() => {
    if (!now) return;
    let cancelled = false;
    setLoadError(null);
    loadRacesData(activities)
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
  }, [now, activities]);

  const clock = now ? formatTopbarClock(now) : null;

  return (
    <Stage>
      <Topbar
        activeTab="races"
        clock={clock !== null ? clock : <Skeleton width={140} height={12} />}
      />

      <RacesGreet data={data} />

      {loadError && (
        <Row>
          <Card span={12}>
            <EmptyState
              variant="error"
              title="Couldn't load Races"
              body={loadError}
            />
          </Card>
        </Row>
      )}

      {data ? (
        <RacesBody data={data} />
      ) : (
        !loadError && <RacesSkeleton />
      )}
    </Stage>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Greet band — 5 KPI tiles oriented around the race calendar
// ─────────────────────────────────────────────────────────────────────

function RacesGreet({ data }: { data: RacesData | null }) {
  if (!data) {
    return (
      <Greet>
        <GreetId
          eyebrow={<Skeleton width={260} height={11} />}
          title={<Skeleton width={160} height={48} />}
        />
        <GreetState>
          {[0, 1, 2, 3, 4].map((i) => (
            <GreetTile key={i} eyebrow="—" value={<Skeleton width={56} height={20} />} />
          ))}
        </GreetState>
      </Greet>
    );
  }

  const { races, aRaceHero, latestRecap } = data;
  const nextAName = races.nextA?.meta.name ?? null;
  const daysToA = races.daysToNextA;
  const daysToB = races.daysToNextB;
  const totalRun = races.past.length;
  const totalAhead = races.upcoming.length;
  const prCount = races.past.filter((r) => r.actualResult?.isPR).length;

  // Eyebrow surfaces just the season-position anchor — short form. VDOT belongs
  // on /training (the page that uses it to set pace zones), not /races.
  // Race name is abbreviated (e.g. "AFC HALF") to match the timeline.
  const eyebrowParts: string[] = ['2026 SEASON'];
  if (nextAName && daysToA != null) {
    eyebrowParts.push(`${daysToA} DAYS TO ${shortRaceName(nextAName)}`);
  }

  return (
    <Greet>
      <GreetId
        eyebrow={eyebrowParts.join(' · ')}
        title="RACES"
      />
      <GreetState>
        <GreetTile
          variant="race"
          eyebrow="NEXT A-RACE"
          value={daysToA != null ? String(daysToA) : '—'}
          unit={daysToA != null ? 'D' : undefined}
          delta={nextAName ? nextAName.toUpperCase() : 'NONE SET'}
          deltaColor="var(--race)"
        />
        <GreetTile
          variant={daysToB != null ? 'coach' : 'default'}
          eyebrow="UP NEXT · B"
          value={daysToB != null ? String(daysToB) : '—'}
          unit={daysToB != null ? 'D' : undefined}
          delta={races.nextB?.meta.name?.toUpperCase() ?? 'NO TUNE-UP'}
        />
        <GreetTile
          eyebrow="UPCOMING"
          value={String(totalAhead)}
          unit="RACES"
          delta={races.upcoming.length > 0 ? upcomingRangeLabel(races.upcoming) : '—'}
        />
        <GreetTile
          variant="good"
          eyebrow="RUN THIS YEAR"
          value={String(totalRun)}
          unit="RACES"
          delta={`${prCount} PR${prCount === 1 ? '' : 'S'} · ${data.season.summary.countRun}/${data.season.summary.countRun + data.season.summary.countAhead}`}
          deltaColor="var(--good)"
        />
        <GreetTile
          variant="amber"
          eyebrow="LATEST RESULT"
          value={latestRecap?.finishDisplay ?? '—'}
          delta={latestRecap ? `${latestRecap.name.toUpperCase()} · ${latestRecap.shortDate}` : 'NO RESULTS YET'}
        />
      </GreetState>
    </Greet>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────────

function RacesBody({ data }: { data: RacesData }) {
  return (
    <>
      {/* ROW 1 — A-RACE hero (8) + LATEST RESULT recap (4) */}
      <Row>
        <ARaceHeroCard data={data} />
        <LatestRecapCard data={data} />
      </Row>

      {/* ROW 2 — 2026 SEASON full-width timeline */}
      <Row>
        <SeasonTimelineCard data={data} />
      </Row>

      {/* ROW 3 — UPCOMING (6) + RESULTS (6) */}
      <Row>
        <UpcomingListCard data={data} />
        <ResultsListCard data={data} />
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// A-RACE hero (race wash, gradient · race-imminent feel)
// ─────────────────────────────────────────────────────────────────────

function ARaceHeroCard({ data }: { data: RacesData }) {
  const hero = data.aRaceHero;

  if (!hero) {
    return (
      <Card span={8} padding="32px 36px" wash="race" style={{ minHeight: 380 }}>
        <CardHeader>
          <CardLabel color="var(--race)">GOAL · A-RACE</CardLabel>
          <CardPin variant="muted">NO A-RACE SET</CardPin>
        </CardHeader>
        <div className="t-display" style={{ marginTop: 14, textTransform: 'uppercase', fontSize: 56 }}>
          Pick your<br />goal race
        </div>
        <div className="t-body" style={{ color: 'var(--t1)', marginTop: 8, maxWidth: 540 }}>
          Add an A-race to anchor the macrocycle. The Coach builds every
          workout toward the date you set.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 18 }}>
          <Link href="/races/new" className="btn-flat btn-primary">+ ADD RACE</Link>
        </div>
      </Card>
    );
  }

  // Pace toward — color-code by confidence.
  const headroomColor = hero.headroomSPerMi >= 10
    ? 'var(--good)'
    : hero.headroomSPerMi >= 0
    ? 'var(--milestone)'
    : 'var(--warn)';
  const headroomSign = hero.headroomSPerMi >= 0 ? '+' : '−';

  return (
    <Card
      span={8}
      wash="race"
      padding="32px 36px"
      style={{ minHeight: 380 }}
    >
      <CardHeader>
        <div
          style={{
            fontFamily: 'var(--f-data)',
            fontSize: 11,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: 'var(--race)',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: 'var(--race)',
              boxShadow: '0 0 0 3px rgba(255,87,34,.22)',
            }}
          />
          GOAL · A-RACE
        </div>
        <CardPin variant="race">{hero.daysToRace} DAYS</CardPin>
      </CardHeader>

      <h2
        className="t-display"
        style={{
          textTransform: 'uppercase',
          marginTop: 14,
          color: 'var(--t0)',
          fontSize: 64,
        }}
      >
        {hero.name}
      </h2>

      <div
        style={{
          fontFamily: 'var(--f-data)',
          fontSize: 11,
          letterSpacing: '.12em',
          color: 'var(--t1)',
          fontWeight: 500,
          textTransform: 'uppercase',
          marginTop: 14,
        }}
      >
        {hero.longDateLine}
      </div>

      {/* Quad — GOAL / FITNESS / HEADROOM / BUILD STARTS */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 20,
          paddingTop: 20,
          marginTop: 20,
          borderTop: '1px solid var(--l4)',
        }}
      >
        <HeroStat
          label="GOAL TIME"
          value={hero.goalTime}
          valueColor="var(--race)"
          sub={hero.goalPace}
        />
        <HeroStat
          label="FITNESS PREDICTS"
          value={hero.fitnessPredicts}
          valueColor="var(--good)"
          sub={`${hero.fitnessPace} · ${hero.vdotLabel}`}
        />
        <HeroStat
          label="HEADROOM"
          value={`${headroomSign}${Math.abs(Math.round(hero.headroomSPerMi))}`}
          valueColor={headroomColor}
          unit="s/mi"
          sub={`CONFIDENCE ${hero.confidenceLabel}`}
        />
        <HeroStat
          label="BUILD STARTS"
          value={hero.buildStartsInDays > 0 ? String(hero.buildStartsInDays) : 'NOW'}
          unit={hero.buildStartsInDays > 0 ? 'd' : ''}
          sub={hero.buildStartsInDays > 0 ? `${hero.buildStartsDateLabel} · BASE PHASE` : 'IN BUILD PHASE'}
        />
      </div>

      {/* UP NEXT B-race inset · only renders when a sooner B-race exists */}
      {hero.upNext && (
        <div
          style={{
            marginTop: 18,
            padding: '12px 14px',
            background: 'rgba(255,87,34,.06)',
            border: '1px solid rgba(255,87,34,.30)',
            borderLeft: '3px solid var(--race)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div
              style={{
                fontFamily: 'var(--f-data)',
                fontSize: 10,
                letterSpacing: '.12em',
                color: 'var(--race)',
                fontWeight: 500,
                textTransform: 'uppercase',
              }}
            >
              ▶ UP NEXT · B-RACE · SOONER
            </div>
            <div className="t-eyebrow" style={{ color: 'var(--t3)' }}>
              {hero.upNext.shortDate}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 10,
              marginTop: 6,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--f-display)',
                fontWeight: 600,
                fontSize: 22,
                letterSpacing: '-.02em',
                lineHeight: 1,
                textTransform: 'uppercase',
              }}
            >
              {hero.upNext.name} · {hero.upNext.tuneupTag}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span
                style={{
                  fontFamily: 'var(--f-display)',
                  fontWeight: 700,
                  fontSize: 30,
                  letterSpacing: '-.02em',
                  lineHeight: 1,
                  color: 'var(--race)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {hero.upNext.daysToRace}
              </span>
              <span
                style={{
                  fontFamily: 'var(--f-data)',
                  fontSize: 10,
                  letterSpacing: '1.4px',
                  color: 'var(--race)',
                  fontWeight: 700,
                }}
              >
                D
              </span>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 18 }}>
        <Link href={`/races/${hero.slug}`} className="btn-flat btn-primary">
          ▶ OPEN RACE PLAN
        </Link>
        <Link href={`/races/${hero.slug}`} className="btn-flat btn-secondary">
          EDIT GOAL
        </Link>
      </div>
    </Card>
  );
}

function HeroStat({
  label,
  value,
  valueColor,
  unit,
  sub,
}: {
  label: string;
  value: string;
  valueColor?: string;
  unit?: string;
  sub: string;
}) {
  return (
    <div>
      <div className="t-eyebrow">{label}</div>
      <div
        className="t-section"
        style={{
          color: valueColor,
          marginTop: 6,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
        {unit && (
          <small
            style={{
              fontSize: '.32em',
              fontWeight: 700,
              opacity: 0.6,
              marginLeft: 6,
            }}
          >
            {unit}
          </small>
        )}
      </div>
      <div className="t-eyebrow" style={{ color: 'var(--t2)', marginTop: 5 }}>
        {sub}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// LATEST RESULT recap (right column of row 1)
// ─────────────────────────────────────────────────────────────────────

function LatestRecapCard({ data }: { data: RacesData }) {
  const recap = data.latestRecap;

  if (!recap) {
    return (
      <Card span={4}>
        <CardHeader>
          <CardLabel>LATEST RESULT</CardLabel>
          <CardPin variant="muted">—</CardPin>
        </CardHeader>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 700,
            fontSize: 26,
            textTransform: 'uppercase',
            marginTop: 8,
            color: 'var(--t2)',
          }}
        >
          No race results yet
        </div>
        <div className="t-body" style={{ color: 'var(--t1)', marginTop: 6 }}>
          When you finish your first race, the recap surfaces here with
          the Coach Read, splits, conditions, and HR breakdown.
        </div>
      </Card>
    );
  }

  return (
    <Card span={4} style={{ display: 'flex', flexDirection: 'column' }}>
      <CardHeader>
        <CardLabel>LATEST RESULT · {recap.daysAgo} DAYS AGO</CardLabel>
        {recap.pinLabel && (
          <CardPin variant={recap.pinVariant}>{recap.pinLabel}</CardPin>
        )}
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: 32,
          letterSpacing: '-.02em',
          lineHeight: 1,
          textTransform: 'uppercase',
          marginTop: 6,
        }}
      >
        {recap.name}
      </div>
      <div className="t-eyebrow" style={{ marginTop: 6 }}>
        {recap.shortDate} · {recap.distanceLabel}
      </div>

      {/* Finish + Avg pace */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          paddingTop: 14,
          marginTop: 14,
          borderTop: '1px solid var(--l4)',
        }}
      >
        <div>
          <div className="t-eyebrow">FINISH</div>
          <div className="t-section" style={{ color: recap.isPR ? 'var(--good)' : 'var(--t0)', marginTop: 6 }}>
            {recap.finishDisplay}
          </div>
          <div
            className="t-eyebrow"
            style={{
              color: recap.isPR ? 'var(--good)' : 'var(--t2)',
              marginTop: 5,
            }}
          >
            {recap.prLabel}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="t-eyebrow">AVG PACE</div>
          <div className="t-section" style={{ marginTop: 6 }}>
            {recap.paceDisplay}
            <small style={{ fontSize: '.32em', fontWeight: 700, opacity: 0.55, marginLeft: 6 }}>
              /mi
            </small>
          </div>
          {recap.splitLabel && (
            <div
              className="t-eyebrow"
              style={{
                color: recap.splitNegative ? 'var(--good)' : 'var(--warn)',
                marginTop: 5,
              }}
            >
              {recap.splitNegative ? '▼' : '▲'} {recap.splitLabel}
            </div>
          )}
        </div>
      </div>

      {/* Coach Read · synthesized until Stage R lands */}
      <div
        style={{
          marginTop: 14,
          padding: '12px 14px',
          background: 'var(--l2)',
          borderRadius: 8,
        }}
      >
        <div className="t-eyebrow">COACH READ</div>
        <div className="t-body" style={{ color: 'var(--t1)', marginTop: 4 }}>
          {recap.coachRead}
        </div>
      </div>

      {/* 3-tile stat strip — Place / Conditions / Avg HR. Each tile
          conditionally renders; absent data → tile drops out rather than
          showing a fake placeholder. */}
      <RecapStats recap={recap} />

      <CardFoot
        left={<Link href={`/races/${recap.slug}`} style={{ color: 'inherit' }}>SEE FULL RECAP →</Link>}
        right={
          recap.isPR ? (
            <span className="delta up">▲ AEROBIC PROVEN</span>
          ) : recap.pinLabel === 'BEAT' ? (
            <span className="delta up">▲ GOAL BEAT</span>
          ) : null
        }
      />
    </Card>
  );
}

function RecapStats({ recap }: { recap: NonNullable<RacesData['latestRecap']> }) {
  // Count how many tiles will render so we can pick the grid column count.
  const tiles: Array<React.ReactNode> = [];

  if (recap.place) {
    tiles.push(
      <div
        key="place"
        style={{
          padding: '10px 12px',
          background: 'var(--l2)',
          borderRadius: 6,
        }}
      >
        <div className="t-eyebrow">PLACE</div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-.01em',
            lineHeight: 1,
            marginTop: 4,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {recap.place}
        </div>
        {recap.placeSub && (
          <div className="t-eyebrow" style={{ color: 'var(--good)', marginTop: 3 }}>
            {recap.placeSub}
          </div>
        )}
      </div>,
    );
  }

  if (recap.conditions) {
    tiles.push(
      <div
        key="conditions"
        style={{ padding: '10px 12px', background: 'var(--l2)', borderRadius: 6 }}
      >
        <div className="t-eyebrow">CONDITIONS</div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-.01em',
            lineHeight: 1,
            marginTop: 4,
          }}
        >
          {recap.conditions.value}
          <small style={{ fontSize: '.4em', opacity: 0.55, fontWeight: 700, marginLeft: 3 }}>
            {recap.conditions.unit}
          </small>
        </div>
        <div className="t-eyebrow" style={{ color: 'var(--t2)', marginTop: 3 }}>
          {recap.conditions.sub}
        </div>
      </div>,
    );
  }

  if (recap.avgHr) {
    tiles.push(
      <div
        key="hr"
        style={{ padding: '10px 12px', background: 'var(--l2)', borderRadius: 6 }}
      >
        <div className="t-eyebrow">AVG HR</div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-.01em',
            lineHeight: 1,
            marginTop: 4,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {recap.avgHr.value}
          <small style={{ fontSize: '.4em', opacity: 0.55, fontWeight: 700, marginLeft: 3 }}>
            BPM
          </small>
        </div>
        <div className="t-eyebrow" style={{ color: 'var(--corp)', marginTop: 3 }}>
          {recap.avgHr.pctMax}% MAX · {recap.avgHr.zone}
        </div>
      </div>,
    );
  }

  if (tiles.length === 0) return null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${tiles.length}, 1fr)`,
        gap: 8,
        marginTop: 14,
      }}
    >
      {tiles}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SEASON timeline (full-width)
// ─────────────────────────────────────────────────────────────────────

function SeasonTimelineCard({ data }: { data: RacesData }) {
  const s = data.season;
  const todayPct = s.todayPct;

  // Past portion gradient (from year-start up to today).
  const pastWidthPct = todayPct;

  return (
    <Card span={12} padding="22px 26px">
      <CardHeader>
        <div>
          <CardLabel>{s.year} SEASON · 12 MONTHS</CardLabel>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: '-.02em',
              lineHeight: 1,
              marginTop: 4,
              textTransform: 'uppercase',
            }}
          >
            {s.summary.countRun} races run · {s.summary.countAhead} ahead · {s.summary.countA} A-race target
            {s.summary.countA === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {s.summary.countA > 0 && (
            <CardPin variant="race">{s.summary.countA}A</CardPin>
          )}
          {s.summary.countB > 0 && (
            <CardPin variant="blue">{s.summary.countB}B</CardPin>
          )}
          {s.summary.countC > 0 && (
            <CardPin variant="muted">{s.summary.countC}C</CardPin>
          )}
        </div>
      </CardHeader>

      {/* Timeline track with race dots above + month labels below */}
      <div
        style={{
          position: 'relative',
          marginTop: 28,
          padding: '48px 0 110px',
        }}
      >
        {/* TODAY marker above the track */}
        <div
          style={{
            position: 'absolute',
            left: `${todayPct}%`,
            top: 8,
            fontFamily: 'var(--f-data)',
            fontSize: 10,
            letterSpacing: '.12em',
            color: 'var(--att)',
            fontWeight: 600,
            transform: 'translateX(-50%)',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          ▼ TODAY · {s.todayShort}
        </div>
        <div
          style={{
            position: 'absolute',
            left: `${todayPct}%`,
            top: 26,
            height: 30,
            width: 2,
            background: 'var(--att)',
          }}
        />

        {/* Track baseline */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 60,
            height: 4,
            background: 'var(--l3)',
            borderRadius: 2,
          }}
        />
        {/* Past portion gradient */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${pastWidthPct}%`,
            top: 60,
            height: 4,
            background: 'linear-gradient(90deg, rgba(0,143,236,.45), rgba(0,143,236,.7))',
            borderRadius: 2,
          }}
        />

        {/* Race markers · stagger labels above/below if dots are close. */}
        {s.markers.map((m, i) => (
          <SeasonMarkerDot key={m.slug} marker={m} stagger={i % 2} />
        ))}
      </div>

      {/* Months strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: 0,
          fontFamily: 'var(--f-data)',
          fontSize: 10,
          letterSpacing: '.12em',
          color: 'var(--t3)',
          fontWeight: 500,
          marginTop: 8,
          textTransform: 'uppercase',
          borderTop: '1px solid var(--l4)',
          paddingTop: 10,
        }}
      >
        {MONTHS_SHORT.map((mShort, idx) => (
          <span
            key={mShort}
            style={{
              textAlign: 'center',
              color: monthHighlight(idx, s),
            }}
          >
            {mShort}
            {monthHasStar(idx, s) && ' ★'}
          </span>
        ))}
      </div>
    </Card>
  );
}

const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function monthHighlight(monthIdx: number, season: RacesData['season']): string {
  // If TODAY falls in this month, highlight amber.
  const todayMonthIdx = Math.floor((season.todayPct / 100) * 12);
  if (todayMonthIdx === monthIdx) return 'var(--att)';
  // If there's a PR-anchor race in this month, green-tint.
  const hasPR = season.markers.some((m) => {
    const monthOfMarker = Math.floor((m.pct / 100) * 12);
    return monthOfMarker === monthIdx && m.tone === 'pr';
  });
  if (hasPR) return 'var(--good)';
  // If the A-race is in this month, race-orange.
  const hasA = season.markers.some((m) => {
    const monthOfMarker = Math.floor((m.pct / 100) * 12);
    return monthOfMarker === monthIdx && m.tone === 'upcoming-a';
  });
  if (hasA) return 'var(--race)';
  return 'var(--t3)';
}

function monthHasStar(monthIdx: number, season: RacesData['season']): boolean {
  return season.markers.some((m) => {
    const monthOfMarker = Math.floor((m.pct / 100) * 12);
    return monthOfMarker === monthIdx && m.tone === 'pr';
  });
}

/**
 * Abbreviate long race names for the timeline. Full name → short form that
 * fits the column. Hits common race-name patterns; falls back to first-3-words.
 */
function shortRaceName(name: string): string {
  const map: Record<string, string> = {
    'Americas Finest City Half': 'AFC HALF',
    'Mission Bay 10K': 'MISSION BAY',
    'Big Sur Marathon': 'BIG SUR',
    'Sombrero Half Marathon': 'SOMBRERO HALF',
    'Surf City 10K': 'SURF CITY',
    'Disney Princess Half': 'DISNEY HALF',
    'Disney 5K': 'DISNEY 5K',
  };
  if (map[name]) return map[name];
  // Generic fallback: drop "Marathon" / "Half" / "Half Marathon" suffixes
  // and cap at 14 chars so blocks stay uniform.
  const stripped = name
    .replace(/\s+(Half\s+Marathon|Marathon|Half|10K|5K)$/i, '')
    .toUpperCase();
  return stripped.length > 14 ? stripped.slice(0, 13) + '…' : stripped;
}

function SeasonMarkerDot({ marker }: { marker: SeasonMarker; stagger?: number }) {
  const sizeMap: Record<SeasonMarker['tone'], number> = {
    pr: 14,
    past: 10,
    'upcoming-a': 22,
    'upcoming-b': 12,
    'upcoming-c': 10,
    today: 12,
  };
  const colorMap: Record<SeasonMarker['tone'], string> = {
    pr: 'var(--good)',
    past: 'var(--corp)',
    'upcoming-a': 'var(--race)',
    'upcoming-b': 'var(--corp)',
    'upcoming-c': 'var(--t3)',
    today: 'var(--att)',
  };
  const size = sizeMap[marker.tone];
  const color = colorMap[marker.tone];
  const isUpcoming = marker.tone.startsWith('upcoming');
  const isA = marker.tone === 'upcoming-a';
  const isPR = marker.tone === 'pr';

  const dotTop = 60 - Math.floor(size / 2) + 2;
  // All labels pinned to one row at the same height — no more staggered chaos.
  // Block has fixed width (90px) so long names don't push their column wider
  // than short ones, keeping the visual grid uniform.
  const LABEL_TOP = 82;
  const BLOCK_W = 90;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: `${marker.pct}%`,
          top: dotTop,
          width: size,
          height: size,
          borderRadius: '50%',
          background: isUpcoming ? 'transparent' : color,
          border: isUpcoming
            ? `2px dashed ${color}`
            : `${isA ? 3 : 2}px solid var(--l1)`,
          transform: 'translateX(-50%)',
          boxShadow: isA
            ? '0 0 18px rgba(255,87,34,.65)'
            : isPR
            ? '0 0 8px rgba(62,189,65,.45)'
            : 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: `${marker.pct}%`,
          top: LABEL_TOP,
          transform: 'translateX(-50%)',
          width: BLOCK_W,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {/* Line 1 · race name (abbreviated to fit) */}
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 11,
            fontWeight: isA ? 700 : 600,
            letterSpacing: '-.005em',
            textTransform: 'uppercase',
            color,
            lineHeight: 1.15,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {shortRaceName(marker.name)}{isPR ? ' ★' : ''}
        </div>
        {/* Line 2 · date · always present, mono */}
        <div
          style={{
            fontFamily: 'var(--f-data)',
            fontSize: 8.5,
            letterSpacing: '.4px',
            color: 'var(--t3)',
            fontWeight: 700,
            marginTop: 3,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {marker.shortDate}
        </div>
        {/* Line 3 · result or goal · always present (use em dash for empty) */}
        <div
          style={{
            fontFamily: 'var(--f-data)',
            fontSize: 9,
            color,
            fontWeight: 700,
            marginTop: 2,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {marker.caption || '—'}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// UPCOMING list
// ─────────────────────────────────────────────────────────────────────

function UpcomingListCard({ data }: { data: RacesData }) {
  const list = data.races.upcoming;
  const rangeLabel = upcomingRangeLabel(list);

  if (list.length === 0) {
    return (
      <Card span={6}>
        <CardHeader>
          <CardLabel>UPCOMING</CardLabel>
          <CardPin variant="muted">NONE</CardPin>
        </CardHeader>
        <div className="t-body" style={{ color: 'var(--t1)', marginTop: 10 }}>
          No upcoming races. Add one to anchor the macrocycle.
        </div>
        <div style={{ marginTop: 18 }}>
          <Link href="/races/new" className="btn-flat btn-primary">+ ADD RACE</Link>
        </div>
      </Card>
    );
  }

  return (
    <Card span={6}>
      <CardHeader>
        <CardLabel>UPCOMING · {list.length} RACE{list.length === 1 ? '' : 'S'}</CardLabel>
        {rangeLabel && <CardPin variant="amber">{rangeLabel}</CardPin>}
      </CardHeader>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
        {list.map((r, i) => (
          <UpcomingRow key={r.slug} race={r} data={data} isFirst={i === 0} isLast={i === list.length - 1} />
        ))}
      </div>
    </Card>
  );
}

function UpcomingRow({ race, data, isLast }: { race: SavedRace; data: RacesData; isFirst?: boolean; isLast?: boolean }) {
  const priority: 'A' | 'B' | 'C' = race.meta.priority ?? 'A';
  const daysToRace = data.predictions.get(race.slug)?.daysToRace
    ?? Math.max(0, Math.round((Date.parse(race.meta.date + 'T12:00:00Z') - Date.parse(data.today + 'T12:00:00Z')) / 86_400_000));
  const isA = priority === 'A';
  const isB = priority === 'B';

  const railColor = isA ? 'var(--race)' : isB ? 'var(--corp)' : 'var(--t3)';
  const letterColor = railColor;
  const dayColor = isA ? 'var(--race)' : 'var(--t3)';
  const distLabel = distanceLabelForRow(race.meta.distanceMi);

  const subline = buildUpcomingSubline(race, daysToRace, priority);
  const dayLabel = dayOfWeekShort(race.meta.date) + (isWeekend(race.meta.date) ? ' AM' : '');

  return (
    <>
      <Link
        href={`/races/${race.slug}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '48px 1fr auto',
          gap: 14,
          padding: '14px 16px',
          // Subtle wash only on the A-race row · others use the card surface
          // so the list reads as one cohesive block with priority accents on
          // the left rail instead of floating chiclets.
          background: isA
            ? 'linear-gradient(90deg, rgba(255,87,34,.10), transparent 70%)'
            : 'transparent',
          borderLeft: `${isA ? 4 : 3}px solid ${railColor}`,
          // Divider between rows (not on the last row)
          borderBottom: isLast ? 'none' : '1px solid var(--l4)',
          alignItems: 'center',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: isA ? 36 : 32,
            fontWeight: 700,
            color: letterColor,
            lineHeight: 1,
          }}
        >
          {priority}
        </div>
        <div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: isA ? 20 : 18,
              fontWeight: isA ? 700 : 600,
              textTransform: 'uppercase',
              letterSpacing: '-.005em',
            }}
          >
            {race.meta.name}
          </div>
          <div
            className="mono-sm"
            style={{
              marginTop: 3,
              color: 'var(--t2)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
            }}
          >
            {formatShortDate(race.meta.date)} · {distLabel} · {subline}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: isA ? 28 : 24,
              fontWeight: 700,
              lineHeight: 1,
              color: isA ? 'var(--race)' : 'var(--t0)',
            }}
          >
            {daysToRace}
            <small style={{ fontSize: '.42em', color: isA ? 'var(--race)' : 'var(--t3)' }}>d</small>
          </div>
          <div
            className="mono-sm"
            style={{
              fontSize: 8.5,
              color: dayColor,
              marginTop: 3,
              fontWeight: 700,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
            }}
          >
            {dayLabel}
          </div>
        </div>
      </Link>
    </>
  );
}

function buildUpcomingSubline(
  race: SavedRace,
  daysToRace: number,
  priority: 'A' | 'B' | 'C',
): string {
  // Goal/role line — surface goal for A & B; for C we surface "WORKOUT EFFORT".
  if (priority === 'A') {
    return `GOAL ${race.meta.goalDisplay} · PEAK`;
  }
  if (priority === 'B') {
    return 'TUNE-UP';
  }
  return daysToRace < 60 ? 'WORKOUT EFFORT' : 'C-EFFORT';
}

function synthesizeContextLine(race: SavedRace, data: RacesData): string | null {
  // TODO: wire to Coach.trajectory14wk + plan_templates.ts phase boundaries.
  // For now we surface a heuristic: days-to-race + assumed phase. The A-race
  // gets a post-race recovery + reverse-taper hint; B-races get a build-block
  // hint; C-races get nothing.
  const priority: 'A' | 'B' | 'C' = race.meta.priority ?? 'A';
  const daysToRace = Math.round(
    (Date.parse(race.meta.date + 'T12:00:00Z') - Date.parse(data.today + 'T12:00:00Z')) / 86_400_000,
  );
  if (priority === 'A') {
    return null; // The A-race hero already explains the build/peak/taper.
  }
  if (priority === 'B') {
    if (daysToRace < 30) return `${daysToRace} days of build · base→build phase transition`;
    if (daysToRace < 60) return `${daysToRace} days of build · peak block`;
    return `${daysToRace} days of build`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// 2026 RESULTS list
// ─────────────────────────────────────────────────────────────────────

function ResultsListCard({ data }: { data: RacesData }) {
  // Filter to current-year past races; mirror the mockup's "5 races" panel.
  const year = data.season.year;
  const inYear = data.races.past.filter((r) =>
    r.meta.date.startsWith(String(year)),
  );
  const prCount = inYear.filter((r) => r.actualResult?.isPR).length;

  if (inYear.length === 0) {
    return (
      <Card span={6}>
        <CardHeader>
          <CardLabel>{year} RESULTS</CardLabel>
          <CardPin variant="muted">NONE</CardPin>
        </CardHeader>
        <div className="t-body" style={{ color: 'var(--t1)', marginTop: 10 }}>
          No race results recorded this year yet.
        </div>
      </Card>
    );
  }

  return (
    <Card span={6}>
      <CardHeader>
        <CardLabel>{year} RESULTS · {inYear.length} RACE{inYear.length === 1 ? '' : 'S'}</CardLabel>
        {prCount > 0 && (
          <CardPin variant="green">{prCount} PR{prCount === 1 ? '' : 's'}</CardPin>
        )}
      </CardHeader>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
        {inYear.map((r, i) => (
          <ResultRow key={r.slug} race={r} isLast={i === inYear.length - 1} />
        ))}
      </div>
    </Card>
  );
}

function ResultRow({ race, isLast }: { race: SavedRace; isLast?: boolean }) {
  const priority: 'A' | 'B' | 'C' = race.meta.priority ?? 'A';
  const result = race.actualResult ?? null;
  const isA = priority === 'A';
  const isB = priority === 'B';
  const isPR = !!result?.isPR;

  const railColor = isA ? 'var(--race)' : isB ? 'var(--corp)' : 'var(--t3)';
  const distLabel = distanceLabelForRow(race.meta.distanceMi);
  const subline = buildResultSubline(race);

  const finishColor = isPR ? 'var(--good)' : isA ? 'var(--good)' : 'var(--t1)';
  const finishDisplay = result?.finishDisplay ?? '—';
  const paceDisplay = result?.paceDisplay ? `${result.paceDisplay}/MI` : '';

  return (
    <Link
      href={`/races/${race.slug}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '48px 1fr auto',
        gap: 14,
        padding: '14px 16px',
        background: isA
          ? 'linear-gradient(90deg, rgba(255,87,34,.08), transparent 70%)'
          : 'transparent',
        borderLeft: `3px solid ${railColor}`,
        borderBottom: isLast ? 'none' : '1px solid var(--l4)',
        alignItems: 'center',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 32,
          fontWeight: 700,
          color: railColor,
          lineHeight: 1,
        }}
      >
        {priority}
      </div>
      <div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 18,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '-.005em',
          }}
        >
          {race.meta.name}
        </div>
        <div
          className="mono-sm"
          style={{
            marginTop: 3,
            color: 'var(--t2)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
          }}
        >
          {formatShortDate(race.meta.date)} · {distLabel} · {subline}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1,
            color: finishColor,
          }}
        >
          {finishDisplay}
          {isPR && ' ★'}
        </div>
        <div
          className="mono-sm"
          style={{
            fontSize: 8.5,
            color: isPR ? 'var(--good)' : 'var(--t3)',
            marginTop: 3,
            fontWeight: 700,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
          }}
        >
          {isPR ? `PR · ${paceDisplay}` : paceDisplay || 'NO RESULT'}
        </div>
      </div>
    </Link>
  );
}

function buildResultSubline(race: SavedRace): string {
  // TODO: wire to Coach.coachRead() (Stage R) for race-classification
  // labels like "SENTIMENTAL EFFORT" / "PR-PURSUIT" / "BIG SUR PREP".
  // Until then we synthesize from priority + distance + course gain.
  const priority: 'A' | 'B' | 'C' = race.meta.priority ?? 'A';
  const gainFt = race.plan?.race?.total_gain_ft ?? 0;
  if (gainFt >= 2000) return 'HILLY COURSE';
  if (priority === 'A') return 'A-RACE';
  if (priority === 'B') return 'TUNE-UP';
  return 'WORKOUT EFFORT';
}

// ─────────────────────────────────────────────────────────────────────
// Skeleton fallback
// ─────────────────────────────────────────────────────────────────────

function RacesSkeleton() {
  return (
    <>
      <Row>
        <Card span={8} padding="32px 36px" style={{ minHeight: 380 }} wash="race">
          <Skeleton height={14} width="30%" />
          <Skeleton height={64} width="60%" />
          <Skeleton height={14} width="60%" />
          <Skeleton height={140} />
        </Card>
        <Card span={4}>
          <Skeleton height={14} width="60%" />
          <Skeleton height={36} width="80%" />
          <Skeleton height={120} />
        </Card>
      </Row>
      <Row>
        <Card span={12} padding="22px 26px">
          <Skeleton height={36} width="40%" />
          <Skeleton height={140} />
        </Card>
      </Row>
      <Row>
        <Card span={6}>
          <Skeleton height={14} width="50%" />
          <Skeleton height={180} />
        </Card>
        <Card span={6}>
          <Skeleton height={14} width="50%" />
          <Skeleton height={180} />
        </Card>
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────

function distanceLabelForRow(distanceMi: number): string {
  if (Math.abs(distanceMi - 3.1) < 0.15) return '5K';
  if (Math.abs(distanceMi - 6.2) < 0.2) return '10K';
  if (Math.abs(distanceMi - 13.1) < 0.2) return 'HALF';
  if (Math.abs(distanceMi - 26.2) < 0.3) return 'MARATHON';
  if (Math.abs(distanceMi - 31.1) < 0.5) return '50K';
  return `${distanceMi.toFixed(1)} MI`;
}

function upcomingRangeLabel(list: SavedRace[]): string {
  if (list.length === 0) return '';
  const first = list[0].meta.date;
  const last = list[list.length - 1].meta.date;
  if (first === last) return formatShortDate(first);
  return `${formatShortDate(first)} → ${formatShortDate(last)}`;
}

function dayOfWeekShort(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getUTCDay()];
}

function isWeekend(iso: string): boolean {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function formatTopbarClock(d: Date): React.ReactNode {
  const dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const date = `${months[d.getMonth()]} ${d.getDate()}`;
  const h = d.getHours();
  const m = d.getMinutes();
  const am = h < 12;
  const dispH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const time = `${dispH}:${m.toString().padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
  return (
    <>
      {dow} · {date} · <b>{time}</b>
    </>
  );
}

