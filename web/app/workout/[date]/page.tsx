'use client';

/**
 * /workout/[date] — single-session workout detail.
 *
 * Reads the prescription for the requested date from the unified
 * RunnerHub. Two source branches:
 *   1. Date inside the current week → coach.weekShape entry
 *      (has description + pace target + hrZone + isQuality)
 *   2. Date in the next 30 days     → coach.next30Days entry
 *      (lighter — type/label/distance/quality/long flags only)
 *   3. Otherwise                    → out-of-scope state
 *
 * Today's date gets the richest content (coach.today.today + the
 * full readiness/brief context) — uses the same payload but with
 * the full prescription depth.
 *
 * Layout follows the canonical workout-detail design from the deck:
 * hero with KPIs → why → structure breakdown → past attempts.
 * Pulled forward from the placeholder version, but every value is
 * now data-driven.
 */

import Link from 'next/link';
import { use } from 'react';
import { Caption, Nav } from '../../../components/nav';
import { HubProvider, useHub } from '../../../lib/hub-provider';
import { RpeInput } from '../../../components/RpeInput';

interface PageParams { date: string }

export default function WorkoutDetailPage({ params }: { params: Promise<PageParams> }) {
  const { date } = use(params);
  return (
    <HubProvider>
      <WorkoutDetailInner date={date} />
    </HubProvider>
  );
}

interface DayPrescription {
  date: string;
  type: string;
  label: string;
  distanceMi: number;
  description: string | null;
  paceTargetSPerMi: { lowS: number; highS: number } | null;
  hrZone: number | null;
  isQuality: boolean;
  isLong: boolean;
  isToday: boolean;
  raceName?: string | null;
  racePriority?: 'A' | 'B' | 'C' | null;
}

function WorkoutDetailInner({ date }: { date: string }) {
  const hub = useHub();

  if (!hub) {
    return <Shell date={date}><div style={{ minHeight: 480 }} aria-busy="true" /></Shell>;
  }

  // Find a prescription for the target date. weekShape (current
  // week) has the richest data; next30Days is lighter; today gets
  // a special path so we surface the full prescription + brief.
  const todayISO = hub.meta.cacheDate;
  const isToday = date === todayISO;

  const fromWeekShape = hub.coach.today?.weekShape?.find(d => d.date === date) ?? null;
  const fromNext30 = hub.coach.today?.next30Days?.find(d => d.date === date) ?? null;

  let prescription: DayPrescription | null = null;
  if (isToday && hub.coach.today?.today) {
    const t = hub.coach.today.today;
    const wk = hub.coach.today.weekShape?.find(d => d.isToday);
    prescription = {
      date,
      type: t.type,
      label: t.label,
      distanceMi: t.distanceMi,
      description: t.description,
      paceTargetSPerMi: t.paceTargetSPerMi,
      hrZone: t.hrZone,
      isQuality: wk?.isQuality ?? false,
      isLong: wk?.isLong ?? false,
      isToday: true,
    };
  } else if (fromWeekShape) {
    prescription = {
      date: fromWeekShape.date,
      type: fromWeekShape.type,
      label: fromWeekShape.label,
      distanceMi: fromWeekShape.distanceMi,
      description: fromWeekShape.description ?? null,
      paceTargetSPerMi: fromWeekShape.paceTargetSPerMi ?? null,
      hrZone: fromWeekShape.hrZone ?? null,
      isQuality: fromWeekShape.isQuality,
      isLong: fromWeekShape.isLong,
      isToday: fromWeekShape.isToday,
    };
  } else if (fromNext30) {
    prescription = {
      date: fromNext30.date,
      type: fromNext30.type,
      label: fromNext30.label,
      distanceMi: fromNext30.distanceMi,
      description: fromNext30.description ?? null,
      paceTargetSPerMi: fromNext30.paceTargetSPerMi ?? null,
      hrZone: fromNext30.hrZone ?? null,
      isQuality: fromNext30.isQuality,
      isLong: fromNext30.isLong,
      isToday: fromNext30.isToday,
      raceName: fromNext30.raceName,
      racePriority: fromNext30.racePriority,
    };
  }

  if (!prescription) {
    return (
      <Shell date={date}>
        <OutOfScopeCard date={date} />
      </Shell>
    );
  }

  // Race-day on the calendar gets a different layout — race details
  // already live on /races/[slug], so we link there instead of
  // pretending we have a prescription.
  if (prescription.raceName) {
    return (
      <Shell date={date}>
        <RaceDayCard date={date} raceName={prescription.raceName} priority={prescription.racePriority ?? 'A'} />
      </Shell>
    );
  }

  // Phase + week-position context. For TODAY, use coach.today.phase /
  // modeDetail directly. For ANY OTHER DAY, look up the engine's
  // per-day projection in next30Days — it now carries phase +
  // modeDetail per day. Without this the header echoed today's
  // "Recovery week — 5 days since Sombrero Half Marathon" even when
  // viewing a workout 20 days from now (in a different phase).
  const phase = prescription.isToday
    ? (hub.coach.today?.phase ?? null)
    : (fromNext30?.phase ?? hub.coach.today?.phase ?? null);
  const modeDetail = prescription.isToday
    ? (hub.coach.today?.modeDetail ?? '')
    : (fromNext30?.modeDetail ?? '');

  // Past RPE for THIS workout date, if logged. The RpeInput defaults
  // to "today" but the page is calendar-driven — let the runner log
  // RPE for any historical day.
  const existingRpe = hub.recentRpe.find(e => e.workoutDate === date) ?? null;

  // Rest-day override detection — did the runner actually run on a
  // prescribed rest day? When yes, surface what they did so the page
  // doesn't pretend "0 mi · No running today" when Strava shows otherwise.
  const todayActual = prescription.isToday ? hub.coach.state?.recovery?.today : null;
  const isRestOverride = prescription.type === 'rest' && todayActual != null;

  return (
    <Shell date={date}>
      <Breadcrumb date={date} prescription={prescription} modeDetail={modeDetail} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <HeroTile prescription={prescription} phase={phase} todayActual={todayActual} />
          {isRestOverride && todayActual && <RestOverrideTile actual={todayActual} />}
          {prescription.description && !isRestOverride && <DescriptionTile description={prescription.description} />}
          {!isRestOverride && <StructureTile prescription={prescription} />}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {prescription.isToday && hub.coach.coach?.readiness && (
            <ReadinessSummaryTile readiness={hub.coach.coach.readiness} />
          )}
          {(prescription.isToday || isPastDate(date, todayISO)) && (
            <RpeTile date={date} existing={existingRpe} prescription={prescription} />
          )}
          <ContextTile prescription={prescription} todayISO={todayISO} />
        </div>
      </div>
    </Shell>
  );
}

