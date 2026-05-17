'use client';

/**
 * /health · Research-grounded rebuild (May 2026).
 *
 * Source of truth: docs/HEALTH_PAGE_RESEARCH_ARCHITECTURE.md
 *
 * Architecture mirrors /overview, /training, /races:
 *   - Single useEffect loads via /api/health.
 *   - Skeleton + error fallback via <EmptyState>.
 *   - Every card is justified by a Research citation surfaced in its
 *     footer (per the audit doctrine).
 *
 * Row plan (every row maps 1:1 to the audit doc):
 *   0 · Greet band — Readiness · HRV 7D · Sleep 7D · Today check-in state
 *   1 · ExpandedDailyCheckin (span 7) + ReadinessComposite + Agreement (span 5)
 *   2 · BodySystems · 6 systems incl BONE (span 5) + HrvDetail w/ CV (span 7)
 *   3 · Sleep (span 4) + RHR (span 4) + Form CTL/ATL/TSB (span 4)
 *   4 · IllnessEarlyComposite (span 5) + VO2max (span 4) + BodyMass (span 3)
 *   5 · SubmaxHrDrift (span 6) + Cycle (span 3) + Ferritin (span 3)
 *       — Row 5 only renders when profile.sex === 'female'.
 *
 * Citations (Research/15 §X.Y) live in each card's CardFoot left slot.
 */

import { useEffect, useRef, useState } from 'react';
import { ConnectBanner } from '@/app/components/v4';
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
import {
  loadHealthData,
  formatShortDate,
  formatHoursToHMM,
  formatTopbarClock,
  type HealthData,
  type IllnessMarker,
} from './data';

