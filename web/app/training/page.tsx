'use client';

/**
 * /training · Phase-2 port of the May 2026 mockup.
 *
 * Source mockup: designs/training-2026-05-09.html
 *
 * Architecture mirrors /overview/page.tsx:
 *   - Single useEffect that loads data via /api/training (server-side
 *     Coach bundle).
 *   - Skeleton + error fallback via <EmptyState>.
 *   - Every coaching judgment threads through `data.coach.*` (Coach
 *     methods) or a clearly-marked stub in data.ts.
 *
 * Sections (mapped 1:1 to the mockup):
 *   1. TopBar + Greet band (5 KPI tiles)
 *   2. TODAY hero (amber, span-7)  · GOAL TRACKING (span-5)
 *   3. THIS WEEK strip (span-12)
 *   4. NEXT 4 WEEKS (span-8)       · PLAN ADAPTED (coach, span-4)
 *   5. PATH TO AFC build curve + summary strip + phase breakdown
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
import { loadTrainingData, formatZoneTime, type TrainingData } from './data';

export default function TrainingPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [data, setData] = useState<TrainingData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { activities } = useActivities();

  useEffect(() => {
    setNow(new Date());
  }, []);

  useEffect(() => {
    if (!now) return;
    let cancelled = false;
    setLoadError(null);
    loadTrainingData(activities)
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
        activeTab="training"
        clock={clock !== null ? clock : <Skeleton width={140} height={12} />}
      />

      <TrainingGreet data={data} />

      {loadError && (
        <Row>
          <Card span={12}>
            <EmptyState
              variant="error"
              title="Couldn't load Training"
              body={loadError}
            />
          </Card>
        </Row>
      )}

      {data ? (
        <TrainingBody data={data} />
      ) : (
        !loadError && <TrainingSkeleton />
      )}
    </Stage>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Greet band
// ─────────────────────────────────────────────────────────────────────

function TrainingGreet({ data }: { data: TrainingData | null }) {
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

  const { coach, races } = data;
  const phase = (coach.workout.answer.phaseLabel || 'BASE').toUpperCase();
  const week = coach.weekDeltas.answer;
  const today = coach.workout.answer;
  const r = coach.readiness.answer;
  const daysToA = races.daysToNextA;
  const aRaceName = races.nextA?.meta.name ?? null;

  // Header eyebrow: "RECOVERY · 98 DAYS TO AFC · VDOT 49.2 ADV"
  // VDOT surfaces here because it's the runner's current fitness baseline and
  // anchors every pace zone the page references.
  const eyebrowParts: string[] = [phase];
  if (aRaceName && daysToA != null) {
    eyebrowParts.push(`${daysToA} DAYS TO ${aRaceName.toUpperCase()}`);
  }
  const vdotLine = data.goalTracking?.vdotLine ?? null;
  const vdotValue = vdotLine ? vdotLine.replace(/^VDOT\s+/, '').split(' ·')[0] : null;
  if (vdotValue) {
    eyebrowParts.push(`VDOT ${vdotValue}`);
  }

  // Readiness tile.
  const readinessLevel = r.level;
  const readinessVariant =
    readinessLevel === 'green' ? 'good' : readinessLevel === 'yellow' ? 'amber' : 'default';
  const readinessVal =
    readinessLevel === 'green' ? '88' : readinessLevel === 'yellow' ? '62' : '40';

  // Week tile.
  const weekDeltaLabel =
    week.netDeltaMi > 0.5
      ? `+${week.netDeltaMi.toFixed(1)} OVER`
      : week.netDeltaMi < -0.5
      ? `${week.netDeltaMi.toFixed(1)} UNDER`
      : 'ON PLAN';

  // Today tile.
  const todayDist = today.distanceMi.toFixed(1);
  const todayLabel = (today.label || 'EASY').toUpperCase();

  // Build-block tile — peak target from trajectory.
  const peakMi = coach.trajectory.answer.summary.peakWeekMi;

  return (
    <Greet>
      <GreetId
        eyebrow={eyebrowParts.join(' · ')}
        title="TRAINING"
      />
      <GreetState>
        <GreetTile
          variant="coach"
          eyebrow="PHASE"
          value={phase}
          delta={coach.workout.answer.isQuality ? 'QUALITY DAY' : 'EASY · ABSORB'}
        />
        <GreetTile
          variant="race"
          eyebrow="A-RACE COUNTDOWN"
          value={daysToA != null ? String(daysToA) : '—'}
          unit={daysToA != null ? 'D' : undefined}
          delta={aRaceName ? aRaceName.toUpperCase() : 'NONE SET'}
          deltaColor="var(--race)"
        />
        <GreetTile
          eyebrow="THIS WEEK"
          value={week.loggedWeekMi.toFixed(1)}
          unit="MI"
          delta={`${weekDeltaLabel} · ${countLoggedRuns(week.days)}/${week.days.filter((d) => d.plannedMi > 0).length} LOGGED`}
        />
        <GreetTile
          variant={readinessVariant}
          eyebrow="READINESS"
          value={readinessVal}
          unit="/100"
          delta={readinessLevel === 'green' ? '▲ BUILDING' : readinessLevel === 'yellow' ? '— HOLD' : '▼ REST DAY'}
          deltaColor={readinessLevel === 'green' ? 'var(--good)' : undefined}
        />
        <GreetTile
          variant="amber"
          eyebrow="TODAY"
          value={todayDist}
          unit="MI"
          delta={`${todayLabel} · PEAK ${peakMi}`}
        />
      </GreetState>
    </Greet>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────────

function PlanIntegrityBanner({ issues }: { issues: NonNullable<TrainingData['coach']['workout']['answer']['coachToday']['planIssues']> }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warns = issues.filter((i) => i.severity === 'warn');
  // Errors get a louder coach voice ("hold up") · warns are a gentler
  // note ("heads up"). Both still cite the research.
  const isError = errors.length > 0;
  const headline = isError ? 'Hold up — something\'s off with this week\'s plan' : 'Heads up';
  return (
    <Card span={12} padding="16px 20px" style={{
      background: 'linear-gradient(135deg, rgba(39,180,224,.08) 0%, var(--l1) 65%)',
      borderColor: 'rgba(39,180,224,.32)',
      borderLeft: '3px solid var(--coach)',
    }}>
      <div style={{
        fontFamily: 'var(--f-data)', fontSize: 10, letterSpacing: '1.6px',
        color: 'var(--coach)', fontWeight: 800, textTransform: 'uppercase',
      }}>
        ▸ COACH NOTE
      </div>
      <div style={{
        fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 700,
        letterSpacing: '-.01em', lineHeight: 1.2, color: 'var(--t0)',
        marginTop: 6,
      }}>
        {headline}
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[...errors, ...warns].slice(0, 5).map((iss, i) => (
          <div key={i} className="t-body" style={{ color: 'var(--t1)', fontSize: 13, lineHeight: 1.55 }}>
            {iss.message}
            <span style={{
              display: 'block', marginTop: 3,
              fontFamily: 'var(--f-data)', fontSize: 9.5,
              color: 'var(--t3)', letterSpacing: '0.6px',
            }}>
              {iss.citation}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TrainingBody({ data }: { data: TrainingData }) {
  const issues = data.coach.workout.answer.coachToday.planIssues ?? [];
  return (
    <>
      {issues.length > 0 && (
        <Row>
          <PlanIntegrityBanner issues={issues} />
        </Row>
      )}

      {/* ROW 1 — TODAY hero (7) + GOAL TRACKING (5) */}
      <Row>
        <TodayCard data={data} />
        <GoalTrackingCard data={data} />
      </Row>

      {/* ROW 2 — THIS WEEK strip full-width */}
      <Row>
        <ThisWeekCard data={data} />
      </Row>

      {/* ROW 2.5 — HR ZONES · 14-day rollup (re-homed from /health per
          /Research/00a §TID — training-design metric, not readiness) */}
      <Row>
        <HrZonesCard data={data} />
      </Row>

      {/* ROW 3 — NEXT 4 WEEKS (8) + PLAN ADAPTED (4) */}
      <Row>
        <NextFourWeeksCard data={data} />
        <PlanAdaptedCard data={data} />
      </Row>

      {/* ROW 4 — PATH TO AFC build curve */}
      <Row>
        <BuildCurveCard data={data} />
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TODAY hero (amber-washed expanded card)
// ─────────────────────────────────────────────────────────────────────