function Shell({ date, children }: { date: string; children: React.ReactNode }) {
  return (
    <>
      <Caption left="Runcino · workout" right={`WORKOUT · ${date}`} />
      <div className="stage">
        <Nav active="training" />
        <div className="body">{children}</div>
      </div>
    </>
  );
}

function Breadcrumb({ date, prescription, modeDetail }: { date: string; prescription: DayPrescription; modeDetail: string }) {
  const dayLabel = (() => {
    const d = new Date(date + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  })();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px',
      color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase',
      marginBottom: 14,
    }}>
      <Link href="/training" style={{ color: 'inherit' }}>Training</Link>
      <span>/</span>
      <span>{dayLabel}</span>
      {prescription.isToday && <><span>/</span><span style={{ color: 'var(--color-attention)' }}>Today</span></>}
      {modeDetail && <><span>/</span><span style={{ color: 'var(--color-t1)' }}>{modeDetail}</span></>}
    </div>
  );
}

const TYPE_DESCRIPTIONS: Record<string, string> = {
  rest:                 'Full rest. No running today — recovery is part of training.',
  recovery:             'Very easy circulation run · conversational, sub-zone-2.',
  general_aerobic:      'Steady aerobic run · zone 2, conversational pace, build the base.',
  easy:                 'Easy aerobic run · conversational, never hurried.',
  medium_long:          'Medium-long aerobic run · stays easy but builds duration.',
  long_steady:          'Long steady run · conversational throughout, time on feet.',
  long_progression:     'Long run with a closing progression — finish faster than you start.',
  long_mp_block:        'Long run with marathon-pace block(s) — race-specific specificity.',
  long_fast_finish:     'Long run with a strong final 2-3 miles at marathon pace.',
  threshold_intervals:  'Threshold work · ride the line, don\'t cross it.',
  tempo_continuous:     'Continuous tempo · controlled hard, comfortable-uncomfortable.',
  sub_threshold:        'Sub-threshold reps · just below T pace, big aerobic stimulus, low cost.',
  vo2:                  'VO2-max intervals · fast and short, pushes ceiling.',
  marathon_specific:    'Marathon-specific session · MP-paced sustained effort.',
  marathon_specific_combo: 'Marathon-specific combo · mixed paces around MP.',
  marathon_specific_long: 'Marathon-specific long · fitness peak workout.',
  strides:              'Easy run with strides · keep neuromuscular freshness.',
  hill_sprints:         'Short hill sprints · max effort, full recovery.',
  shakeout:             'Shakeout · easy 2-3 mi, just turn the legs over.',
  race:                 'Race day. Trust the prep.',
};