export default function HealthPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [data, setData] = useState<HealthData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const { activities } = useActivities();
  const [hasSource, setHasSource] = useState<boolean | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  // Connector status — banner only shows when zero activity sources active.
  useEffect(() => {
    fetch('/api/connectors').then((r) => r.json()).then((j) => {
      const ACTIVITY = new Set(['strava','garmin','apple_health','coros','polar','suunto','wahoo','google_fit']);
      setHasSource((j?.connectors || []).some((c: { provider: string }) => ACTIVITY.has(c.provider)));
    }).catch(() => setHasSource(false));
  }, []);

  useEffect(() => {
    if (!now) return;
    let cancelled = false;
    setLoadError(null);
    loadHealthData(activities)
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
  }, [now, activities, reloadTick]);

  const reload = () => setReloadTick((t) => t + 1);

  const clock = now ? formatTopbarClock(now) : null;

  return (
    <Stage>
      <Topbar
        activeTab="health"
        clock={clock !== null ? clock : <Skeleton width={140} height={12} />}
      />

      {hasSource === false && <ConnectBanner />}

      <HealthGreet data={data} />

      {loadError && (
        <Row>
          <Card span={12}>
            <EmptyState
              variant="error"
              title="Couldn't load Health"
              body={loadError}
            />
          </Card>
        </Row>
      )}

      {data ? (
        <HealthBody data={data} onSaved={reload} />
      ) : (
        !loadError && <HealthSkeleton />
      )}
    </Stage>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Greet band — 4 KPI tiles. Replaces "SYSTEMS HEALED" with
// "CHECK-IN STATE" per the audit (Row 0 should preview the page's
// answer + the two strongest signals + whether subjective is logged).
// ─────────────────────────────────────────────────────────────────────

function HealthGreet({ data }: { data: HealthData | null }) {
  if (!data) {
    return (
      <Greet>
        <GreetId
          eyebrow={<Skeleton width={300} height={11} />}
          title={<Skeleton width={180} height={48} />}
        />
        <GreetState>
          {[0, 1, 2, 3].map((i) => (
            <GreetTile key={i} eyebrow="—" value={<Skeleton width={56} height={20} />} />
          ))}
        </GreetState>
      </Greet>
    );
  }

  const { readiness, sleep, hrvDetail, expandedCheckin, bodySystems } = data;
  // Sleep is HealthKit-blocked — when sleep.current is null, surface
  // the tile as NO DATA YET rather than computing a fake H:MM string.
  const sleepDisplay = sleep.current != null ? formatHoursToHMM(sleep.current) : '—';
  const sleepGoalDelta = sleep.current != null
    ? Math.round((sleep.current - sleep.goalHrs[0]) * 60)
    : null;
  const hrvHasData = hrvDetail.isAvailable && hrvDetail.current != null;

  const greetVariant =
    readiness.pinVariant === 'green' ? 'good'
    : readiness.pinVariant === 'amber' ? 'amber'
    : 'race';

  // Check-in tile — surfaces whether today's subjective wellness is
  // logged. Per Saw 2016 this is the page's strongest single signal.
  const checkinLogged = expandedCheckin.score != null;

  // Body-systems tile · count of fully-healed systems vs total (5th tile).
  const bs = bodySystems.answer;
  const healedCount = bs.systems.filter((s) => s.state === 'done').length;
  const totalSystems = bs.systems.length;
  const allHealed = healedCount === totalSystems;

  return (
    <Greet>
      <GreetId eyebrow={data.greetEyebrow} title="HEALTH" />
      <GreetState>
        <GreetTile
          variant={greetVariant}
          eyebrow="READINESS"
          value={String(readiness.score)}
          unit="/100"
          delta={readiness.headlineLabel}
          deltaColor={
            readiness.pinVariant === 'green' ? 'var(--good)'
            : readiness.pinVariant === 'amber' ? 'var(--att)'
            : 'var(--warn)'
          }
        />
        <GreetTile
          variant={hrvHasData ? 'good' : 'amber'}
          eyebrow="HRV · 7D AVG"
          value={hrvHasData ? String(hrvDetail.current) : '—'}
          unit={hrvHasData ? 'ms' : ''}
          delta={hrvHasData
            ? `BASE ${hrvDetail.baseline}ms · CV ${hrvDetail.cv}%`
            : 'AWAITING HEALTHKIT'}
          deltaColor={hrvHasData
            ? (hrvDetail.plewsVerdict === 'stable' ? 'var(--good)' : 'var(--warn)')
            : 'var(--att)'}
        />
        <GreetTile
          variant={sleep.isAvailable ? 'coach' : 'amber'}
          eyebrow="SLEEP · 7D AVG"
          value={sleepDisplay}
          unit={sleep.isAvailable ? 'HRS' : ''}
          delta={sleepGoalDelta != null
            ? `${sleepGoalDelta >= 0 ? '+' : ''}${sleepGoalDelta}M vs GOAL`
            : 'AWAITING HEALTHKIT'}
          deltaColor={sleepGoalDelta != null
            ? (sleepGoalDelta >= 0 ? 'var(--good)' : 'var(--warn)')
            : 'var(--att)'}
        />
        <GreetTile
          variant={allHealed ? 'good' : 'amber'}
          eyebrow="BODY SYSTEMS"
          value={`${healedCount}`}
          unit={`/${totalSystems}`}
          delta={allHealed ? 'ALL HEALED' : `QUALITY EST ${formatShortDate(bs.qualityReturnsISO)}`}
          deltaColor={allHealed ? 'var(--good)' : 'var(--att)'}
        />
        <GreetTile
          variant={checkinLogged ? 'good' : 'amber'}
          eyebrow="CHECK-IN STATE"
          value={checkinLogged ? '✓' : '—'}
          delta={checkinLogged ? `${expandedCheckin.label?.toUpperCase()} · LOGGED` : 'TAP TO LOG TODAY'}
          deltaColor={checkinLogged ? 'var(--good)' : 'var(--att)'}
        />
      </GreetState>
    </Greet>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────────

function HealthBody({ data, onSaved }: { data: HealthData; onSaved: () => void }) {
  const showRow5 = data.profile.sex === 'female';
  return (
    <>
      {/* ROW 1 — Subjective state + composite (audit Row 1) */}
      <Row>
        <ExpandedDailyCheckinCard data={data} onSaved={onSaved} />
        <ReadinessCompositeCard data={data} />
      </Row>

      {/* ROW 2 — Body Systems (6 incl BONE) + HRV detail w/ CV */}
      <Row>
        <BodySystemsCard data={data} />
        <HrvDetailCard data={data} />
      </Row>

      {/* ROW 3 — Recovery foundations: Sleep · RHR · Form */}
      <Row>
        <SleepCard data={data} />
        <RhrCard data={data} />
        <FormCard data={data} />
      </Row>

      {/* ROW 4 — Illness composite · VO2max · Body Mass */}
      <Row>
        <IllnessEarlyCompositeCard data={data} />
        <Vo2MaxCard data={data} />
        <BodyMassCard data={data} />
      </Row>

      {/* ROW 5 — Submax HR drift always shows; Cycle + Ferritin only female */}
      <Row>
        <SubmaxHrDriftCard data={data} />
        {showRow5 && data.cycle && <CycleCard cycle={data.cycle} />}
        {showRow5 && data.ferritin && <FerritinCard ferritin={data.ferritin} />}
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 1A · ExpandedDailyCheckinCard (span 7)
// Audit: Saw 2016 — subjective wins ties. /Research/15 §Decision Matrix.
// ─────────────────────────────────────────────────────────────────────

function ExpandedDailyCheckinCard({ data, onSaved }: { data: HealthData; onSaved: () => void }) {
  const c = data.expandedCheckin;
  const todayShort = formatShortDate(data.today);
  const agree = data.subjectiveAgreement;

  // Slider state · seeded from the persisted check-in row if one
  // exists for today, otherwise null until the user moves a slider.
  const [energy, setEnergy] = useState<number | null>(c.energy);
  const [soreness, setSoreness] = useState<number | null>(c.soreness);
  const [stress, setStress] = useState<number | null>(c.stress);

  // Logged gate · true when a row exists in daily_checkin for today
  // (server-side truth) AND the local sliders match. Editing flips
  // it back to false so the runner has to re-confirm.
  const [hasLogged, setHasLogged] = useState<boolean>(c.score != null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const allFilled = energy != null && soreness != null && stress != null;
  const logged = hasLogged && allFilled;
  const canLog = allFilled && !hasLogged && !saving;

  async function handleLog() {
    if (!allFilled || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/health/checkin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ energy, soreness, stress, date: data.today }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setHasLogged(true);
      // Refresh parent health data so the greet tile + composite both
      // pick up the new check-in immediately.
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  function handleEdit() {
    setHasLogged(false);
  }

  return (
    <Card span={7} padding="18px 22px" wash={logged ? undefined : 'amber'}>
      <CardHeader>
        <CardLabel color={logged ? undefined : 'var(--att)'}>
          ▸ DAILY CHECK-IN · {todayShort}
        </CardLabel>
        <CardPin variant={logged ? 'green' : 'amber'}>
          {logged ? '✓ LOGGED' : 'NOT YET'}
        </CardPin>
      </CardHeader>

      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-.02em',
          lineHeight: 1.1,
          textTransform: 'uppercase',
          marginTop: 6,
        }}
      >
        {logged ? 'Logged for today' : 'How are you feeling today?'}
      </div>
      <div
        className="t-body"
        style={{ color: 'var(--t2)', fontSize: 12.5, marginTop: 4, maxWidth: 540 }}
      >
        {data.greetSub}
      </div>

      {/* 3 Hooper-axis sliders — the only input mechanism. Each axis is its
          own emoji-marked slider so all three dimensions can be rated
          independently (per Hooper questionnaire — Research/15 §Decision Matrix). */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          marginTop: 18,
          paddingTop: 14,
          borderTop: '1px solid var(--l4)',
        }}
      >
        <SliderRow
          label="ENERGY"
          value={energy}
          onChange={(v) => { setEnergy(v); setHasLogged(false); }}
          hint="1=DRAINED · 10=PEAK"
          lowEmoji="😴"
          highEmoji="🚀"
          goodHigh
        />
        <SliderRow
          label="SORENESS"
          value={soreness}
          onChange={(v) => { setSoreness(v); setHasLogged(false); }}
          hint="1=NONE · 10=HURTING"
          lowEmoji="🙂"
          highEmoji="🤕"
          goodHigh={false}
        />
        <SliderRow
          label="STRESS"
          value={stress}
          onChange={(v) => { setStress(v); setHasLogged(false); }}
          hint="1=CALM · 10=FRAYED"
          lowEmoji="😌"
          highEmoji="😣"
          goodHigh={false}
        />
      </div>

      {/* LOG button row · left side anchors the row with a status line so the
          button doesn't float orphaned at the right. Three states: logged
          (shows timestamp + EDIT), ready (shows hint + LOG TODAY), incomplete
          (shows requirement + disabled button). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--l4)',
        }}
      >
        <span
          className="mono-sm"
          style={{
            color: logged ? 'var(--good)' : 'var(--t3)',
            fontSize: 10,
            letterSpacing: '.12em',
          }}
        >
          {logged
            ? '✓ COMMITTED · COACH IS USING TODAY\'S READINGS'
            : canLog
            ? '◆ READY TO COMMIT'
            : 'RATE ALL THREE TO LOG'}
        </span>
        {logged ? (
          <button
            type="button"
            className="btn-flat btn-secondary"
            onClick={handleEdit}
            style={{ minWidth: 96 }}
          >
            EDIT
          </button>
        ) : (
          <button
            type="button"
            className="btn-flat btn-primary"
            onClick={handleLog}
            disabled={!canLog}
            style={{
              minWidth: 120,
              opacity: canLog ? 1 : 0.5,
              cursor: canLog ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? 'SAVING…' : '▸ LOG TODAY'}
          </button>
        )}
      </div>

      {saveError && (
        <div style={{
          marginTop: 8,
          padding: '8px 12px',
          fontSize: 12,
          color: 'var(--warn)',
          background: 'rgba(252,77,84,.08)',
          border: '1px solid rgba(252,77,84,.30)',
          borderRadius: 6,
        }}>
          Couldn&apos;t save your check-in: {saveError}
        </div>
      )}

      {/* Agreement chip — the divergence rule made visible. */}
      <div
        style={{
          marginTop: 14,
          padding: '10px 12px',
          background:
            agree.agreementDirection === 'match' ? 'rgba(62,189,65,.06)'
            : agree.agreementDirection === 'no_subjective' ? 'var(--l2)'
            : 'rgba(243,173,56,.08)',
          border:
            agree.agreementDirection === 'match' ? '1px solid rgba(62,189,65,.22)'
            : agree.agreementDirection === 'no_subjective' ? '1px solid var(--l4)'
            : '1px solid rgba(243,173,56,.28)',
          borderRadius: 8,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <div className="t-eyebrow" style={{ color: 'var(--t2)' }}>
            AGREEMENT · SUBJECTIVE vs WEARABLE
          </div>
          <div
            className="t-eyebrow"
            style={{
              color:
                agree.agreementDirection === 'match' ? 'var(--good)'
                : agree.agreementDirection === 'no_subjective' ? 'var(--t3)'
                : 'var(--att)',
            }}
          >
            {agree.agreementLabel}
          </div>
        </div>
        <div className="t-body" style={{ color: 'var(--t1)', fontSize: 12, marginTop: 6 }}>
          {agree.tieBreakerNote}
        </div>
      </div>

      <CardFoot
        left="How you feel is the strongest single signal — when it disagrees with your wearables, trust how you feel."
      />
    </Card>
  );
}

/** Single 1–10 slider row inside the check-in card. */
function SliderRow({
  label,
  value,
  onChange,
  hint,
  goodHigh,
  lowEmoji,
  highEmoji,
}: {
  label: string;
  value: number | null;
  onChange?: (v: number) => void;
  hint: string;
  /** True if higher values are healthier (energy). False for soreness/stress. */
  goodHigh: boolean;
  /** Emoji on the low end of this dimension's scale (e.g. 😴 for low energy). */
  lowEmoji?: string;
  /** Emoji on the high end (e.g. 🚀 for peak energy). */
  highEmoji?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const v = value ?? null;
  const pct = v != null ? Math.round((v / 10) * 100) : 0;

  // Click-to-set + drag-to-set on the track. Maps click x position to 1-10.
  // Pointer events handle both mouse and touch with a single code path.
  function setFromPointer(clientX: number) {
    if (!onChange || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const next = Math.max(1, Math.min(10, Math.round(ratio * 10)));
    onChange(next);
  }
  const tone =
    v == null
      ? 'var(--t3)'
      : goodHigh
      ? v >= 7
        ? 'var(--good)'
        : v >= 4
        ? 'var(--att)'
        : 'var(--warn)'
      : v <= 3
      ? 'var(--good)'
      : v <= 6
      ? 'var(--att)'
      : 'var(--warn)';
  return (
    <div>
      <div className="t-eyebrow" style={{ color: 'var(--t2)' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 28,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-.02em',
            color: tone,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {v != null ? v : '—'}
        </div>
        <small style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.5px' }}>/10</small>
      </div>
      {/* Interactive slider · click or drag on the track to set value 1-10.
          Hit area is enlarged with extra padding above/below the visible track
          to make tap targets comfortable on touch devices. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        {lowEmoji && <span style={{ fontSize: 14, opacity: 0.7 }}>{lowEmoji}</span>}
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-valuemin={1}
          aria-valuemax={10}
          aria-valuenow={v ?? undefined}
          aria-label={label}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setFromPointer(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) setFromPointer(e.clientX);
          }}
          onKeyDown={(e) => {
            if (!onChange) return;
            const cur = v ?? 5;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault();
              onChange(Math.min(10, cur + 1));
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault();
              onChange(Math.max(1, cur - 1));
            }
          }}
          style={{
            flex: 1,
            position: 'relative',
            padding: '12px 0',
            cursor: onChange ? 'pointer' : 'default',
            touchAction: 'none',
          }}
        >
          {/* Background track */}
          <div
            style={{
              height: 6,
              background: 'var(--l3)',
              borderRadius: 3,
              overflow: 'visible',
              position: 'relative',
            }}
          >
            {/* Filled portion */}
            <i
              style={{
                display: 'block',
                height: '100%',
                width: `${pct}%`,
                background: tone,
                borderRadius: 3,
                pointerEvents: 'none',
              }}
            />
            {/* Thumb */}
            {v != null && (
              <span
                style={{
                  position: 'absolute',
                  left: `calc(${pct}% - 8px)`,
                  top: -5,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: tone,
                  border: '2px solid var(--l1)',
                  boxShadow: `0 0 0 2px ${tone}`,
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </div>
        {highEmoji && <span style={{ fontSize: 14, opacity: 0.7 }}>{highEmoji}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 1B · ReadinessCompositeCard (span 5)
// Adds tie-breaker line surfacing the Saw-2016 disagreement rule.
// ─────────────────────────────────────────────────────────────────────

function ReadinessCompositeCard({ data }: { data: HealthData }) {
  const r = data.readiness;
  const ringRadius = 78;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const dashOffset = ringCircumference * (1 - r.score / 100);
  const ringColor =
    r.pinVariant === 'green' ? 'var(--good)'
    : r.pinVariant === 'amber' ? 'var(--att)'
    : 'var(--warn)';

  return (
    <Card span={5} padding="18px 20px">
      <CardHeader>
        <CardLabel>READINESS · COMPOSITE</CardLabel>
        <CardPin variant={r.pinVariant}>{r.pinLabel}</CardPin>
      </CardHeader>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '180px 1fr',
          gap: 22,
          alignItems: 'center',
          marginTop: 6,
        }}
      >
        <svg viewBox="0 0 200 200" style={{ width: 180, height: 180 }}>
          <defs>
            <linearGradient id="readiness-ring" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#3EBD41" />
              <stop offset="60%" stopColor="#27E087" />
              <stop offset="100%" stopColor="#7CD97F" />
            </linearGradient>
          </defs>
          <circle cx="100" cy="100" r={ringRadius} fill="none" stroke="rgba(244,246,248,.06)" strokeWidth="13" />
          <circle
            cx="100"
            cy="100"
            r={ringRadius}
            fill="none"
            stroke="url(#readiness-ring)"
            strokeWidth="13"
            strokeDasharray={ringCircumference}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 100 100)"
            strokeLinecap="round"
          />
          <text
            x="100"
            y="94"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="Oswald"
            fontWeight="700"
            fontSize="76"
            letterSpacing="-2"
            fill="#F4F6F8"
          >
            {r.score}
          </text>
          <text
            x="100"
            y="134"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="JetBrains Mono"
            fontWeight="700"
            fontSize="11"
            fill={ringColor}
            letterSpacing="1.8"
          >
            / 100
          </text>
        </svg>
        <div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: '-.01em',
              lineHeight: 1,
              textTransform: 'uppercase',
              color: ringColor,
            }}
          >
            {r.headlineLabel}
          </div>
          <div className="t-eyebrow" style={{ color: 'var(--t2)', marginTop: 4 }}>
            {r.scoreContextLabel}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
            {r.signals.map((s) => {
              const barColor =
                s.tone === 'good' ? 'var(--good)' : s.tone === 'warn' ? 'var(--warn)' : 'var(--t3)';
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 48px',
                    gap: 8,
                    alignItems: 'center',
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: 'var(--t1)', fontWeight: 500 }}>{s.label}</span>
                  <div
                    style={{
                      width: 48,
                      height: 4,
                      background: 'var(--l3)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <i
                      style={{
                        display: 'block',
                        height: '100%',
                        width: `${Math.round(s.fill * 100)}%`,
                        background: barColor,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <CardFoot
        left="Composite of sleep, HRV, RHR, training load, and your check-in. Sub-1.3 ACWR means recovery is keeping up."
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 2A · BodySystemsCard (span 5) — 6 systems including BONE.
// Audit: 00b §Reverse Periodization lists 6 tissues. The legacy UI
// collapsed bone into connective; the rebuild surfaces BONE as its
// own row (synthesized here until BodySystem type adds the 'bone' id).
// ─────────────────────────────────────────────────────────────────────

interface SixthSystem {
  id: string;
  label: string;
  windowLabel: string;
  state: 'done' | 'building' | 'stressed';
  readiness: number;
  healedByISO: string | null;
  daysToHealed: number;
}

function BodySystemsCard({ data }: { data: HealthData }) {
  const report = data.bodySystems.answer;
  const recentRace = data.state.races.recent[0] ?? null;
  const recentLabel = recentRace
    ? `DAY ${report.daysSincePeakStress} POST-${shortRaceLabel(recentRace.name)}`
    : `${report.daysSincePeakStress} DAYS SINCE LAST HARD`;

  // Synthesize a 6th BONE row from the connective row. Bone has a
  // longer window (3–6w per Research/00b) so we extend the healed
  // date by ~14 days.
  const connective = report.systems.find((s) => s.id === 'connective');
  const boneRow: SixthSystem | null = connective
    ? {
        id: 'bone',
        label: 'BONE',
        windowLabel: '3-6w',
        state: connective.readiness >= 0.95 ? 'done' : 'building',
        readiness: Math.max(0, Math.min(1, connective.readiness - 0.08)),
        healedByISO: connective.healedByISO,
        daysToHealed: connective.daysToHealed + 14,
      }
    : null;

  // Insert BONE between CONNECTIVE and CNS to match research order.
  const orderedSystems: Array<SixthSystem | typeof report.systems[number]> = [];
  for (const sys of report.systems) {
    orderedSystems.push(sys);
    if (sys.id === 'connective' && boneRow) orderedSystems.push(boneRow);
  }

  return (
    <Card span={5} padding="18px 20px">
      <CardHeader>
        <CardLabel>YOUR BODY · {recentLabel}</CardLabel>
        <CardPin variant="coach">{report.contextLabel}</CardPin>
      </CardHeader>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6 }}>
        {orderedSystems.map((sys) => {
          const color = sys.state === 'done' ? 'var(--good)' : sys.state === 'building' ? 'var(--coach)' : 'var(--warn)';
          const healedLine =
            sys.state === 'done'
              ? `✓ HEALED ${sys.healedByISO ? formatShortDate(sys.healedByISO) : ''}`
              : `→ HEALED ${sys.healedByISO ? formatShortDate(sys.healedByISO) : '—'} · ${sys.daysToHealed}d`;
          return (
            <div
              key={sys.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '14px 1fr 70px 56px',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: color,
                }}
              />
              <div>
                <div style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>
                  {sys.label}{' '}
                  <span style={{ color: 'var(--t3)', fontWeight: 500, fontSize: 10.5 }}>
                    · {sys.windowLabel}
                  </span>
                </div>
                <div className="mono-sm" style={{ color, marginTop: 2, fontSize: 9 }}>
                  {healedLine}
                </div>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: 'var(--l3)', overflow: 'hidden' }}>
                <i
                  style={{
                    display: 'block',
                    height: '100%',
                    background: color,
                    width: `${Math.round(sys.readiness * 100)}%`,
                  }}
                />
              </div>
              <div
                style={{
                  fontFamily: 'var(--f-data)',
                  fontSize: 10.5,
                  letterSpacing: '.6px',
                  color,
                  textAlign: 'right',
                  fontWeight: 600,
                }}
              >
                {Math.round(sys.readiness * 100)}%
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          padding: '8px 12px',
          background: 'rgba(39,180,224,.08)',
          border: '1px solid rgba(39,180,224,.25)',
          borderRadius: 6,
          marginTop: 10,
        }}
      >
        <div className="mono-sm" style={{ color: 'var(--coach)' }}>QUALITY RETURNS · EST</div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 600,
            fontSize: 14,
            lineHeight: 1,
            textTransform: 'uppercase',
            color: 'var(--t1)',
          }}
        >
          {formatShortDate(report.qualityReturnsISO)}
        </div>
      </div>

      <CardFoot
        left="Different tissues recover at different speeds after hard efforts. Quality work waits for the slowest one."
      />
    </Card>
  );
}

function shortRaceLabel(name: string): string {
  return name
    .replace(/\b(marathon|half|10k|5k|race)\b/gi, '')
    .trim()
    .toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────
// ROW 2B · HrvDetailCard (span 7) — current/baseline/CV/trend.
// Audit: /Research/15 §HRV — Plews approach §5. CV is the first-line
// destabilization signal.
// ─────────────────────────────────────────────────────────────────────

function HrvDetailCard({ data }: { data: HealthData }) {
  const h = data.hrvDetail;
  // HealthKit-blocked. When HRV is unavailable, render the card title +
  // citation but show NO DATA YET in place of the metric tiles + chart.
  if (!h.isAvailable || h.current == null || h.baseline == null || h.cv == null) {
    return (
      <Card span={7} padding="18px 20px">
        <CardHeader>
          <CardLabel>HRV DETAIL · 30-DAY</CardLabel>
          <CardPin variant="amber">AWAITING HEALTHKIT</CardPin>
        </CardHeader>
        <EmptyState
          title="NO DATA YET"
          body="Once HealthKit is connected, your HRV (LnRMSSD), 30-day baseline, CV (Plews §5) and trend will populate here."
        />
        <CardFoot left={h.citation} />
      </Card>
    );
  }
  const tone =
    h.plewsVerdict === 'stable' ? 'var(--good)'
    : h.plewsVerdict === 'drifting' ? 'var(--att)'
    : 'var(--warn)';
  const pinVariant =
    h.plewsVerdict === 'stable' ? 'green'
    : h.plewsVerdict === 'drifting' ? 'amber'
    : 'warn';

  return (
    <Card span={7} padding="18px 20px">
      <CardHeader>
        <CardLabel>HRV DETAIL · 30-DAY</CardLabel>
        <CardPin variant={pinVariant}>{h.plewsLabel}</CardPin>
      </CardHeader>

      {/* 4-tile breakdown */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 10,
          marginTop: 10,
        }}
      >
        <HrvTile label="CURRENT" value={String(h.current)} unit="ms" color={tone} />
        <HrvTile label="BASELINE" value={String(h.baseline)} unit="ms" color="var(--t1)" />
        <HrvTile
          label="CV"
          value={`${h.cv}`}
          unit="%"
          color={h.cv < 8 ? 'var(--good)' : h.cv < 12 ? 'var(--att)' : 'var(--warn)'}
          subtitle="(Plews §5)"
        />
        <HrvTile label="TREND" value={h.trendDirection ?? '—'} unit="" color={tone} valueFontSize={18} />
      </div>

      {/* 30-day daily HRV bars · one bar per morning reading. Bars above the
          baseline are tinted by the verdict tone; bars at or below baseline
          are muted. Fills remaining card height. */}
      <div
        style={{
          marginTop: 14,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 100,
        }}
      >
        <div
          className="t-eyebrow"
          style={{
            marginBottom: 6,
            display: 'flex',
            justifyContent: 'space-between',
            color: 'var(--t3)',
          }}
        >
          <span>HRV PER MORNING · LAST 30 DAYS</span>
          <span style={{ color: 'var(--t3)' }}>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: tone,
              opacity: 0.8,
              marginRight: 4,
              verticalAlign: 'middle',
              borderRadius: 1,
            }} />
            ABOVE BASE
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: 'rgba(244,246,248,.22)',
              marginLeft: 10,
              marginRight: 4,
              verticalAlign: 'middle',
              borderRadius: 1,
            }} />
            BELOW
          </span>
        </div>
        <BarSeries
          series={h.series30d}
          baseline={h.baseline}
          aboveColor={tone}
          belowColor="rgba(244,246,248,.22)"
          xLabels={['30D AGO', '20D', '10D', 'TODAY']}
          xLabelIndices={[0, 9, 19, h.series30d.length - 1]}
        />
      </div>

      <CardFoot
        left="Your nervous system's daily readiness score. Higher is recovered; CV measures how steady that is week to week."
      />
    </Card>
  );
}

function HrvTile({
  label,
  value,
  unit,
  color,
  subtitle,
  valueFontSize = 28,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
  subtitle?: string;
  valueFontSize?: number;
}) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--l2)', borderRadius: 8 }}>
      <div className="t-eyebrow">{label}</div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: valueFontSize,
          letterSpacing: '-.02em',
          lineHeight: 1,
          color,
          marginTop: 6,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
        {unit && <small style={{ fontSize: '.4em', opacity: .55, fontWeight: 700, marginLeft: 4 }}>{unit}</small>}
      </div>
      {subtitle && (
        <div className="mono-sm" style={{ marginTop: 4, color: 'var(--t3)', fontSize: 8.5 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 3A · SleepCard (span 4) — VitalTile shape + efficiency surfaced.
// ─────────────────────────────────────────────────────────────────────

function SleepCard({ data }: { data: HealthData }) {
  const s = data.sleep;
  // HealthKit-blocked. Render NO DATA YET when sleep stream is empty.
  if (!s.isAvailable || s.current == null || s.deepHrs == null || s.remHrs == null) {
    return (
      <Card span={4} padding="18px 20px">
        <CardHeader>
          <CardLabel>SLEEP</CardLabel>
          <CardPin variant="amber">AWAITING HEALTHKIT</CardPin>
        </CardHeader>
        <EmptyState
          title="NO DATA YET"
          body={`Once HealthKit is connected, sleep duration, deep/REM, and efficiency will populate here. Goal ${s.goalHrs[0]}–${s.goalHrs[1]}h.`}
        />
        <CardFoot left="Total sleep, deep, REM, and how efficiently you slept. Deep + REM > 3 hours signals a recovery night." />
      </Card>
    );
  }
  const display = formatHoursToHMM(s.current);
  const goalDeltaMin = Math.round((s.current - s.goalHrs[0]) * 60);
  const onGoal = goalDeltaMin >= 0;
  return (
    <VitalTile
      span={4}
      label="SLEEP"
      pinText={onGoal ? '▲ ON GOAL' : '▼ SHORT'}
      pinVariant={onGoal ? 'green' : 'amber'}
      value={display}
      unit="hrs"
      sub={`GOAL ${s.goalHrs[0]}–${s.goalHrs[1]}H · DEEP ${formatHoursToHMM(s.deepHrs)} · REM ${formatHoursToHMM(s.remHrs)}`}
      series={s.series7d}
      seriesColor="#27B4E0"
      baseline={s.goalHrs[0]}
      goodHigh
      chartPeriod="LAST 7 NIGHTS"
      blurb="Total sleep, deep, REM, and how efficiently you slept. Deep + REM > 3 hours signals a recovery night."
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 3B · RhrCard (span 4) — with subjective context line.
// ─────────────────────────────────────────────────────────────────────

function RhrCard({ data }: { data: HealthData }) {
  const r = data.rhr;
  // HealthKit-blocked. Render NO DATA YET when RHR stream is empty.
  if (!r.isAvailable || r.current == null || r.baseline == null) {
    return (
      <Card span={4} padding="18px 20px">
        <CardHeader>
          <CardLabel>RHR</CardLabel>
          <CardPin variant="amber">AWAITING HEALTHKIT</CardPin>
        </CardHeader>
        <EmptyState
          title="NO DATA YET"
          body="Once HealthKit is connected, morning resting heart rate and its 7/30-day trend will populate here."
        />
        <CardFoot left="Morning resting heart rate. Trending up over baseline is an early signal of accumulated stress or illness." />
      </Card>
    );
  }
  const trend = r.current - r.baseline;
  const fresher = trend < 0;
  const coachLine =
    Math.abs(trend) <= 1
      ? 'Coach says: stable.'
      : fresher
      ? 'Coach says: recovering well.'
      : 'Coach says: elevated — watch sleep + load.';
  return (
    <VitalTile
      span={4}
      label="RHR"
      pinText={fresher ? '▼ FRESH' : '▲ ELEVATED'}
      pinVariant={fresher ? 'green' : 'warn'}
      value={String(r.current)}
      unit="bpm"
      sub={`BASE ${r.baseline} · ${coachLine}`}
      series={r.series30d ?? r.series7d}
      seriesColor="#008FEC"
      baseline={r.baseline}
      goodHigh={false}
      chartPeriod={r.series30d ? 'LAST 30 DAYS' : 'LAST 7 DAYS'}
      blurb="Morning resting heart rate. Trending up over baseline is an early signal of accumulated stress or illness."
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 3C · FormCard (span 4) — NEW. CTL · ATL · TSB with operating
// band shading. TSB hero. Cite /Research/00a §CTL/ATL/TSB.
// ─────────────────────────────────────────────────────────────────────

function FormCard({ data }: { data: HealthData }) {
  const f = data.formReport;
  const bandColor =
    f.tsbBand === 'fresh' ? 'var(--good)'
    : f.tsbBand === 'optimal' ? 'var(--corp)'
    : f.tsbBand === 'overreached' ? 'var(--att)'
    : 'var(--warn)';
  const pinVariant =
    f.tsbBand === 'fresh' ? 'green'
    : f.tsbBand === 'optimal' ? 'blue'
    : f.tsbBand === 'overreached' ? 'amber'
    : 'warn';

  return (
    <Card span={4} padding="18px 20px">
      <CardHeader>
        <CardLabel>FORM · CTL/ATL/TSB</CardLabel>
        <CardPin variant={pinVariant}>{f.bandLabel}</CardPin>
      </CardHeader>

      {/* TSB hero */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          marginTop: 10,
          paddingBottom: 12,
          borderBottom: '1px solid var(--l4)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 48,
            fontWeight: 700,
            letterSpacing: '-.02em',
            lineHeight: 1,
            color: bandColor,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {f.tsb >= 0 ? '+' : ''}{f.tsb}
        </div>
        <div>
          <div className="t-eyebrow">TSB · FORM</div>
          <div className="mono-sm" style={{ color: 'var(--t2)', marginTop: 4 }}>
            {f.ctl} FITNESS − {f.atl} FATIGUE
          </div>
        </div>
      </div>

      {/* CTL / ATL pair */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <div>
          <div className="t-eyebrow">CTL · 28D</div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 700,
              fontSize: 24,
              lineHeight: 1,
              marginTop: 4,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {f.ctl}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="t-eyebrow">ATL · 7D</div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 700,
              fontSize: 24,
              lineHeight: 1,
              marginTop: 4,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--good)',
            }}
          >
            {f.atl}
          </div>
        </div>
      </div>

      {/* Operating-band shading bar */}
      <div style={{ marginTop: 14 }}>
        <div className="t-eyebrow" style={{ marginBottom: 6 }}>OPERATING BAND</div>
        <FormBandBar tsb={f.tsb} />
      </div>

      <CardFoot
        left="Fitness minus fatigue. Negative TSB means you're training; positive means you're fresh. -10 to -30 is the productive zone."
      />
    </Card>
  );
}

/** Visual operating-band bar for TSB. Reference bands per /Research/15 §Fitness/Fatigue/Form:
 *  fresh > +5 · optimal -30 to +5 · overreached -40 to -30 · dig-hole < -40. */
function FormBandBar({ tsb }: { tsb: number }) {
  // Map TSB range [-50, +20] to a 0–100 bar position.
  const min = -50, max = 20;
  const pos = Math.max(0, Math.min(100, ((tsb - min) / (max - min)) * 100));
  return (
    <div style={{ position: 'relative', height: 22 }}>
      <div
        style={{
          display: 'flex',
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          background: 'var(--l3)',
        }}
      >
        {/* dig hole · overreached · optimal · fresh — proportional widths */}
        <div style={{ flex: (10 / 70), background: 'rgba(252,77,100,.55)' }} title="DIG HOLE" />
        <div style={{ flex: (10 / 70), background: 'rgba(243,173,56,.55)' }} title="OVERREACHED" />
        <div style={{ flex: (35 / 70), background: 'rgba(0,143,236,.55)' }} title="OPTIMAL" />
        <div style={{ flex: (15 / 70), background: 'rgba(62,189,65,.55)' }} title="FRESH" />
      </div>
      {/* Pointer at current TSB */}
      <div
        style={{
          position: 'absolute',
          top: -2,
          left: `${pos}%`,
          width: 2,
          height: 12,
          background: 'var(--t0)',
          transform: 'translateX(-1px)',
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'var(--f-data)',
          fontSize: 8,
          color: 'var(--t3)',
          letterSpacing: '.5px',
          fontWeight: 700,
          marginTop: 4,
        }}
      >
        <span>−50</span>
        <span>−30</span>
        <span>0</span>
        <span>+20</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 4A · IllnessEarlyCompositeCard (span 5)
// Audit: /Research/15 §Spotting Illness Early — 5 markers, 3+ firing = illness within 48-72h.
// ─────────────────────────────────────────────────────────────────────

function IllnessEarlyCompositeCard({ data }: { data: HealthData }) {
  const ic = data.illnessComposite;
  // HealthKit-blocked. All 5 markers (RHR/HRV/sleep eff/body temp/resp
  // rate) require HealthKit. Render NO DATA YET until ingestion lands.
  if (!ic.isAvailable || ic.markers.length === 0) {
    return (
      <Card span={5} padding="18px 20px">
        <CardHeader>
          <CardLabel>ILLNESS EARLY · 5 MARKERS</CardLabel>
          <CardPin variant="amber">AWAITING HEALTHKIT</CardPin>
        </CardHeader>
        <EmptyState
          title="NO DATA YET"
          body="Once HealthKit is connected, RHR, HRV, sleep efficiency, body temperature, and respiratory rate will populate here — 3+ drifting at once is the early-warning trigger."
        />
        <CardFoot left={ic.citation} />
      </Card>
    );
  }
  const pinVariant =
    ic.compositeVerdict === 'allClear' ? 'green'
    : ic.compositeVerdict === 'oneDrift' ? 'amber'
    : ic.compositeVerdict === 'risk' ? 'warn'
    : 'warn';

  const verdictColor =
    ic.compositeVerdict === 'allClear' ? 'var(--good)'
    : ic.compositeVerdict === 'oneDrift' ? 'var(--att)'
    : 'var(--warn)';

  return (
    <Card span={5} padding="18px 20px">
      <CardHeader>
        <CardLabel>ILLNESS EARLY · 5 MARKERS</CardLabel>
        <CardPin variant={pinVariant}>{ic.verdictLabel}</CardPin>
      </CardHeader>

      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: '-.01em',
          color: verdictColor,
          textTransform: 'uppercase',
          marginTop: 6,
        }}
      >
        {ic.markersFiring}/5 firing
      </div>
      <div className="t-eyebrow" style={{ color: 'var(--t2)', marginTop: 4 }}>
        3+ AT ONCE · ILLNESS WITHIN 48–72H
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {ic.markers.map((m) => (
          <IllnessMarkerRow key={m.id} marker={m} />
        ))}
      </div>

      <CardFoot
        left="Five early-warning markers. Three or more drifting at once usually means illness within 48-72 hours."
      />
    </Card>
  );
}

function IllnessMarkerRow({ marker }: { marker: IllnessMarker }) {
  const color = marker.warningTriggered ? 'var(--warn)' : 'var(--good)';
  const statusLabel = marker.warningTriggered ? '▲ WATCH' : '✓ CLEAR';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '14px 1fr auto auto',
        gap: 14,
        alignItems: 'center',
        padding: '6px 0',
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: color,
          marginLeft: 2,
        }}
      />
      <div>
        <div style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>{marker.label}</div>
        <div className="mono-sm" style={{ color: 'var(--t3)', fontSize: 10, marginTop: 2 }}>
          {marker.current}{marker.unit} · BASE {marker.baseline}{marker.unit} · {marker.deltaLabel}
        </div>
      </div>
      <span
        className="mono-sm"
        style={{
          color,
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: '.12em',
          padding: '4px 10px',
          background: marker.warningTriggered ? 'rgba(252,77,100,.10)' : 'rgba(62,189,65,.10)',
          border: marker.warningTriggered ? '1px solid rgba(252,77,100,.28)' : '1px solid rgba(62,189,65,.22)',
          borderRadius: 4,
          whiteSpace: 'nowrap',
        }}
      >
        {statusLabel}
      </span>
      <span style={{ width: 4 }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 4B · Vo2MaxCard (span 4) — 6-month trend, de-emphasized percentile.
// ─────────────────────────────────────────────────────────────────────

function Vo2MaxCard({ data }: { data: HealthData }) {
  const v = data.vo2max;
  // HealthKit-blocked. Render NO DATA YET when VO2Max samples are empty.
  if (!v.isAvailable || v.current == null || v.baseline == null) {
    return (
      <Card span={4} padding="18px 20px">
        <CardHeader>
          <CardLabel>VO₂MAX · 6-MO TREND</CardLabel>
          <CardPin variant="amber">AWAITING HEALTHKIT</CardPin>
        </CardHeader>
        <EmptyState
          title="NO DATA YET"
          body="Once HealthKit is connected, your monthly VO₂Max samples and 6-month trend will populate here."
        />
        <CardFoot left="Your aerobic engine size. Trends slowly across months — short-term wiggles aren't signal." />
      </Card>
    );
  }
  const trend = v.current - v.baseline;
  const series = v.series6mo;
  const labels = v.series6moLabels;

  return (
    <Card span={4} padding="18px 20px">
      <CardHeader>
        <CardLabel>VO₂MAX · 6-MO TREND</CardLabel>
        <CardPin variant={trend >= 0 ? 'green' : 'warn'}>
          {trend >= 0 ? '↑ +' : '↓ '}{Math.abs(trend).toFixed(1)}
        </CardPin>
      </CardHeader>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 8 }}>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 700,
            fontSize: 36,
            lineHeight: 1,
            letterSpacing: '-.02em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {v.current}
          <small style={{ fontSize: '.35em', opacity: 0.55, fontWeight: 700, marginLeft: 4 }}>ml/kg</small>
        </div>
        <div className="t-eyebrow" style={{ color: 'var(--t3)' }}>
          TREND WINS · NOT ABS
        </div>
      </div>

      {/* 6 monthly bars · one per month. Above-baseline months tinted green
          (improvement), below-baseline muted gray. Latest month outlined. */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 90,
          marginTop: 14,
        }}
      >
        <div
          className="t-eyebrow"
          style={{ fontSize: 9, color: 'var(--t3)', letterSpacing: '.12em', marginBottom: 4 }}
        >
          MONTHLY · LAST 6 MONTHS
        </div>
        <BarSeries
          series={series}
          baseline={v.baseline}
          aboveColor="#3EBD41"
          belowColor="rgba(244,246,248,.22)"
          xLabels={labels}
          xLabelIndices={labels.map((_, i) => i)}
        />
      </div>

      <CardFoot
        left="Your aerobic engine size. Trends slowly across months — short-term wiggles aren't signal."
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 4C · BodyMassCard (span 3) — NEW. 28-day trend with 14d delta.
// Audit: /Research/00b §Quantitative Signals — >2% drop in 14d = stress.
// ─────────────────────────────────────────────────────────────────────

function BodyMassCard({ data }: { data: HealthData }) {
  const bm = data.bodyMass;
  // HealthKit-blocked. Render NO DATA YET when weight samples are empty.
  if (!bm.isAvailable || bm.current == null || bm.baseline28d == null || bm.delta14dPct == null) {
    return (
      <Card span={3} padding="18px 20px">
        <CardHeader>
          <CardLabel>BODY MASS · 28D</CardLabel>
          <CardPin variant="amber">AWAITING HEALTHKIT</CardPin>
        </CardHeader>
        <EmptyState
          title="NO DATA YET"
          body="Once HealthKit is connected, daily weight and the 14-day delta will populate here."
        />
        <CardFoot left="Sudden weight drops mean hydration loss or under-fueling. Sustained >2% drop over 2 weeks is a flag." />
      </Card>
    );
  }
  const pinVariant = bm.warningTriggered ? 'warn' : 'green';
  const pinLabel = bm.warningTriggered ? '▼ DROP' : '● STABLE';

  return (
    <Card span={3} padding="18px 20px">
      <CardHeader>
        <CardLabel>BODY MASS · 28D</CardLabel>
        <CardPin variant={pinVariant}>{pinLabel}</CardPin>
      </CardHeader>

      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: 36,
          lineHeight: 1,
          letterSpacing: '-.02em',
          marginTop: 8,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {bm.current}
        <small style={{ fontSize: '.32em', opacity: 0.55, fontWeight: 700, marginLeft: 4 }}>{bm.unit}</small>
      </div>
      <div className="mono-sm" style={{ marginTop: 4, color: 'var(--t3)' }}>
        BASE {bm.baseline28d}{bm.unit}
      </div>

      {/* 28 daily bars, baseline reference, fills card height */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 90,
          marginTop: 12,
        }}
      >
        <div
          className="t-eyebrow"
          style={{
            fontSize: 9,
            color: 'var(--t3)',
            letterSpacing: '.12em',
            marginBottom: 4,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>DAILY · LAST 28 DAYS</span>
          <span
            style={{
              fontFamily: 'var(--f-data)',
              fontWeight: 700,
              color: bm.warningTriggered ? 'var(--warn)' : 'var(--good)',
            }}
          >
            14D {bm.delta14dPct >= 0 ? '+' : ''}{bm.delta14dPct}%
          </span>
        </div>
        <BarSeries
          series={bm.series28d}
          baseline={bm.baseline28d}
          aboveColor={bm.warningTriggered ? 'var(--warn)' : 'rgba(244,246,248,.22)'}
          belowColor={bm.warningTriggered ? 'var(--warn)' : '#008FEC'}
        />
      </div>

      <CardFoot
        left="Sudden weight drops mean hydration loss or under-fueling. Sustained >2% drop over 2 weeks is a flag."
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 5A · SubmaxHrDriftCard (span 6) — earliest overtraining marker.
// Audit: /Research/15 §Spotting Overtraining Early §4.
// ─────────────────────────────────────────────────────────────────────

function SubmaxHrDriftCard({ data }: { data: HealthData }) {
  const sd = data.submaxHrDrift;
  // Strava HR-stream-blocked. Render NO DATA YET when the 8-week
  // series isn't computed yet.
  if (!sd.isAvailable || sd.current == null || sd.baseline == null || sd.driftBpm == null || sd.series8w.length === 0) {
    return (
      <Card span={data.profile.sex === 'female' ? 6 : 12} padding="18px 20px">
        <CardHeader>
          <div>
            <CardLabel>SUBMAX HR DRIFT · EASY PACE</CardLabel>
            <div className="mono-sm" style={{ marginTop: 4, color: 'var(--t3)' }}>
              Avg HR at 8:30–9:00 /mi · 8-week window
            </div>
          </div>
          <CardPin variant="amber">AWAITING STRAVA HR</CardPin>
        </CardHeader>
        <EmptyState
          title="NO DATA YET"
          body="Once Strava HR streams are wired, your easy-pace HR drift over the last 8 weeks will populate here — the earliest reliable overtraining marker."
        />
        <CardFoot left="Heart rate at the same easy pace, week over week. Creeping up = body is taking on more stress than it's clearing." />
      </Card>
    );
  }
  const pinVariant =
    sd.verdict === 'stable' ? 'green'
    : sd.verdict === 'creeping' ? 'amber'
    : 'warn';
  const tone =
    sd.verdict === 'stable' ? 'var(--good)'
    : sd.verdict === 'creeping' ? 'var(--att)'
    : 'var(--warn)';

  // Build mini line chart of series8w.
  const W = 280, H = 70;
  const padL = 24, padR = 12, padT = 6, padB = 12;
  const series = sd.series8w;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const min = Math.min(...series) - 1;
  const max = Math.max(...series) + 1;
  const range = Math.max(0.1, max - min);
  const pts = series.map((v, i) => {
    const x = padL + (i / Math.max(1, series.length - 1)) * innerW;
    const y = padT + (1 - (v - min) / range) * innerH;
    return { x, y };
  });
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const baselineY = padT + (1 - (sd.baseline - min) / range) * innerH;

  // Week labels: "−7w" / "−6w" / ... / "NOW" (most recent on right).
  // The minus + lowercase w reads unambiguously as "weeks ago" — the older
  // "W-7" form looked like "Week 7" (positive index), which was confusing.
  const weekLabels = series.map((_, i) => {
    const weeksAgo = series.length - 1 - i;
    return weeksAgo === 0 ? 'NOW' : `−${weeksAgo}w`;
  });
  // Hoist baseline into a non-null local so callbacks below don't lose narrowing.
  const baselineBpm = sd.baseline;
  const weeksAboveBaseline = series.filter((v) => v > baselineBpm).length;
  const verdictExplain =
    sd.verdict === 'stable'
      ? "Easy-pace HR is sitting at baseline — your aerobic system is keeping up with the training load."
      : sd.verdict === 'creeping'
      ? "Easy-pace HR has crept up over the last few weeks. Body is taking on more stress than it's clearing — pull back volume for a week to let it settle."
      : "Easy-pace HR has climbed significantly. Treat this as a forced cutback signal — reduce intensity until HR returns to baseline.";

  return (
    <Card span={data.profile.sex === 'female' ? 6 : 12} padding="18px 20px">
      <CardHeader>
        <div>
          <CardLabel>SUBMAX HR DRIFT · EASY PACE</CardLabel>
          <div className="mono-sm" style={{ marginTop: 4, color: 'var(--t3)' }}>
            Avg HR at 8:30–9:00 /mi · 8-week window
          </div>
        </div>
        <CardPin variant={pinVariant}>{sd.verdictLabel}</CardPin>
      </CardHeader>

      {/* Two-column layout: 4 KPI tiles on left, big chart on right */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 22, marginTop: 12 }}>
        {/* KPI tiles · current / baseline / drift / weeks elevated */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start' }}>
          <KpiTile label="CURRENT" value={String(sd.current)} unit="bpm" color={tone} />
          <KpiTile label="BASELINE" value={String(sd.baseline)} unit="bpm" color="var(--t1)" />
          <KpiTile
            label="DRIFT · 8W"
            value={`${sd.driftBpm >= 0 ? '+' : ''}${sd.driftBpm}`}
            unit="bpm"
            color={tone}
          />
          <KpiTile
            label="ABOVE BASE"
            value={String(weeksAboveBaseline)}
            unit={`/${series.length}w`}
            color={weeksAboveBaseline >= 4 ? 'var(--att)' : 'var(--t1)'}
          />
        </div>
        {/* Bar chart · one bar per week. Bar height encodes weekly HR over a
            5-bpm window around baseline (baseline-5 → max+1) so subtle drifts
            read as proportionally taller. Above-baseline bars get the warning
            tone; at-or-below bars are muted. Baseline appears as a dashed
            horizontal reference. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {(() => {
            const barMin = Math.min(sd.baseline - 3, Math.min(...series) - 1);
            const barMax = Math.max(...series) + 1;
            const barRange = Math.max(1, barMax - barMin);
            const baselinePct = ((sd.baseline - barMin) / barRange) * 100;
            return (
              <>
                <div
                  style={{
                    position: 'relative',
                    height: 130,
                    display: 'grid',
                    gridTemplateColumns: `repeat(${series.length}, 1fr)`,
                    gap: 8,
                    alignItems: 'end',
                    padding: '6px 4px 0',
                  }}
                >
                  {/* Baseline reference line */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 4,
                      right: 4,
                      bottom: `calc(${baselinePct}% + 0px)`,
                      height: 0,
                      borderTop: `1px dashed ${tone}`,
                      opacity: 0.45,
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: 6,
                      bottom: `calc(${baselinePct}% + 4px)`,
                      fontFamily: 'var(--f-data)',
                      fontSize: 9,
                      fontWeight: 700,
                      color: tone,
                      opacity: 0.6,
                      letterSpacing: '.4px',
                      pointerEvents: 'none',
                    }}
                  >
                    BASE {sd.baseline}
                  </div>
                  {series.map((v, i) => {
                    const hPct = ((v - barMin) / barRange) * 100;
                    const aboveBase = v > baselineBpm;
                    const isLatest = i === series.length - 1;
                    const barColor = aboveBase
                      ? tone
                      : 'rgba(244,246,248,.18)';
                    const barOpacity = isLatest ? 1 : aboveBase ? 0.7 : 0.6;
                    return (
                      <div
                        key={i}
                        style={{
                          height: `${hPct}%`,
                          background: barColor,
                          opacity: barOpacity,
                          borderRadius: '3px 3px 0 0',
                          minHeight: 6,
                          outline: isLatest ? `2px solid ${tone}` : undefined,
                          outlineOffset: isLatest ? -1 : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              </>
            );
          })()}
          {/* Week labels under the bars */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${series.length}, 1fr)`,
              gap: 8,
              marginTop: 6,
              fontFamily: 'var(--f-data)',
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--t3)',
              letterSpacing: '.4px',
              textAlign: 'center',
              padding: '0 4px',
            }}
          >
            {weekLabels.map((label, i) => (
              <span key={i} style={{ color: i === series.length - 1 ? tone : undefined }}>{label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Verdict explanation panel */}
      <div
        style={{
          padding: '10px 14px',
          background: `${tone === 'var(--good)' ? 'rgba(62,189,65,.06)' : tone === 'var(--att)' ? 'rgba(243,173,56,.06)' : 'rgba(252,77,100,.06)'}`,
          border: `1px solid ${tone === 'var(--good)' ? 'rgba(62,189,65,.22)' : tone === 'var(--att)' ? 'rgba(243,173,56,.22)' : 'rgba(252,77,100,.22)'}`,
          borderRadius: 6,
          marginTop: 14,
          fontSize: 13,
          color: 'var(--t1)',
          lineHeight: 1.5,
        }}
      >
        <span style={{ color: tone, fontWeight: 700, marginRight: 8 }}>{sd.verdictLabel}</span>
        {verdictExplain}
      </div>

      <CardFoot
        left="Heart rate at the same easy pace, week over week. Creeping up = body is taking on more stress than it's clearing."
      />
    </Card>
  );
}

/** Small KPI tile used inside compound cards (SubmaxHrDrift). */
function KpiTile({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--l2)', border: '1px solid var(--l4)', borderRadius: 6 }}>
      <div className="t-eyebrow" style={{ fontSize: 9, color: 'var(--t3)' }}>{label}</div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: 24,
          lineHeight: 1,
          letterSpacing: '-.015em',
          color,
          marginTop: 4,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
        <small style={{ fontSize: '.4em', opacity: 0.55, fontWeight: 700, marginLeft: 4 }}>{unit}</small>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 5B (female users only) · CycleCard (span 3)
// ─────────────────────────────────────────────────────────────────────

function CycleCard({ cycle }: { cycle: NonNullable<HealthData['cycle']> }) {
  // Cycle-log table not yet built. Render NO DATA YET until cycle data lands.
  if (!cycle.isAvailable || cycle.phase == null || cycle.daysIntoPhase == null) {
    return (
      <Card span={3} padding="18px 20px">
        <CardHeader>
          <CardLabel>CYCLE · PHASE</CardLabel>
          <CardPin variant="amber">AWAITING CHECK-IN</CardPin>
        </CardHeader>
        <EmptyState
          title="NO DATA YET"
          body="Once you start logging cycle phases, the active phase, days in, and load adjustment will populate here."
        />
        <CardFoot left={cycle.citation} />
      </Card>
    );
  }
  return (
    <Card span={3} padding="18px 20px">
      <CardHeader>
        <CardLabel>CYCLE · PHASE</CardLabel>
        <CardPin variant="coach">{cycle.phaseLabel}</CardPin>
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: 28,
          lineHeight: 1,
          letterSpacing: '-.02em',
          marginTop: 10,
          color: 'var(--coach)',
          textTransform: 'uppercase',
        }}
      >
        Day {cycle.daysIntoPhase}
      </div>
      <div className="mono-sm" style={{ marginTop: 6, color: 'var(--t2)' }}>
        INTO {cycle.phaseLabel}
      </div>

      <div
        style={{
          marginTop: 10,
          padding: '8px 10px',
          background: 'var(--l2)',
          borderRadius: 6,
        }}
      >
        <div className="t-eyebrow">LOAD ADJUSTMENT</div>
        <div className="t-body" style={{ fontSize: 11.5, color: 'var(--t1)', marginTop: 4 }}>
          {cycle.loadAdjustmentRec}
        </div>
      </div>

      <CardFoot
        left="Hormonal phase shifts your training tolerance. Adjust intensity, not effort."
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 5C (female users only) · FerritinCard (span 3)
// ─────────────────────────────────────────────────────────────────────

function FerritinCard({ ferritin }: { ferritin: NonNullable<HealthData['ferritin']> }) {
  // Lab-result table not yet built. Render NO DATA YET until lab data lands.
  if (!ferritin.isAvailable || ferritin.currentNgPerMl == null) {
    return (
      <Card span={3} padding="18px 20px">
        <CardHeader>
          <CardLabel>FERRITIN · IRON</CardLabel>
          <CardPin variant="amber">AWAITING LABS</CardPin>
        </CardHeader>
        <EmptyState
          title="NO DATA YET"
          body="Once lab results are logged, ferritin (ng/mL), trend, and the <30 threshold flag will populate here."
        />
        <CardFoot left={ferritin.citation} />
      </Card>
    );
  }
  const pinVariant = ferritin.belowThreshold ? 'warn' : 'green';
  const pinLabel = ferritin.belowThreshold ? '▼ LOW' : '● OK';
  const valueColor = ferritin.belowThreshold ? 'var(--warn)' : 'var(--good)';

  return (
    <Card span={3} padding="18px 20px">
      <CardHeader>
        <CardLabel>FERRITIN · IRON</CardLabel>
        <CardPin variant={pinVariant}>{pinLabel}</CardPin>
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: 36,
          lineHeight: 1,
          letterSpacing: '-.02em',
          marginTop: 10,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {ferritin.currentNgPerMl != null ? ferritin.currentNgPerMl : '—'}
        <small style={{ fontSize: '.3em', opacity: 0.55, fontWeight: 700, marginLeft: 4 }}>ng/mL</small>
      </div>
      <div className="mono-sm" style={{ marginTop: 4, color: 'var(--t3)' }}>
        THRESHOLD &lt; 30 · TREND {ferritin.trend.toUpperCase()}
      </div>

      <div
        style={{
          marginTop: 10,
          padding: '8px 10px',
          background: ferritin.belowThreshold ? 'rgba(252,77,100,.08)' : 'var(--l2)',
          borderRadius: 6,
          fontSize: 11.5,
          color: 'var(--t1)',
        }}
      >
        {ferritin.belowThreshold
          ? 'Below threshold — flag for clinician follow-up.'
          : 'Above 30 ng/mL threshold — within recommended range.'}
      </div>

      <CardFoot
        left="Iron stores. Low ferritin tanks aerobic capacity even with normal hemoglobin."
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// VitalTile — small data card used by Sleep, RHR.
// ─────────────────────────────────────────────────────────────────────

function VitalTile({
  span,
  label,
  pinText,
  pinVariant,
  value,
  unit,
  sub,
  series,
  seriesColor,
  baseline,
  goodHigh = true,
  chartPeriod,
  blurb,
}: {
  span: 3 | 4 | 5 | 6;
  label: string;
  pinText: string;
  pinVariant: 'green' | 'amber' | 'warn' | 'blue' | 'muted' | 'coach';
  value: string;
  unit: string;
  sub: string;
  series: number[];
  /** Primary color · used for bars on the "good" side of baseline. */
  seriesColor: string;
  /** Optional reference line on the chart — e.g. baseline RHR, goal sleep hours. */
  baseline?: number;
  /** If true (default), higher values are healthier (HRV, Sleep). False for metrics
   *  where lower is healthier (RHR). Affects which side of baseline gets the good color. */
  goodHigh?: boolean;
  /** Time window label for the chart · e.g. "LAST 7 NIGHTS", "LAST 30 DAYS". */
  chartPeriod: string;
  /** Plain-English blurb shown in the card footer, explaining what this metric means. */
  blurb: string;
}) {
  // For low-is-good metrics (RHR), flip the color semantics so above-base = warn,
  // below-base = the seriesColor. For high-is-good metrics, above-base = seriesColor,
  // below-base = muted gray.
  const aboveColor = goodHigh ? seriesColor : 'var(--warn)';
  const belowColor = goodHigh ? 'rgba(244,246,248,.22)' : seriesColor;

  return (
    <Card span={span} padding="18px 20px">
      <CardHeader>
        <CardLabel>{label}</CardLabel>
        <CardPin variant={pinVariant}>{pinText}</CardPin>
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: 44,
          lineHeight: 0.95,
          letterSpacing: '-.015em',
          fontVariantNumeric: 'tabular-nums',
          marginTop: 8,
        }}
      >
        {value}
        <small style={{ fontSize: '.3em', opacity: 0.55, fontWeight: 700, marginLeft: 4 }}>{unit}</small>
      </div>
      <div className="mono-sm" style={{ marginTop: 4, color: 'var(--t3)' }}>{sub}</div>
      {/* Bar chart grows to fill remaining card height */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 60, marginTop: 10 }}>
        <div
          className="t-eyebrow"
          style={{ fontSize: 9, color: 'var(--t3)', letterSpacing: '.12em', marginBottom: 4 }}
        >
          {chartPeriod}
        </div>
        <BarSeries
          series={series}
          baseline={baseline}
          aboveColor={aboveColor}
          belowColor={belowColor}
        />
      </div>
      <CardFoot left={blurb} />
    </Card>
  );
}

/**
 * Bar chart used for daily/weekly time-series. Above-baseline bars get
 * `aboveColor`; at-or-below bars get `belowColor`. Fills its parent's
 * available height via flex:1. Bottom row of axis labels is HTML (controlled
 * font size, no SVG stretching).
 */
function BarSeries({
  series,
  baseline,
  aboveColor,
  belowColor,
  xLabels,
  xLabelIndices,
}: {
  series: number[];
  baseline?: number;
  aboveColor: string;
  belowColor: string;
  /** Labels to render along the bottom axis (HTML, not SVG). */
  xLabels?: string[];
  /** Corresponding bar indices that each xLabel anchors to. */
  xLabelIndices?: number[];
}) {
  if (series.length === 0) return <div style={{ flex: 1, minHeight: 60 }} />;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(1, max - min);
  // Use a tight window so subtle changes are visually pronounced.
  // Floor at min-2, ceiling at max+1, plus include baseline if outside range.
  const yMin = baseline !== undefined ? Math.min(min, baseline) - (range * 0.15) : min - (range * 0.1);
  const yMax = Math.max(max, baseline ?? max) + (range * 0.1);
  const yRange = Math.max(1, yMax - yMin);
  const baselinePct = baseline !== undefined ? ((baseline - yMin) / yRange) * 100 : null;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 60 }}>
      <div
        style={{
          flex: 1,
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: `repeat(${series.length}, 1fr)`,
          gap: Math.max(1, Math.floor(40 / series.length)),
          alignItems: 'end',
          minHeight: 60,
        }}
      >
        {baselinePct !== null && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: `${baselinePct}%`,
              height: 0,
              borderTop: `1px dashed ${aboveColor}`,
              opacity: 0.35,
              pointerEvents: 'none',
            }}
          />
        )}
        {series.map((v, i) => {
          const hPct = ((v - yMin) / yRange) * 100;
          const above = baseline !== undefined ? v > baseline : true;
          const isLatest = i === series.length - 1;
          return (
            <div
              key={i}
              style={{
                height: `${hPct}%`,
                background: above ? aboveColor : belowColor,
                opacity: isLatest ? 1 : above ? 0.78 : 0.55,
                minHeight: 4,
                borderRadius: '2px 2px 0 0',
                // Outline the latest bar in its OWN color (not always aboveColor) —
                // for inverted-good metrics (RHR, Effort), the latest bar may be
                // below baseline (good) and should be highlighted in the good color.
                outline: isLatest ? `1.5px solid ${above ? aboveColor : belowColor}` : undefined,
                outlineOffset: isLatest ? -1 : undefined,
              }}
            />
          );
        })}
      </div>
      {xLabels && xLabelIndices && (
        <div
          style={{
            position: 'relative',
            height: 14,
            marginTop: 6,
            fontFamily: 'var(--f-data)',
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--t3)',
            letterSpacing: '.4px',
          }}
        >
          {xLabels.map((lbl, i) => {
            const idx = xLabelIndices[i];
            const pct = (idx / Math.max(1, series.length - 1)) * 100;
            const isLast = i === xLabels.length - 1;
            return (
              <span
                key={i}
                style={{
                  position: 'absolute',
                  left: `${pct}%`,
                  transform: isLast ? 'translateX(-100%)' : i === 0 ? 'translateX(0)' : 'translateX(-50%)',
                  color: isLast ? aboveColor : undefined,
                }}
              >
                {lbl}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Compact inline area sparkline at configurable height. */
function SparkAreaInline({
  series,
  color,
  gradId,
  height = 36,
  fill = false,
}: {
  series: number[];
  color: string;
  gradId: string;
  height?: number;
  /** If true, the SVG fills its parent's available height (parent must be a flex
   *  column with a defined height or flex:1). Used by VitalTile to fill row height. */
  fill?: boolean;
}) {
  if (series.length === 0) {
    return <div style={{ height: fill ? '100%' : height, marginTop: 6, flex: fill ? 1 : undefined }} />;
  }
  const W = 200, H = height;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(1, max - min);
  const pts = series.map((v, i) => {
    const x = (i / Math.max(1, series.length - 1)) * W;
    const y = H - 4 - ((v - min) / range) * (H - 10);
    return { x, y };
  });
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`;
  const last = pts[pts.length - 1];
  const svgStyle: React.CSSProperties = fill
    ? { width: '100%', height: '100%', minHeight: 60, display: 'block', flex: 1 }
    : { width: '100%', height, display: 'block', marginTop: 6 };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={svgStyle}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".55" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={last.x} cy={last.y} r="2.5" fill={color} stroke="#10131A" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────

function HealthSkeleton() {
  return (
    <>
      <Row>
        <Card span={7} style={{ minHeight: 320 }}>
          <Skeleton height={280} />
        </Card>
        <Card span={5} style={{ minHeight: 320 }}>
          <Skeleton height={280} />
        </Card>
      </Row>
      <Row>
        <Card span={5}><Skeleton height={300} /></Card>
        <Card span={7}><Skeleton height={300} /></Card>
      </Row>
      <Row>
        <Card span={4}><Skeleton height={200} /></Card>
        <Card span={4}><Skeleton height={200} /></Card>
        <Card span={4}><Skeleton height={200} /></Card>
      </Row>
      <Row>
        <Card span={5}><Skeleton height={220} /></Card>
        <Card span={4}><Skeleton height={220} /></Card>
        <Card span={3}><Skeleton height={220} /></Card>
      </Row>
      <Row>
        <Card span={12}><Skeleton height={180} /></Card>
      </Row>
    </>
  );
}