function TodayCard({ data }: { data: TrainingData }) {
  const w = data.coach.workout.answer;
  const structure = data.workoutStructure;
  const ready = data.readyToRun;
  const conditions = data.conditions;

  // Rest day branch — workout metrics (distance, duration, pace, HR cap, structure)
  // don't apply when there's no run. Recovery signals + coach note still do.
  const isRest = w.type === 'rest';

  const dist = w.distanceMi.toFixed(1);
  const paceDisplay =
    w.paceTargetSPerMi != null
      ? fmtPaceRange(w.paceTargetSPerMi)
      : '—';
  const hrCapBpm = conditions?.hrCap ?? (w.hrZone ? 130 + w.hrZone * 8 : 145);
  const hrZoneLabel = w.hrZone ? `Z${w.hrZone}` : 'Z1';
  const duration = estimateDurationMin(w);
  // Eyebrow: "TODAY · SAT MAY 9 · LIGHT RECOVERY"
  const todayLabel = formatFullDateLabel(data.today);
  const phaseLabel = (w.phaseLabel || 'TRAINING').toUpperCase();
  const eyebrow = `TODAY · ${todayLabel} · ${phaseLabel}`;
  // The Coach's voiceLead doubles as the "why this is light" body.
  const why = w.voiceLead;

  return (
    <Card wash="amber" span={7} padding="26px 28px">
      <CardHeader>
        <div
          style={{
            fontFamily: 'var(--f-data)',
            fontSize: 11,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: 'var(--att)',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--att)',
              boxShadow: '0 0 0 3px rgba(243,173,56,.22)',
            }}
          />
          {eyebrow}
        </div>
        <CardPin variant="amber">{isRest ? 'RECOVERY' : w.isQuality ? 'QUALITY' : 'SCHEDULED'}</CardPin>
      </CardHeader>

      <div
        className="t-display"
        style={{
          textTransform: 'uppercase',
          marginTop: 12,
          whiteSpace: 'nowrap',
          fontSize: 56,
        }}
      >
        {w.label}
      </div>

      <div
        className="t-body"
        style={{
          color: 'var(--t1)',
          marginTop: 8,
          maxWidth: 540,
        }}
      >
        <b style={{ color: 'var(--t0)', fontWeight: 600 }}>Why this matters: </b>
        {why}
      </div>

      {/* KPI strip + STRUCTURE only render for actual workouts · skip on rest days */}
      {!isRest && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 18,
              paddingTop: 18,
              marginTop: 18,
              borderTop: '1px solid var(--l4)',
            }}
          >
            <KpiCell
              label="DISTANCE"
              value={dist}
              unit="MI"
              sub={`FLOOR ${(w.distanceMi * 0.66).toFixed(1)} · CAP ${(w.distanceMi * 2).toFixed(1)}`}
            />
            <KpiCell
              label="DURATION"
              value={String(duration)}
              unit="MIN"
              sub="EST · CONVERSATIONAL"
            />
            <KpiCell
              label="PACE TARGET"
              value={paceDisplay}
              unit=""
              valueFontSize={26}
              sub={`/MI · ${w.isLong ? 'LONG E' : 'DANIELS E'}`}
            />
            <KpiCell
              label={`HR CAP · ${hrZoneLabel}`}
              value={String(hrCapBpm)}
              unit="BPM"
              sub={`${Math.round((hrCapBpm / 187) * 100)}% HRMAX`}
            />
          </div>

          <div
            style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: '1px solid var(--l4)',
            }}
          >
            <div className="mono-sm" style={{ marginBottom: 8, color: 'var(--t3)' }}>
              STRUCTURE
            </div>
            {structure.map((s, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  gap: 14,
                  alignItems: 'baseline',
                  padding: '7px 0',
                  fontSize: 13,
                  borderBottom: i < structure.length - 1 ? '1px solid var(--l3)' : 'none',
                }}
              >
                <span style={{ fontFamily: 'var(--f-data)', fontSize: 10.5, color: 'var(--t3)', fontWeight: 700 }}>
                  {s.timeOffset}
                </span>
                <span style={{ color: 'var(--t1)' }}>
                  {s.isMain ? <b style={{ color: 'var(--t0)' }}>{s.name}</b> : s.name}
                </span>
                <span style={{ fontFamily: 'var(--f-data)', fontSize: 11.5, color: 'var(--t1)', fontWeight: 600 }}>
                  {s.distance}
                </span>
                <span style={{ fontFamily: 'var(--f-data)', fontSize: 11.5, color: 'var(--att)', fontWeight: 600 }}>
                  {s.pace}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Rest-day recovery menu · what TO do when there's no run scheduled */}
      {isRest && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 18,
            borderTop: '1px solid var(--l4)',
          }}
        >
          <div className="mono-sm" style={{ marginBottom: 10, color: 'var(--t3)' }}>
            ACTIVE RECOVERY · OPTIONAL
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <RecoveryTile label="WALK" detail="20–30 MIN · EASY" />
            <RecoveryTile label="STRETCH" detail="10 MIN · FULL BODY" />
            <RecoveryTile label="FOAM ROLL" detail="HIPS · CALVES · IT" />
            <RecoveryTile label="SLEEP" detail="+1 HOUR TONIGHT" />
          </div>
        </div>
      )}

      {/* READY TO RUN — only renders when readiness signals are wired */}
      <div
        style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: '1px solid var(--l4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 10,
          }}
        >
          <CardLabel>READY TO RUN</CardLabel>
          {ready && (
            <div className="t-eyebrow" style={{ color: ready.headlineColor }}>
              {ready.headline}
            </div>
          )}
        </div>
        {ready && (ready.sleep || ready.hrv || ready.rhr || ready.soreness) ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {ready.sleep
              ? <SignalTile label="SLEEP" value={ready.sleep.value} delta={ready.sleep.delta} valueColor={ready.sleep.color} />
              : <SignalEmptyTile label="SLEEP" />}
            {ready.hrv
              ? <SignalTile label="HRV" value={ready.hrv.value} unit={ready.hrv.unit} delta={ready.hrv.delta} valueColor={ready.hrv.color} deltaColor={ready.hrv.color} />
              : <SignalEmptyTile label="HRV" />}
            {ready.rhr
              ? <SignalTile label="RHR" value={ready.rhr.value} unit={ready.rhr.unit} delta={ready.rhr.delta} deltaColor={ready.rhr.color} />
              : <SignalEmptyTile label="RHR" />}
            {ready.soreness
              ? <SignalTile label="SORENESS" value={ready.soreness.value} delta={ready.soreness.detail} />
              : <SignalEmptyTile label="SORENESS" />}
          </div>
        ) : (
          <div className="t-eyebrow" style={{ color: 'var(--t3)' }}>
            AWAITING HEALTHKIT · sleep / HRV / RHR streams not yet connected
          </div>
        )}
      </div>

      {/* CONDITIONS + COACH NOTE — only renders when weather is wired */}
      {conditions ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: 14,
            marginTop: 14,
            padding: '12px 14px',
            background: 'rgba(243,173,56,.06)',
            border: '1px solid rgba(243,173,56,.20)',
            borderRadius: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 2,
              whiteSpace: 'nowrap',
              borderRight: '1px solid var(--l4)',
              paddingRight: 14,
            }}
          >
            <div className="t-eyebrow">CONDITIONS</div>
            <div
              style={{
                fontFamily: 'var(--f-display)',
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: '-.02em',
                lineHeight: 1,
                marginTop: 4,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {conditions.tempF}
              <small style={{ fontSize: '.4em', opacity: 0.55, fontWeight: 700, marginLeft: 4 }}>°F</small>
            </div>
            <div className="t-eyebrow" style={{ color: 'var(--t2)', marginTop: 3 }}>
              {conditions.detail}
            </div>
          </div>
          <div>
            <div className="t-eyebrow" style={{ color: 'var(--att)' }}>COACH NOTE</div>
            <div className="t-body" style={{ color: 'var(--t1)', marginTop: 3 }}>
              {conditions.coachNote}
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            marginTop: 14,
            padding: '12px 14px',
            background: 'rgba(243,173,56,.04)',
            border: '1px dashed rgba(243,173,56,.20)',
            borderRadius: 8,
          }}
        >
          <div className="t-eyebrow" style={{ color: 'var(--t3)' }}>
            CONDITIONS · NO WEATHER WIRING YET
          </div>
          <div className="t-body" style={{ color: 'var(--t2)', marginTop: 4, fontSize: 12 }}>
            HR cap derived from prescribed zone: {hrCapBpm} bpm.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 18 }}>
        {isRest ? (
          <>
            <button className="btn-flat btn-primary">▶ PREVIEW TOMORROW</button>
            <button className="btn-flat btn-secondary">LOG RECOVERY</button>
          </>
        ) : (
          <>
            <Link href={`/workout/${data.today}`} className="btn-flat btn-primary" style={{ textDecoration: 'none' }}>▶ OPEN WORKOUT</Link>
            <button className="btn-flat btn-secondary">SKIP TODAY</button>
          </>
        )}
      </div>
    </Card>
  );
}