interface ActualRun {
  distMi: number;
  paceSPerMi: number;
  avgHr: number | null;
  name: string;
  activityId: number;
}

function HeroTile({ prescription, phase, todayActual }: { prescription: DayPrescription; phase: string | null; todayActual?: ActualRun | null }) {
  const isRestOverride = prescription.type === 'rest' && todayActual != null;
  const typeColor: Record<string, string> = {
    rest:                 'var(--color-t3)',
    recovery:             'var(--color-success)',
    general_aerobic:      'var(--color-success)',
    easy:                 'var(--color-success)',
    medium_long:          'var(--color-corporate)',
    long_steady:          'var(--color-corporate)',
    long_progression:     'var(--color-corporate)',
    long_mp_block:        'var(--color-attention)',
    long_fast_finish:     'var(--color-attention)',
    threshold_intervals:  'var(--color-attention)',
    tempo_continuous:     'var(--color-attention)',
    sub_threshold:        'var(--color-attention)',
    vo2:                  'var(--color-warning)',
    marathon_specific:    'var(--color-attention)',
    strides:              'var(--color-success)',
    hill_sprints:         'var(--color-warning)',
    shakeout:             'var(--color-success)',
    race:                 'var(--color-warning)',
  };
  const bg = prescription.isQuality
    ? 'linear-gradient(135deg, var(--color-l2) 0%, var(--active-wash) 100%)'
    : prescription.type === 'rest'
    ? 'var(--color-l2)'
    : 'linear-gradient(135deg, var(--color-l2) 0%, var(--recovery-wash, var(--color-l1)) 100%)';
  const accent = typeColor[prescription.type] ?? 'var(--color-corporate)';
  const dur = estimateDurationMin(prescription);
  const paceLabel = prescription.paceTargetSPerMi
    ? `${formatPace(prescription.paceTargetSPerMi.lowS)}–${formatPace(prescription.paceTargetSPerMi.highS)}`
    : null;
  // Override case: rest day prescribed but the runner ran. Hero
  // shows the actual run's stats so the page doesn't pretend "0 mi"
  // when Strava shows the real distance.
  if (isRestOverride && todayActual) {
    const overrideAccent = 'var(--color-attention)';
    return (
      <div className="tile" style={{
        padding: '24px 26px',
        background: 'linear-gradient(135deg, var(--color-l2) 0%, rgba(243,173,59,0.08) 100%)',
        borderColor: 'rgba(243,173,59,0.3)',
        borderLeft: `4px solid ${overrideAccent}`,
      }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={chipStyle(overrideAccent)}>RAN ON REST DAY</span>
          {phase && <span style={chipStyle('var(--color-t2)')}>{phase}</span>}
          <span style={chipStyle('var(--color-warning)')}>TODAY</span>
        </div>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 48,
          lineHeight: 0.95, letterSpacing: '-.005em', textTransform: 'uppercase',
          marginTop: 14, color: 'var(--color-t0)',
        }}>
          {todayActual.name}
        </div>
        <div style={{ fontSize: 14, color: 'var(--color-t2)', marginTop: 6, maxWidth: 520, lineHeight: 1.5 }}>
          Plan was rest. You ran anyway — done is done. Tomorrow stays off whatever happens; the recovery the body needed didn&apos;t go away just because you moved.
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14,
          padding: '18px 0 4px', borderTop: '1px solid var(--color-l4)', marginTop: 14,
        }}>
          <Kpi value={todayActual.distMi.toFixed(1)} unit="mi" label="Actual distance" />
          <Kpi value={formatPace(todayActual.paceSPerMi)} unit="/mi" label="Actual pace" accent />
          <Kpi value={todayActual.avgHr != null ? String(todayActual.avgHr) : '—'} unit={todayActual.avgHr != null ? 'bpm' : ''} label="Avg HR" />
          <Kpi value="REST" unit="" label="Was prescribed" />
        </div>
      </div>
    );
  }

  return (
    <div className="tile" style={{ padding: '24px 26px', background: bg, borderColor: `${accent}40` }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span style={chipStyle(accent)}>{prescription.label.toUpperCase()}</span>
        {phase && <span style={chipStyle('var(--color-t2)')}>{phase}</span>}
        {prescription.isLong && <span style={chipStyle('var(--color-corporate)')}>LONG</span>}
        {prescription.isQuality && <span style={chipStyle('var(--color-attention)')}>QUALITY</span>}
        {prescription.isToday && <span style={chipStyle('var(--color-warning)')}>TODAY</span>}
      </div>

      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 56,
        lineHeight: 0.95, letterSpacing: '-.005em', textTransform: 'uppercase',
        marginTop: 14, color: 'var(--color-t0)',
      }}>
        {prescription.label}
      </div>

      <div style={{ fontSize: 14, color: 'var(--color-t2)', marginTop: 6, maxWidth: 520, lineHeight: 1.5 }}>
        {TYPE_DESCRIPTIONS[prescription.type] ?? 'Engine-prescribed session for this date.'}
      </div>

      {/* KPI strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14,
        padding: '18px 0 4px', borderTop: '1px solid var(--color-l4)', marginTop: 14,
      }}>
        <Kpi value={prescription.distanceMi.toFixed(1)} unit="mi" label="Distance" />
        <Kpi value={dur ? String(Math.round(dur)) : '—'} unit="min" label="Est duration" />
        <Kpi value={paceLabel ?? '—'} unit={paceLabel ? '/mi' : ''} label="Pace target" accent={paceLabel != null} />
        <Kpi value={prescription.hrZone ? `Z${prescription.hrZone}` : '—'} unit="" label="HR zone" />
      </div>
    </div>
  );
}

function chipStyle(color: string): React.CSSProperties {
  return {
    fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700,
    letterSpacing: '1.4px', padding: '4px 8px', borderRadius: 4,
    border: `1px solid ${color}`, color,
  };
}

function Kpi({ value, unit, label, accent }: { value: string; unit: string; label: string; accent?: boolean }) {
  const color = accent ? 'var(--color-corporate)' : 'var(--color-t0)';
  const subColor = accent ? 'rgba(79,143,247,.6)' : 'var(--color-t2)';
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32,
        letterSpacing: '-.025em', lineHeight: 1, color,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
        {unit && <small style={{
          fontSize: 13, color: subColor, marginLeft: 4,
          fontFamily: 'var(--font-data)', letterSpacing: '1.3px',
          textTransform: 'uppercase',
        }}>{unit}</small>}
      </div>
      <div style={{
        marginTop: 6, fontFamily: 'var(--font-data)', fontSize: 9,
        letterSpacing: '1.4px', color: accent ? 'var(--color-corporate)' : 'var(--color-t3)',
        fontWeight: 700, textTransform: 'uppercase',
      }}>{label}</div>
    </div>
  );
}

function RestOverrideTile({ actual }: { actual: ActualRun }) {
  return (
    <div className="tile" style={{
      padding: '18px 22px',
      background: 'var(--color-l2)',
      borderLeft: '3px solid var(--color-attention)',
    }}>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-attention)', marginBottom: 6 }}>
        WHAT THE COACH NEEDS YOU TO HEAR
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.6 }}>
        Today was prescribed as rest because the body needed it. You ran <b>{actual.distMi.toFixed(1)} mi at {formatPace(actual.paceSPerMi)}/mi</b>{actual.avgHr != null ? ` (${actual.avgHr} bpm avg)` : ''}. If it felt easy, that&apos;s useful information for the coach. If it felt like work, the next rest day matters more, not less. The recovery window doesn&apos;t reset — tomorrow stays off whatever happens.
      </div>
    </div>
  );
}

function DescriptionTile({ description }: { description: string }) {
  return (
    <div style={{
      background: 'var(--color-l2)', borderRadius: 13, padding: '18px 20px',
      borderLeft: '3px solid var(--color-corporate)',
    }}>
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px',
        color: 'var(--color-corporate)', fontWeight: 700, textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        How to run it
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--color-t1)' }}>
        {description}
      </div>
    </div>
  );
}

function StructureTile({ prescription }: { prescription: DayPrescription }) {
  // Generic warmup/main/cooldown breakdown when we don't have a
  // structured workout. Quality sessions get a richer split.
  if (prescription.type === 'rest') {
    return (
      <div className="tile">
        <div className="tile-h"><div className="tile-lbl">Recovery focus</div></div>
        <div style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.6 }}>
          Mobility, walking, light stretching are fine. The rule: nothing that elevates HR for sustained periods. Sleep, food, fluids — same priority as a running day.
        </div>
      </div>
    );
  }

  const total = prescription.distanceMi;
  const isQuality = prescription.isQuality;
  const isLong = prescription.isLong;
  const blocks = (() => {
    if (!isQuality && !isLong) {
      // Easy / general aerobic — single block.
      return [{
        name: prescription.label,
        detail: 'Conversational throughout · steady aerobic',
        miles: total,
        highlight: false,
      }];
    }
    if (isLong) {
      return [{
        name: 'Steady long run',
        detail: prescription.description ?? 'Conversational base of the run',
        miles: total,
        highlight: true,
      }];
    }
    // Quality — generic warmup / work / cooldown split.
    const wu = Math.max(1.5, total * 0.2);
    const cd = Math.max(1.0, total * 0.15);
    const main = total - wu - cd;
    return [
      { name: 'Warm-up', detail: 'Easy aerobic + drills, optional 4×30s strides', miles: wu, highlight: false },
      { name: prescription.label, detail: prescription.description ?? 'Quality main set', miles: main, highlight: true },
      { name: 'Cool-down', detail: 'Drop HR back to easy, 1 mi minimum', miles: cd, highlight: false },
    ];
  })();

  return (
    <div className="tile">
      <div className="tile-h">
        <div className="tile-lbl">Structure</div>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10.5, letterSpacing: '1.4px', color: 'var(--color-t3)', fontWeight: 700 }}>
          TOTAL · {total.toFixed(1)} MI
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {blocks.map((b, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center',
            padding: '14px 16px',
            background: b.highlight ? 'var(--active-wash, var(--color-l3))' : 'var(--color-l3)',
            borderRadius: 8,
            borderLeft: `3px solid ${b.highlight ? 'var(--color-corporate)' : 'var(--color-l5)'}`,
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--color-t0)' }}>{b.name}</div>
              <div style={{ fontSize: 12, color: 'var(--color-t2)', marginTop: 4, lineHeight: 1.45 }}>{b.detail}</div>
            </div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 800, color: 'var(--color-t0)', fontVariantNumeric: 'tabular-nums' }}>
              {b.miles.toFixed(1)} mi
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadinessSummaryTile({ readiness }: { readiness: { answer: { level: 'green' | 'yellow' | 'red'; message: string } } }) {
  const ans = readiness.answer;
  const color = ans.level === 'green' ? 'var(--color-success)'
              : ans.level === 'yellow' ? 'var(--color-attention)'
              : 'var(--color-warning)';
  return (
    <div className="tile" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="tile-h">
        <div className="tile-lbl">Readiness</div>
        <span style={{ ...chipStyle(color), fontSize: 9 }}>{ans.level.toUpperCase()}</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.5 }}>
        {ans.message}
      </div>
    </div>
  );
}

function RpeTile({ date, existing, prescription }: { date: string; existing: import('../../../lib/rpe-store').WorkoutRpe | null; prescription: DayPrescription }) {
  return (
    <div className="tile" style={{
      borderStyle: existing ? 'solid' : 'dashed',
      borderColor: existing ? 'var(--color-l4)' : 'var(--color-attention)',
    }}>
      <div className="tile-h">
        <div className="tile-lbl">{prescription.isToday ? 'How did it feel?' : 'Log this session'}</div>
      </div>
      <RpeInput workoutDate={date} existing={existing} compact={!prescription.isToday} />
    </div>
  );
}

function ContextTile({ prescription, todayISO }: { prescription: DayPrescription; todayISO: string }) {
  const daysFromNow = Math.round((Date.parse(prescription.date) - Date.parse(todayISO)) / 86_400_000);
  const horizon = daysFromNow === 0 ? 'today'
                : daysFromNow === 1 ? 'tomorrow'
                : daysFromNow === -1 ? 'yesterday'
                : daysFromNow > 0 ? `in ${daysFromNow} days`
                : `${Math.abs(daysFromNow)} days ago`;
  return (
    <div className="tile">
      <div className="tile-h"><div className="tile-lbl">Context</div></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: 'var(--color-t1)', lineHeight: 1.55 }}>
        <Row k="When" v={horizon} />
        <Row k="Type" v={prescription.label} />
        <Row k="Distance" v={`${prescription.distanceMi.toFixed(1)} mi`} />
        {prescription.hrZone && <Row k="HR zone" v={`Z${prescription.hrZone}`} />}
        {prescription.paceTargetSPerMi && (
          <Row k="Pace" v={`${formatPace(prescription.paceTargetSPerMi.lowS)}–${formatPace(prescription.paceTargetSPerMi.highS)} /mi`} />
        )}
        <Row k="Quality" v={prescription.isQuality ? 'Yes' : 'No'} />
        <Row k="Long" v={prescription.isLong ? 'Yes' : 'No'} />
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingBottom: 6, borderBottom: '1px solid var(--color-l4)' }}>
      <span style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.4px', color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase' }}>{k}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--color-t1)' }}>{v}</span>
    </div>
  );
}

function OutOfScopeCard({ date }: { date: string }) {
  return (
    <div className="tile" style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, color: 'var(--color-t0)', marginBottom: 6 }}>
        No prescription for {date}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-t2)', lineHeight: 1.5, maxWidth: 480, margin: '0 auto' }}>
        The Coach plans 30 days forward and the current calendar week back — dates outside that window aren&apos;t prescribed yet. Open the dashboard or training page to see what&apos;s next.
      </div>
      <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'center' }}>
        <Link href="/" className="btn btn--ghost">Dashboard</Link>
        <Link href="/training" className="btn btn--primary">Training</Link>
      </div>
    </div>
  );
}

function RaceDayCard({ date, raceName, priority }: { date: string; raceName: string; priority: 'A' | 'B' | 'C' }) {
  const priorityColor = priority === 'A' ? 'var(--color-warning)' : priority === 'B' ? 'var(--color-attention)' : 'var(--color-corporate)';
  return (
    <div className="tile" style={{ padding: '32px 36px', textAlign: 'center', borderColor: priorityColor }}>
      <div style={{ ...chipStyle(priorityColor), display: 'inline-block', marginBottom: 12 }}>RACE DAY · PRIORITY {priority}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 40, color: 'var(--color-t0)' }}>{raceName}</div>
      <div style={{ fontSize: 13, color: 'var(--color-t2)', marginTop: 8 }}>
        Race-day prescription, course details, weather, and pacing live on the race page.
      </div>
      <div style={{ marginTop: 18 }}>
        <Link href="/races" className="btn btn--primary">Open race</Link>
      </div>
      <div style={{ marginTop: 18, fontSize: 11, color: 'var(--color-t3)', fontFamily: 'var(--font-data)', letterSpacing: '1.4px' }}>
        {date}
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────
function isPastDate(target: string, today: string): boolean {
  return target < today;
}

/** Estimate workout duration in minutes from distance + pace target.
 *  Falls back to a generic 9:00/mi for easy work when no pace target. */
function estimateDurationMin(p: DayPrescription): number | null {
  if (p.distanceMi <= 0) return null;
  if (p.paceTargetSPerMi) {
    const avgPace = (p.paceTargetSPerMi.lowS + p.paceTargetSPerMi.highS) / 2;
    return (p.distanceMi * avgPace) / 60;
  }
  // Pace fallback by intensity: easy 9:00, quality 7:30, long 9:30, recovery 10:00.
  const fallbackSecPerMi = p.isQuality ? 450 : p.type === 'recovery' ? 600 : p.isLong ? 570 : 540;
  return (p.distanceMi * fallbackSecPerMi) / 60;
}

function formatPace(secPerMi: number): string {
  const m = Math.floor(secPerMi / 60);
  const s = Math.round(secPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