function RecoveryTile({ label, detail }: { label: string; detail: string }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--l2)', borderRadius: 6, border: '1px solid var(--l4)' }}>
      <div className="t-eyebrow" style={{ color: 'var(--t1)' }}>{label}</div>
      <div className="t-eyebrow" style={{ color: 'var(--t3)', marginTop: 4, letterSpacing: '.08em', textTransform: 'none', fontSize: 10 }}>{detail}</div>
    </div>
  );
}

function SignalEmptyTile({ label }: { label: string }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--l2)', borderRadius: 6, opacity: 0.65 }}>
      <div className="t-eyebrow">{label}</div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-.02em',
          lineHeight: 1,
          marginTop: 5,
          color: 'var(--t3)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        —
      </div>
      <div className="t-eyebrow" style={{ color: 'var(--t3)', marginTop: 3 }}>
        NO DATA
      </div>
    </div>
  );
}

function SignalTile({
  label,
  value,
  unit,
  delta,
  valueColor,
  deltaColor,
}: {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  valueColor?: string;
  deltaColor?: string;
}) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--l2)', borderRadius: 6 }}>
      <div className="t-eyebrow">{label}</div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-.02em',
          lineHeight: 1,
          marginTop: 5,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
        {unit && <small style={{ fontSize: '.4em', opacity: 0.55, fontWeight: 700, marginLeft: 4 }}>{unit}</small>}
      </div>
      <div className="t-eyebrow" style={{ color: deltaColor ?? 'var(--t2)', marginTop: 3 }}>
        {delta}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// GOAL TRACKING card (right column of row 1)
// ─────────────────────────────────────────────────────────────────────

function GoalTrackingCard({ data }: { data: TrainingData }) {
  const g = data.goalTracking;
  const proofs = data.coach.proofSessions.answer.sessions;
  const buildLen = data.coach.proofSessions.answer.buildLengthWk;

  if (!g) {
    return (
      <Card span={5} padding="24px 26px">
        <CardHeader>
          <CardLabel>GOAL TRACKING</CardLabel>
          <CardPin variant="muted">NO A-RACE</CardPin>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="No A-race set yet"
          body="Set a goal race in /races to unlock goal tracking, pace targets, and proof sessions."
        />
      </Card>
    );
  }

  return (
    <Card span={5} padding="24px 26px">
      <CardHeader>
        <CardLabel>GOAL TRACKING · {g.aRaceName}</CardLabel>
        <CardPin variant={g.pinVariant}>{g.pinLabel}</CardPin>
      </CardHeader>

      <div
        className="t-section"
        style={{
          marginTop: 4,
          textTransform: 'uppercase',
        }}
      >
        Pace toward
        <br />
        <span style={{ color: 'var(--race)' }}>{g.goalTime}</span>{' '}
        <span style={{ fontSize: '.55em', fontWeight: 500, color: 'var(--t2)' }}>
          · {g.goalPace}
        </span>
      </div>

      {/* VDOT badge · fitness baseline that anchors every pace zone */}
      <div
        style={{
          marginTop: 12,
          padding: '10px 14px',
          background: 'linear-gradient(135deg, rgba(0,143,236,.10), rgba(144,19,254,.10))',
          border: '1px solid rgba(0,143,236,.24)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div className="t-eyebrow" style={{ color: 'var(--corp)' }}>VDOT · CURRENT FITNESS</div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: '-.02em',
              lineHeight: 1,
              marginTop: 4,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {g.vdotLine ? g.vdotLine.replace(/^VDOT\s+/, '').split(' ·')[0] : '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="t-eyebrow" style={{ color: 'var(--t2)' }}>TIER · TREND</div>
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.06em',
              color: 'var(--good)',
              marginTop: 4,
            }}
          >
            {g.vdotLine ? `ADV${g.vdotLine.includes('▲') ? ` · ${g.vdotLine.split('·').slice(-1)[0].trim()}` : ''}` : 'NO VDOT'}
          </div>
        </div>
      </div>

      {/* WHERE YOU ARE vs WHERE YOU NEED */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 10,
          marginTop: 18,
          paddingTop: 18,
          borderTop: '1px solid var(--l4)',
        }}
      >
        <FitnessCell label="FITNESS NOW" value={g.fitnessNow} valueColor="var(--good)" sub={g.vdotLine ?? 'NO VDOT'} />
        <FitnessCell label={g.aRaceName.startsWith('AFC') ? 'AFC GOAL' : 'GOAL'} value={g.goalTime} valueColor="var(--race)" sub={`${g.goalPace} · ${g.daysToA} DAYS`} />
        <FitnessCell
          label="HEADROOM"
          value={`${g.headroomSPerMi >= 0 ? '+' : ''}${Math.round(g.headroomSPerMi)}`}
          unit="S/MI"
          valueColor={g.headroomSPerMi >= 0 ? 'var(--good)' : 'var(--warn)'}
          sub={g.headroomSPerMi >= 10 ? 'CONFIDENCE HIGH' : g.headroomSPerMi >= 0 ? 'CONFIDENCE MED' : 'BEHIND'}
          subColor={g.headroomSPerMi >= 0 ? 'var(--good)' : 'var(--warn)'}
          align="right"
        />
      </div>

      {/* PROOF SESSIONS AHEAD */}
      <div
        style={{
          marginTop: 18,
          paddingTop: 18,
          borderTop: '1px solid var(--l4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 10,
          }}
        >
          <CardLabel>PROOF SESSIONS AHEAD</CardLabel>
          <div className="t-eyebrow" style={{ color: 'var(--good)' }}>
            {proofs.length} KEY · {buildLen} WK BUILD
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {proofs.map((p, i) => {
            const isRace = p.priority === 'race';
            return (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '60px 1fr auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '8px 10px',
                  background: isRace ? 'rgba(255,87,34,.06)' : 'var(--l2)',
                  borderRadius: 6,
                  borderLeft: `3px solid ${isRace ? 'var(--race)' : 'var(--milestone)'}`,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--f-data)',
                    fontSize: 9,
                    letterSpacing: '.5px',
                    color: isRace ? 'var(--race)' : 'var(--t3)',
                    fontWeight: 700,
                  }}
                >
                  {formatProofDate(p.dateISO)}
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--f-display)',
                      fontSize: 15,
                      fontWeight: 600,
                      letterSpacing: '-.01em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {p.label}
                  </div>
                  <div className="t-eyebrow" style={{ color: 'var(--t2)', marginTop: 2 }}>
                    {p.structure} · {p.phaseTag}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--f-data)',
                    fontSize: 11,
                    color: isRace ? 'var(--race)' : 'var(--milestone)',
                    fontWeight: 700,
                    letterSpacing: '.5px',
                  }}
                >
                  {p.targetPaceDisplay}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* LATEST PROOF */}
      {g.latestProof && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            background: 'rgba(62,189,65,.06)',
            border: '1px solid rgba(62,189,65,.20)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div className="t-eyebrow" style={{ color: 'var(--good)' }}>
              ▲ LATEST PROOF · {formatShortDate(g.latestProof.dateISO)}
            </div>
            <div className="t-eyebrow" style={{ color: g.latestProof.onTarget ? 'var(--good)' : 'var(--warn)' }}>
              {g.latestProof.onTarget ? '✓ ON TARGET' : '▼ MISSED'}
            </div>
          </div>
          <div className="t-body" style={{ color: 'var(--t1)', marginTop: 4 }}>
            {g.latestProof.title} · {g.latestProof.summary}
          </div>
        </div>
      )}

      {/* PR · GOAL · STRETCH tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
          paddingTop: 14,
          marginTop: 'auto',
          borderTop: '1px solid var(--l4)',
        }}
      >
        {g.tiles.pr
          ? <GoalTile tone="good" label={g.tiles.pr.label} time={g.tiles.pr.time} meta={g.tiles.pr.meta} />
          : <GoalTile tone="good" label="PR" time="—" meta="NO RACE AT THIS DISTANCE" />}
        <GoalTile tone="race" label={g.tiles.goal.label} time={g.tiles.goal.time} meta={g.tiles.goal.meta} highlighted />
        <GoalTile tone="good" label={g.tiles.stretch.label} time={g.tiles.stretch.time} meta={g.tiles.stretch.meta} />
      </div>
    </Card>
  );
}

function FitnessCell({
  label,
  value,
  unit,
  valueColor,
  sub,
  subColor,
  align = 'left',
}: {
  label: string;
  value: string;
  unit?: string;
  valueColor?: string;
  sub: string;
  subColor?: string;
  align?: 'left' | 'right';
}) {
  return (
    <div style={{ textAlign: align }}>
      <div className="t-eyebrow">{label}</div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: '-.02em',
          lineHeight: 1,
          marginTop: 6,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
        {unit && <small style={{ fontSize: '.4em', opacity: 0.55, fontWeight: 700, marginLeft: 4 }}>{unit}</small>}
      </div>
      <div className="t-eyebrow" style={{ color: subColor ?? 'var(--t2)', marginTop: 4 }}>
        {sub}
      </div>
    </div>
  );
}

function GoalTile({
  tone,
  label,
  time,
  meta,
  highlighted,
}: {
  tone: 'good' | 'race';
  label: string;
  time: string;
  meta: string;
  highlighted?: boolean;
}) {
  const color = tone === 'race' ? 'var(--race)' : 'var(--good)';
  const bg = highlighted
    ? 'rgba(255,87,34,.12)'
    : tone === 'good'
    ? 'rgba(62,189,65,.10)'
    : 'var(--l2)';
  const border = highlighted ? '1px solid rgba(255,87,34,.32)' : 'none';
  return (
    <div style={{ textAlign: 'center', padding: '12px 6px 14px', background: bg, border, borderRadius: 6 }}>
      <div className="mono-sm" style={{ color, fontSize: 9 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 600,
          fontSize: 18,
          lineHeight: 1.05,
          textTransform: 'uppercase',
          letterSpacing: '-.005em',
          color,
          marginTop: 6,
        }}
      >
        {time}
      </div>
      <div className="mono-sm" style={{ color: 'var(--t2)', fontSize: 8.5, marginTop: 6 }}>
        {meta}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// THIS WEEK strip
// ─────────────────────────────────────────────────────────────────────

function ThisWeekCard({ data }: { data: TrainingData }) {
  const w = data.coach.weekDeltas.answer;
  const loggedRuns = countLoggedRuns(w.days);
  const plannedRuns = w.days.filter((d) => d.plannedMi > 0).length || 1;
  const scale = Math.max(w.projectedWeekMi, w.plannedWeekMi, 1);
  const loggedPct = (w.loggedWeekMi / scale) * 100;
  const planPct = (w.plannedWeekMi / scale) * 100;
  const todayISO = data.today;
  const phaseLabel = (data.coach.workout.answer.phaseLabel || 'TRAINING').toUpperCase();

  return (
    <Card span={12} padding="18px 22px">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          gap: 24,
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, whiteSpace: 'nowrap' }}>
          <CardLabel>THIS WEEK</CardLabel>
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 11,
              letterSpacing: '.12em',
              color: 'var(--t1)',
              fontWeight: 500,
              textTransform: 'uppercase',
            }}
          >
            {phaseLabel}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span
              style={{
                fontFamily: 'var(--f-display)',
                fontSize: 28,
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: '-.02em',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {w.loggedWeekMi.toFixed(1)}
              <span
                style={{
                  fontFamily: 'var(--f-data)',
                  fontSize: '.4em',
                  opacity: 0.5,
                  fontWeight: 700,
                  marginLeft: 7,
                  letterSpacing: '1px',
                }}
              >
                MI LOGGED
              </span>
            </span>
            <span style={{ fontFamily: 'var(--f-data)', fontSize: 10, color: 'var(--t3)', fontWeight: 500, letterSpacing: '.12em' }}>
              / {w.plannedWeekMi.toFixed(0)} PLAN
            </span>
            <span
              style={{
                fontFamily: 'var(--f-data)',
                fontSize: 10,
                color: 'var(--corp)',
                fontWeight: 700,
                letterSpacing: '.8px',
                marginLeft: 'auto',
              }}
            >
              {w.rationale.toUpperCase()}
            </span>
          </div>
          <div
            style={{
              position: 'relative',
              height: 8,
              background: 'var(--l3)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${loggedPct}%`,
                background: 'linear-gradient(90deg, var(--corp), var(--coach))',
                borderRadius: '4px 0 0 4px',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: `${loggedPct}%`,
                top: 0,
                bottom: 0,
                right: 0,
                background: 'repeating-linear-gradient(90deg, rgba(0,143,236,.35) 0 4px, transparent 4px 7px)',
                borderRadius: '0 4px 4px 0',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: `${planPct}%`,
                top: -3,
                bottom: -3,
                width: 2,
                background: 'var(--t1)',
                boxShadow: '0 0 4px var(--t0)',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, whiteSpace: 'nowrap' }}>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 22,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '-.02em',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--good)',
            }}
          >
            {loggedRuns}
            <span style={{ fontFamily: 'var(--f-data)', fontSize: '.5em', opacity: 0.5, fontWeight: 700, marginLeft: 3 }}>
              / {plannedRuns}
            </span>
          </div>
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 9.5,
              letterSpacing: '.12em',
              color: 'var(--good)',
              fontWeight: 500,
              textTransform: 'uppercase',
            }}
          >
            ✓ LOGGED
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {w.days.map((d) => (
          <DayCell key={d.dateISO} day={d} todayISO={todayISO} prescription={data.coach.workout.answer} />
        ))}
      </div>
    </Card>
  );
}

function DayCell({
  day,
  todayISO,
  prescription,
}: {
  day: TrainingData['coach']['weekDeltas']['answer']['days'][number];
  todayISO: string;
  prescription: TrainingData['coach']['workout']['answer'];
}) {
  const isToday = day.dateISO === todayISO;
  const isPast = day.dateISO < todayISO;
  const isFuture = day.dateISO > todayISO;
  // Only treat as "done" if the day is past AND has actualMi. Future days
  // may carry stub actuals from a mocked Coach method — ignore them.
  const isDone = !isFuture && day.actualMi != null && day.actualMi > 0;
  // Engine prescribed rest = canonical rest signal. Falls back to the
  // "no plan, no actual" heuristic for legacy callers.
  const isRest = day.type === 'rest' || (day.plannedMi === 0 && (isFuture || day.actualMi == null));

  let tag: 'rest' | 'recovery' | 'easy' | 'long' | 'quality' | 'strength' = 'easy';
  if (isRest) tag = 'rest';
  else if (day.isQuality) tag = 'quality';
  else if (day.isLong) tag = 'long';
  else if (day.type === 'recovery') tag = 'recovery';
  else if (day.dayLabel === 'THU' && day.plannedMi < 1) tag = 'strength';

  const cls = [
    'day',
    `t-${tag}`,
    isToday ? 'today' : '',
    isDone ? 'done' : '',
    !isDone && isPast ? 'done' : '',
    !isDone && !isPast && !isToday ? 'future' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Use the engine's real label when we have one — fall back to phase-
  // appropriate generic labels only when day.label is empty.
  const typeName = isRest
    ? 'Rest'
    : isToday
    ? capitalize(prescription.type.replace(/_/g, ' '))
    : tag === 'strength'
    ? 'Strength'
    : day.label || (day.isLong ? 'Easy long' : day.isQuality ? 'Quality' : 'Easy');

  // Future days show planned miles only · past/today can show actual if logged
  const miles = isFuture ? day.plannedMi : (day.actualMi ?? day.plannedMi);
  const showMiles = miles > 0 && tag !== 'strength';

  return (
    <div className={cls}>
      <div className="day-strip">
        <span className="day-dow" style={isToday ? { color: 'var(--att)' } : undefined}>
          {isToday ? `TODAY · ${day.dayLabel}` : day.dayLabel}
        </span>
        <span className="day-date">{shortMonthDay(day.dateISO)}</span>
      </div>
      <div className="day-body">
        <div className="day-type">{typeName}</div>
        {showMiles && (
          <div className="day-mi">
            {miles.toFixed(1)}
            <small>mi</small>
          </div>
        )}
        {tag === 'strength' && (
          <div className="day-mi">
            30
            <small>min</small>
          </div>
        )}
        {!isRest && isToday && prescription.paceTargetSPerMi && (
          <div className="day-pace">{fmtPaceRange(prescription.paceTargetSPerMi)}</div>
        )}
      </div>
      <div className={`day-foot ${isDone ? 'done' : isToday ? 'active' : isRest ? 'rest' : 'future'}`}>
        <span>
          {isDone
            ? '✓ DONE'
            : isToday
            ? '● ACTIVE'
            : isRest
            ? '—'
            : day.dayLabel === 'SUN'
            ? 'LONG RUN'
            : '—'}
        </span>
        <span>
          {isDone && day.pinLabel ? (
            <span
              className="delta up"
              style={{
                background: 'rgba(0,143,236,.14)',
                color: 'var(--corp)',
                padding: '2px 6px',
                borderRadius: 3,
                fontSize: 8.5,
              }}
            >
              {day.pinLabel}
            </span>
          ) : isToday ? (
            'OPEN →'
          ) : (
            ''
          )}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// HR ZONES · 14-DAY ROLLUP — re-homed from /health.
// Audit: /Research/00a §TID — training-design metric, not a readiness one.
// ─────────────────────────────────────────────────────────────────────

function HrZonesCard({ data }: { data: TrainingData }) {
  const hz = data.hrZones;
  const easyPct = Math.round(hz.easyShare * 100);
  const total = hz.z1Min + hz.z2Min + hz.z3Min + hz.z4Min + hz.z5Min;
  const safeTotal = total > 0 ? total : 1;
  const todayISO = data.today;

  return (
    <Card span={12} padding="18px 22px">
      <CardHeader>
        <CardLabel>HR ZONES · LAST 14 DAYS</CardLabel>
        <CardPin variant="green">{easyPct}% EASY</CardPin>
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 600,
          fontSize: 22,
          lineHeight: 1.05,
          textTransform: 'uppercase',
          letterSpacing: '-.005em',
          marginTop: 6,
        }}
      >
        {easyPct >= 80 ? 'Polarized intact' : 'Drift toward grey-zone'}
      </div>

      <div
        style={{
          display: 'flex',
          height: 14,
          borderRadius: 5,
          overflow: 'hidden',
          gap: 1,
          background: 'var(--l3)',
          marginTop: 12,
        }}
      >
        <div style={{ flex: hz.z1Min / safeTotal, background: 'var(--good)' }} />
        <div style={{ flex: hz.z2Min / safeTotal, background: 'var(--corp)' }} />
        <div style={{ flex: hz.z3Min / safeTotal, background: 'var(--corp)' }} />
        <div style={{ flex: hz.z4Min / safeTotal, background: 'var(--milestone)' }} />
        <div style={{ flex: hz.z5Min / safeTotal, background: 'var(--warn)' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, marginTop: 14 }}>
        <ZoneTile label="Z1" minutes={hz.z1Min} color="var(--good)"      bg="rgba(62,189,65,.10)"  tone="EASY" />
        <ZoneTile label="Z2" minutes={hz.z2Min} color="var(--good)"      bg="rgba(62,189,65,.10)"  tone="AERO" />
        <ZoneTile label="Z3" minutes={hz.z3Min} color="var(--corp)"      bg="rgba(0,143,236,.08)"  tone="TEMPO" />
        <ZoneTile label="Z4" minutes={hz.z4Min} color="var(--milestone)" bg="rgba(240,223,71,.10)" tone="THRESH" />
        <ZoneTile label="Z5" minutes={hz.z5Min} color="var(--warn)"      bg="rgba(252,77,100,.10)" tone="VO2" />
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--l4)' }}>
        <div className="t-eyebrow" style={{ marginBottom: 8 }}>DAILY MIX · 14 DAYS</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(14,1fr)',
            gap: 2,
            height: 42,
            alignItems: 'end',
          }}
        >
          {hz.days.map((d, idx) => {
            const isFuture = d.dateISO > todayISO;
            const isToday = d.dateISO === todayISO;
            const totalMin = d.z1Min + d.z4Min + d.z5Min;
            const heightPct = d.rest ? 8 : Math.max(20, Math.min(85, totalMin));
            return (
              <div
                key={idx}
                style={{ display: 'flex', flexDirection: 'column-reverse', height: '100%', gap: 1 }}
              >
                {d.rest && !isFuture ? (
                  <div
                    style={{
                      background: 'rgba(244,246,248,.08)',
                      height: '8%',
                      borderRadius: '1px 1px 0 0',
                      outline: isToday ? '2px solid var(--att)' : undefined,
                      outlineOffset: isToday ? '1px' : undefined,
                    }}
                  />
                ) : isFuture ? (
                  <div
                    style={{
                      background: 'rgba(62,189,65,.30)',
                      height: `${heightPct}%`,
                      border: '1px dashed rgba(62,189,65,.5)',
                      borderRadius: '1px 1px 0 0',
                      boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  <>
                    <div
                      style={{
                        background: 'var(--good)',
                        height: `${heightPct}%`,
                        borderRadius: '1px 1px 0 0',
                        outline: isToday ? '2px solid var(--att)' : undefined,
                        outlineOffset: isToday ? '1px' : undefined,
                      }}
                    />
                    {d.z4Min > 0 && (
                      <div style={{ background: 'var(--milestone)', height: `${Math.min(20, d.z4Min)}%` }} />
                    )}
                    {d.z5Min > 0 && (
                      <div style={{ background: 'var(--warn)', height: `${Math.min(15, d.z5Min)}%` }} />
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <CardFoot
        left="cite · /Research/00a §Training Intensity Distribution"
        right={
          easyPct >= 80
            ? <span className="delta up">+{easyPct - 80}% MARGIN · 80/20</span>
            : <span className="delta dn">−{80 - easyPct}% UNDER</span>
        }
      />
    </Card>
  );
}

function ZoneTile({
  label,
  minutes,
  color,
  bg,
  tone,
}: {
  label: string;
  minutes: number;
  color: string;
  bg: string;
  tone: string;
}) {
  const noData = minutes <= 0;
  const formatted = noData ? null : formatZoneTime(minutes);
  return (
    <div style={{ textAlign: 'center', padding: '10px 6px', background: bg, borderRadius: 6 }}>
      <div className="mono-sm" style={{ color }}>{label}</div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 600,
          fontSize: 22,
          marginTop: 4,
          color: noData ? 'var(--t3)' : 'var(--t0)',
          lineHeight: 1.05,
        }}
      >
        {noData ? '—' : (
          <>
            {formatted!.value}
            <small style={{ fontSize: '.5em' }}>{formatted!.unit}</small>
          </>
        )}
      </div>
      <div className="mono-sm" style={{ color: 'var(--t3)', fontSize: 8 }}>{tone}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// NEXT 4 WEEKS
// ─────────────────────────────────────────────────────────────────────

function NextFourWeeksCard({ data }: { data: TrainingData }) {
  const n = data.nextFourWeeks;
  if (!n) {
    return (
      <Card span={8} padding="20px 22px">
        <CardHeader>
          <CardLabel>NEXT 4 WEEKS</CardLabel>
          <CardPin variant="muted">NO PLAN YET</CardPin>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="No upcoming plan blocks"
          body="The 14-week trajectory has no future weeks to surface — either no A-race is set or the build has already finished."
        />
      </Card>
    );
  }
  return (
    <Card span={8} padding="20px 22px">
      <CardHeader>
        <div>
          <CardLabel>{n.rangeLabel}</CardLabel>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 22,
              fontWeight: 600,
              lineHeight: 1.05,
              textTransform: 'uppercase',
              letterSpacing: '-.005em',
              marginTop: 4,
            }}
          >
            {n.title}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {n.pins.map((p, i) => (
            <CardPin key={i} variant={p.variant}>{p.label}</CardPin>
          ))}
        </div>
      </CardHeader>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 12 }}>
        {n.blocks.map((b, i) => (
          <BlockCell key={i} block={b} />
        ))}
      </div>

      {/* Block summary strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 14,
          paddingTop: 14,
          marginTop: 14,
          borderTop: '1px solid var(--l4)',
        }}
      >
        <SummaryCell label="BLOCK TOTAL" value={String(n.summary.totalMi)} unit="MI" sub="28 DAYS · 4 WEEKS" />
        <SummaryCell
          label="AVG / WEEK"
          value={String(n.summary.avgWeekMi)}
          unit="MI"
          sub={n.summary.avgVsRecovery}
          subColor="var(--good)"
        />
        <SummaryCell
          label="QUALITY DAYS"
          value={String(n.summary.qualityDays)}
          unit=""
          sub={n.summary.qualityDetail}
          valueColor="var(--milestone)"
        />
        <SummaryCell
          label="LONGEST RUN"
          value={String(n.summary.longestRunMi)}
          unit="MI"
          sub={n.summary.longestRunWhen}
          valueColor="var(--corp)"
        />
      </div>
    </Card>
  );
}

function BlockCell({ block }: { block: NonNullable<TrainingData['nextFourWeeks']>['blocks'][number] }) {
  const TONE_COLORS: Record<typeof block.tone, string> = {
    recovery: 'var(--good)',
    base: 'var(--corp)',
    build: 'var(--good)',
    peak: 'var(--att)',
    taper: 'var(--warn)',
    race: 'var(--race)',
  };
  const railColor = TONE_COLORS[block.tone];
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--l2)',
        borderRadius: 10,
        borderLeft: `3px solid ${railColor}`,
      }}
    >
      <div className="mono-sm" style={{ color: railColor }}>
        {block.rangeLabel}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 600,
          fontSize: 16,
          lineHeight: 1.05,
          textTransform: 'uppercase',
          letterSpacing: '-.005em',
          marginTop: 4,
        }}
      >
        {block.title}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
        <BlockStat label="MI" value={String(block.miles)} color={block.tone === 'recovery' ? 'var(--good)' : undefined} />
        <BlockStat label="QUAL" value={String(block.quality)} color={block.quality > 0 ? 'var(--milestone)' : undefined} />
        <BlockStat label="LONG" value={String(block.longMi)} color="var(--corp)" />
      </div>
      <div className="mono-sm" style={{ marginTop: 10, color: 'var(--t2)', fontSize: 9.5 }}>
        {block.rationale}
      </div>
    </div>
  );
}

function BlockStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="mono-sm" style={{ fontSize: 8.5, color: 'var(--t3)' }}>{label}</div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 22,
          fontWeight: 700,
          lineHeight: 1,
          color,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  unit,
  sub,
  valueColor,
  subColor,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  valueColor?: string;
  subColor?: string;
}) {
  return (
    <div>
      <div className="t-eyebrow">{label}</div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: '-.02em',
          lineHeight: 1,
          marginTop: 6,
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
        }}
      >
        {value}
        {unit && <span style={{ fontFamily: 'var(--f-data)', fontSize: '.4em', opacity: 0.55, fontWeight: 700, marginLeft: 7 }}>{unit}</span>}
      </div>
      <div className="t-eyebrow" style={{ color: subColor ?? 'var(--t2)', marginTop: 4 }}>
        {sub}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PLAN ADAPTED (Coach Read · same wash + decision-delta pattern as Overview)
// ─────────────────────────────────────────────────────────────────────

function PlanAdaptedCard({ data }: { data: TrainingData }) {
  const pa = data.planAdapted;
  if (!pa) {
    return (
      <Card wash="coach" span={4} padding="20px 22px">
        <CardHeader>
          <CardLabel color="var(--coach)">▲ COACH ADAPTED · LAST 7 DAYS</CardLabel>
          <CardPin variant="muted">NO CHANGES</CardPin>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="Plan held steady"
          body="Coach hasn't adjusted the plan in the last 7 days. Decision deltas surface here when training reality diverges from the prescription."
        />
      </Card>
    );
  }
  return (
    <Card wash="coach" span={4} padding="20px 22px">
      <CardHeader>
        <CardLabel color="var(--coach)">▲ COACH ADAPTED · LAST 7 DAYS</CardLabel>
        {pa.pinLabel && <CardPin variant="coach">{pa.pinLabel}</CardPin>}
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 22,
          fontWeight: 600,
          lineHeight: 1.15,
          marginTop: 6,
        }}
      >
        {pa.title}
      </div>
      <div style={{ fontSize: 15, color: 'var(--t1)', lineHeight: 1.6, letterSpacing: '-.012em', marginTop: 6 }}>
        {pa.body}
      </div>

      {pa.deltas.map((d, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            gap: 8,
            alignItems: 'center',
            padding: '10px 12px',
            background: 'var(--l2)',
            borderRadius: 8,
            marginTop: 10,
          }}
        >
          <div>
            <div className="mono-sm" style={{ fontSize: 8.5, color: 'var(--t3)' }}>{d.label}</div>
            <div
              style={{
                fontFamily: 'var(--f-display)',
                fontWeight: 600,
                fontSize: 18,
                color: 'var(--t3)',
                textDecoration: 'line-through',
                marginTop: 3,
              }}
            >
              {d.was}
              {d.unit && <small style={{ fontSize: '.5em' }}>{d.unit}</small>}
            </div>
          </div>
          <span style={{ color: 'var(--coach)', fontWeight: 700 }}>→</span>
          <div style={{ textAlign: 'right' }}>
            <div className="mono-sm" style={{ fontSize: 8.5, color: 'var(--t3)' }}>NOW</div>
            <div
              style={{
                fontFamily: 'var(--f-display)',
                fontWeight: 600,
                fontSize: 18,
                color: 'var(--coach)',
                marginTop: 3,
              }}
            >
              {d.now}
              {d.unit && <small style={{ fontSize: '.5em' }}>{d.unit}</small>}
            </div>
          </div>
        </div>
      ))}

      <CardFoot left={pa.footLeft} right={<span style={{ color: 'var(--coach)' }}>SEE PLAN →</span>} />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PATH TO AFC build curve
// ─────────────────────────────────────────────────────────────────────

function BuildCurveCard({ data }: { data: TrainingData }) {
  const t = data.coach.trajectory.answer;
  const points = t.points;
  // todayIdx by stub convention (4 past + present).
  const todayIdx = 4;
  const peakIdx = points.findIndex((p) => p.isPeak);
  const raceIdx = points.findIndex((p) => p.isRaceWeek);

  // PY0 raised from 14 → 32 so TODAY/PEAK callouts at y≈18 sit ABOVE
  // the tallest bar instead of overlapping its cap.
  const PX0 = 38, PY0 = 32, PX1 = 1062, PY1 = 232;
  const PW = PX1 - PX0, PH = PY1 - PY0;
  const maxMi = Math.max(...points.map((p) => p.plannedMi));
  const yMax = Math.ceil(maxMi / 10) * 10 || 50;
  const projY = (mi: number) => PY1 - (mi / yMax) * PH;

  const colStep = PW / points.length;
  const barW = colStep * 0.72;

  const barColor = (phase: string) => {
    if (phase === 'past') return 'var(--corp)';
    if (phase === 'base') return 'var(--corp)';
    if (phase === 'build') return 'var(--good)';
    if (phase === 'peak') return 'var(--att)';
    if (phase === 'taper') return 'var(--warn)';
    return 'var(--t2)';
  };

  // Phase breakdown counts (durations) — derived from points.
  const phaseCount = (phase: TrainingData['coach']['trajectory']['answer']['points'][number]['phase']) =>
    points.filter((p) => p.phase === phase).length;

  return (
    <Card span={12} padding="22px 26px">
      <CardHeader>
        <div>
          <CardLabel>PATH TO {t.raceName.toUpperCase()} · {t.totalWeeks} WEEKS</CardLabel>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 600,
              fontSize: 22,
              lineHeight: 1.05,
              marginTop: 4,
            }}
          >
            {t.rationale}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 14,
            fontFamily: 'var(--f-data)',
            fontSize: 10,
            letterSpacing: '1.4px',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}
        >
          <span style={{ color: 'var(--good)' }}>▲ +12% VOL</span>
          <span style={{ color: 'var(--corp)' }}>PROJECTED</span>
        </div>
      </CardHeader>

      {/* Phase legend */}
      <div
        style={{
          display: 'flex',
          gap: 18,
          marginTop: 14,
          fontFamily: 'var(--f-data)',
          fontSize: 10,
          letterSpacing: '1px',
          fontWeight: 700,
          textTransform: 'uppercase',
          color: 'var(--t3)',
          alignItems: 'center',
        }}
      >
        <PhaseLegendChip color="rgba(0,143,236,.4)" label="PAST · 4W" />
        <PhaseLegendChip color="rgba(62,189,65,.4)" label="BUILD" />
        <PhaseLegendChip color="rgba(243,173,56,.4)" label="PEAK" />
        <PhaseLegendChip color="rgba(252,77,100,.4)" label="TAPER" />
        <span style={{ marginLeft: 'auto', color: 'var(--good)' }}>
          <span style={{ verticalAlign: 'middle' }}>◇</span> PEAK TARGET · {t.summary.peakWeekMi} MI
        </span>
      </div>

      <svg viewBox="0 0 1080 280" style={{ width: '100%', height: 'auto', display: 'block', marginTop: 8 }}>
        {/* Y axis ticks */}
        <g fontFamily="JetBrains Mono" fontSize={10} fontWeight={700} fill="rgba(244,246,248,.38)" letterSpacing={0.4}>
          {[0, 10, 20, 30, 40, 50].filter((v) => v <= yMax).map((v) => {
            const y = projY(v);
            return (
              <g key={v}>
                <line x1={PX0 + 4} y1={y} x2={PX1} y2={y} stroke="rgba(244,246,248,.04)" strokeWidth={1} strokeDasharray="2 5" />
                <text x={PX0 - 4} y={y + 4} textAnchor="end">{v}</text>
              </g>
            );
          })}
        </g>

        {/* PEAK TARGET reference line */}
        <line x1={PX0} y1={projY(t.summary.peakWeekMi)} x2={PX1} y2={projY(t.summary.peakWeekMi)} stroke="rgba(62,189,65,.22)" strokeWidth={1} strokeDasharray="3 5" />

        {/* Bars · one per week */}
        {points.map((p, i) => {
          const isToday = i === todayIdx;
          const isPeak = p.isPeak;
          const isRace = p.isRaceWeek;
          const isFuture = i > todayIdx;
          const x = PX0 + i * colStep + (colStep - barW) / 2;
          const yTop = projY(p.plannedMi);
          const h = PY1 - yTop;
          const fill = isRace ? 'var(--race)' : barColor(p.phase);
          const fillOp = isRace ? 1 : isFuture ? 0.55 : 1;
          return (
            <rect
              key={i}
              x={x}
              y={yTop}
              width={barW}
              height={h}
              rx={2}
              fill={fill}
              fillOpacity={fillOp}
              stroke={isToday ? 'var(--att)' : isPeak ? 'var(--good)' : 'none'}
              strokeWidth={isToday || isPeak ? 2 : 0}
            />
          );
        })}

        {/* Today / Peak / Race callouts pinned to the top row with connectors */}
        {/* Callouts at fontSize=8 · Training's trajectory card is span-12 (full width),
            so the SVG scale factor is ~1.34x and 8px renders as ~11px on screen */}
        <g fontFamily="JetBrains Mono" fontSize={8} fontWeight={700} letterSpacing={0.6}>
          {(() => {
            const xCenter = (i: number) => PX0 + i * colStep + colStep / 2;
            const LABEL_Y = PY0 + 4;
            const renderCallout = (i: number, text: string, color: string, anchor: 'start' | 'middle' | 'end' = 'middle') => {
              const cx = xCenter(i);
              const barTop = projY(points[i].plannedMi);
              return (
                <g key={`${i}-${text}`}>
                  <line x1={cx} y1={LABEL_Y + 4} x2={cx} y2={barTop - 4} stroke={color} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2 3" />
                  <text x={cx} y={LABEL_Y} textAnchor={anchor} fill={color}>{text}</text>
                </g>
              );
            };
            return (
              <>
                {renderCallout(todayIdx, '● TODAY', 'var(--att)')}
                {peakIdx > -1 && renderCallout(peakIdx, `◇ PEAK · ${points[peakIdx].plannedMi} MI`, 'var(--good)')}
                {raceIdx > -1 && renderCallout(raceIdx, '▣ RACE', 'var(--race)', 'end')}
              </>
            );
          })()}
        </g>

        {/* Baseline */}
        <line x1={PX0} y1={PY1} x2={PX1} y2={PY1} stroke="rgba(244,246,248,.18)" strokeWidth={1} />

        {/* Week labels under each bar · fontSize=7 since the chart is full-width (span-12) */}
        <g fontFamily="JetBrains Mono" fontSize={7} fontWeight={700} fill="rgba(244,246,248,.42)" letterSpacing={0.4}>
          {points.map((p, i) => {
            const cx = PX0 + i * colStep + colStep / 2;
            const isToday = i === todayIdx;
            const isPeak = p.isPeak;
            const isRace = p.isRaceWeek;
            const isMarked = isToday || isPeak || isRace;
            const label = p.label === 'PEAK' || p.label === 'RACE' ? p.label : p.label.replace(/^WK\s+/, 'W');
            const color = isToday ? 'var(--att)' : isPeak ? 'var(--good)' : isRace ? 'var(--race)' : 'rgba(244,246,248,.42)';
            return (
              <text key={i} x={cx} y={PY1 + 16} textAnchor="middle" fill={color} fontWeight={isMarked ? 700 : 600} opacity={isMarked ? 1 : 0.7}>
                {label}
              </text>
            );
          })}
        </g>
      </svg>

      {/* Build-block summary strip · 6 stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: 14,
          paddingTop: 18,
          marginTop: 14,
          borderTop: '1px solid var(--l4)',
        }}
      >
        <SummaryCell label="TOTAL BUILD" value={String(t.summary.totalBuildMi)} unit="MI" sub={`${t.totalWeeks} WEEKS · ${t.daysToRace} DAYS`} />
        <SummaryCell
          label="PEAK WEEK"
          value={String(t.summary.peakWeekMi)}
          unit="MI"
          sub={peakWeekDateLabel(points, peakIdx)}
          valueColor="var(--good)"
        />
        <SummaryCell
          label="LONG-RUN MAX"
          value={String(t.summary.longRunMaxMi)}
          unit="MI"
          sub="FROM 7 NOW · +100%"
          valueColor="var(--corp)"
        />
        <SummaryCell
          label="QUALITY DAYS"
          value={String(t.summary.qualityDays)}
          unit=""
          sub="T · I · HMP SESSIONS"
          valueColor="var(--milestone)"
        />
        <SummaryCell
          label="RACE-PACE MI"
          value={String(t.summary.racePaceMi)}
          unit="MI"
          sub={`${Math.round((t.summary.racePaceMi / t.summary.totalBuildMi) * 100)}% OF BUILD · GOOD`}
          valueColor="var(--race)"
        />
        <SummaryCell
          label="CUTBACKS"
          value={String(t.summary.cutbacks)}
          unit=""
          sub="WK 4 · 8 · 12"
        />
      </div>

      {/* Phase breakdown strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 2.5fr 1.6fr 1.1fr auto',
          gap: 4,
          marginTop: 14,
          alignItems: 'stretch',
        }}
      >
        <PhaseStripCell tone="base" label={`BASE · ${phaseCount('base')}W`} sub={phaseRangeLabel(points, 'base')} />
        <PhaseStripCell tone="build" label={`BUILD · ${phaseCount('build')}W`} sub={phaseRangeLabel(points, 'build')} />
        <PhaseStripCell tone="peak" label={`PEAK · ${phaseCount('peak')}W`} sub={phaseRangeLabel(points, 'peak')} />
        <PhaseStripCell tone="taper" label={`TAPER · ${phaseCount('taper')}W`} sub={phaseRangeLabel(points, 'taper')} />
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--race)',
            borderRadius: 6,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: 9,
              letterSpacing: '.12em',
              color: 'rgba(255,255,255,.78)',
              fontWeight: 500,
              textTransform: 'uppercase',
            }}
          >
            ▣ RACE
          </div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '-.01em',
              color: '#fff',
              marginTop: 2,
            }}
          >
            {formatShortDate(t.raceDateISO)}
          </div>
        </div>
      </div>
    </Card>
  );
}

function PhaseLegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span>
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          background: color,
          borderRadius: 2,
          verticalAlign: 'middle',
          marginRight: 6,
        }}
      />
      {label}
    </span>
  );
}

function PhaseStripCell({
  tone,
  label,
  sub,
}: {
  tone: 'base' | 'build' | 'peak' | 'taper';
  label: string;
  sub: string;
}) {
  const TONE_COLOR: Record<typeof tone, string> = {
    base: 'var(--corp)',
    build: 'var(--good)',
    peak: 'var(--milestone)',
    taper: 'var(--race)',
  };
  const TONE_BG: Record<typeof tone, string> = {
    base: 'rgba(0,143,236,.10)',
    build: 'rgba(62,189,65,.10)',
    peak: 'rgba(243,173,56,.10)',
    taper: 'rgba(255,87,34,.10)',
  };
  const color = TONE_COLOR[tone];
  return (
    <div style={{ padding: '10px 12px', background: TONE_BG[tone], borderRadius: 6, borderLeft: `3px solid ${color}` }}>
      <div className="t-eyebrow" style={{ color }}>{label}</div>
      <div
        style={{
          fontFamily: 'var(--f-data)',
          fontSize: 10,
          color: 'var(--t2)',
          fontWeight: 600,
          marginTop: 3,
          letterSpacing: '.4px',
        }}
      >
        {sub}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Skeleton fallback
// ─────────────────────────────────────────────────────────────────────

function TrainingSkeleton() {
  return (
    <>
      <Row>
        <Card span={7} padding="26px 28px" style={{ minHeight: 420 }}>
          <Skeleton height={14} width="40%" />
          <Skeleton height={56} width="55%" />
          <Skeleton height={14} width="90%" />
          <Skeleton height={14} width="85%" />
          <Skeleton height={80} />
        </Card>
        <Card span={5} padding="24px 26px" style={{ minHeight: 420 }}>
          <Skeleton height={14} width="50%" />
          <Skeleton height={36} width="80%" />
          <Skeleton height={120} />
        </Card>
      </Row>
      <Row>
        <Card span={12} padding="18px 22px">
          <Skeleton height={36} width="40%" />
          <Skeleton height={120} />
        </Card>
      </Row>
      <Row>
        <Card span={8} padding="20px 22px">
          <Skeleton height={36} width="60%" />
          <Skeleton height={140} />
        </Card>
        <Card span={4} padding="20px 22px">
          <Skeleton height={14} width="60%" />
          <Skeleton height={48} width="80%" />
          <Skeleton height={14} width="90%" />
        </Card>
      </Row>
      <Row>
        <Card span={12} padding="22px 26px">
          <Skeleton height={36} width="40%" />
          <Skeleton height={200} />
        </Card>
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────

function KpiCell({
  label,
  value,
  unit,
  sub,
  valueFontSize = 32,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
  valueFontSize?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        className="mono-sm"
        style={{
          color: 'var(--t3)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: valueFontSize,
          letterSpacing: '-.02em',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
        {unit && <small style={{ fontSize: '.4em', opacity: 0.55, fontWeight: 700, marginLeft: 7 }}>{unit}</small>}
      </div>
      <div className="mono-sm" style={{ color: 'var(--t2)' }}>
        {sub}
      </div>
    </div>
  );
}

function fmtPaceRange(range: { lower: number; upper: number }): string {
  return `${fmtPaceLoose(range.lower)}–${fmtPaceLoose(range.upper)}`;
}

function fmtPaceLoose(sPerMi: number): string {
  if (!isFinite(sPerMi) || sPerMi <= 0) return '—';
  const mm = Math.floor(sPerMi / 60);
  const ss = Math.round(sPerMi - mm * 60);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function estimateDurationMin(w: { distanceMi: number; paceTargetSPerMi?: { lower: number; upper: number } | null }): number {
  if (!w.paceTargetSPerMi || w.distanceMi <= 0) return 28;
  const pace = (w.paceTargetSPerMi.lower + w.paceTargetSPerMi.upper) / 2;
  return Math.round((pace * w.distanceMi) / 60);
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

function formatFullDateLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const d = new Date(iso + 'T12:00:00');
  return `${dow[d.getDay()]} ${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function formatShortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function formatProofDate(iso: string): React.ReactNode {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const d = new Date(iso + 'T12:00:00');
  return (
    <>
      {dow[d.getDay()]}
      <br />
      {months[Number(m[2]) - 1]} {Number(m[3])}
    </>
  );
}

function peakWeekDateLabel(
  points: TrainingData['coach']['trajectory']['answer']['points'],
  peakIdx: number,
): string {
  if (peakIdx < 0) return '—';
  const peak = points[peakIdx];
  const start = peak.weekStartISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!start) return peak.label;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const m = months[Number(start[2]) - 1];
  const d1 = Number(start[3]);
  const d = new Date(peak.weekStartISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  const d2 = d.getUTCDate();
  const m2 = months[d.getUTCMonth()];
  const range = m === m2 ? `${m} ${d1}–${d2}` : `${m} ${d1}–${m2} ${d2}`;
  return `${range} · ${peak.label.toUpperCase()}`;
}

function phaseRangeLabel(
  points: TrainingData['coach']['trajectory']['answer']['points'],
  phase: TrainingData['coach']['trajectory']['answer']['points'][number]['phase'],
): string {
  const inPhase = points.filter((p) => p.phase === phase);
  if (inPhase.length === 0) return '—';
  const first = inPhase[0];
  const last = inPhase[inPhase.length - 1];
  const totalMi = inPhase.reduce((s, p) => s + p.plannedMi, 0);
  return `${formatShortDate(first.weekStartISO)} → ${formatShortDate(last.weekStartISO)} · ${Math.round(totalMi)} MI`;
}

function shortMonthDay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function countLoggedRuns(days: Array<{ actualMi: number | null }>): number {
  return days.filter((d) => d.actualMi != null && d.actualMi > 0).length;
}

function capitalize(s: string): string {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}
