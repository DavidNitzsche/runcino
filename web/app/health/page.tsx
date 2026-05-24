/**
 * /health, fresh React port of designs/health-v4.html.
 *
 * Sections matching the approved mockup:
 *   1. Coach strip, health readout narrative + compact Today's Check-In
 *   2. Today's Readiness hero, 4-section coach brief (The Read /
 *      What's Working / The Watch / The Frame) + readiness ring +
 *      5 trend rows (Sleep / Resting HR / HRV / Strain / Check-In)
 *   3. Insights, pattern reads from last 14 days
 *   4. Check-In Timeline, 14-day legend + bar chart (placeholder)
 *   5. Training Load, Fitness/Fatigue/Form stats + form-curve SVG
 *   6. Recovery Vitals, Sleep / Resting HR / HRV / Body Mass tiles
 *
 * Sample seed values mirror designs/health-v4.html. Real-data wiring
 * happens when HealthKit / Strava streams hook in.
 */

import { Topbar } from '@/app/components';
import { ConnectBannerIsland } from '../training/ConnectBannerIsland';
import { CheckInMiniIsland } from './CheckInMiniIsland';
import { HrAnchorsIsland } from './HrAnchorsIsland';
import { InjuryLogIsland } from './InjuryLogIsland';
import { IllnessLogIsland } from './IllnessLogIsland';
import { requireActiveUser } from '@/lib/auth';
import { syncStravaIfStale } from '@/lib/sync-strava-user';
import { query } from '@/lib/db';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';
import { computeReadinessScore } from '@/lib/readiness-score';
import { computeZ2CoverageFinding } from '@/lib/z2-coverage';
import { resolveFitness } from '@/lib/fitness-resolver';
import { buildHrZonesBundle, type ZoneTier } from '@/lib/hr-zones';
import { gatherCoachState, loadSleepDeficit14d } from '@/lib/coach-state';
import { buildTrainingLoad } from '@/lib/training-load';
import { generateWeeklyInsights } from '@/lib/weekly-insights';
import { getRealPlanWeeks } from '@/lib/plan-weeks';
import { resolvePlanUserId } from '@/lib/plan-user';
import { findCurrentWeek } from '@/lib/synthetic-plan';
import './health-v4.css';

// Plain-language names + "what it feels like" for each HR zone, so a normal
// person never sees "VO₂max" or "%HRR". Keyed by zone tier (z1..z5).
const ZONE_PLAIN: Record<string, { name: string; feel: string }> = {
  z1: { name: 'Recovery', feel: 'Very easy, warm-up pace' },
  z2: { name: 'Easy',     feel: 'Easy, you can hold a conversation' },
  z3: { name: 'Steady',   feel: 'Moderate, comfortably working' },
  z4: { name: 'Hard',     feel: 'Hard, only a few words at a time' },
  z5: { name: 'Max',      feel: 'Very hard, all-out' },
};

export default async function HealthPage() {
  const auth = await requireActiveUser();
  await syncStravaIfStale(auth.id);

  const today = todayISO(auth.timezone || userTimezone(auth.location));
  const todayLabel = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();

  // Today's check-in (from /api/checkin POST). Used by the "What's
  // driving it" panel, was hardcoded "Not logged" in the v4 mockup.
  interface CheckinRow { energy: number; soreness: number; stress: number }
  const checkinRows = await query<CheckinRow>(
    `SELECT energy, soreness, stress
       FROM daily_checkin
      WHERE date = $1 AND (user_uuid = $2 OR (user_uuid IS NULL AND user_id = 'me'))
      ORDER BY user_uuid NULLS LAST
      LIMIT 1`,
    [today, auth.id],
  );
  const checkin = checkinRows[0] ?? null;

  // Composite freshness score: avg of energy + inverted soreness + inverted
  // stress, scaled 0-100 for the bar width.
  let checkinValue = 'Not logged';
  let checkinTone: 'green' | 'amber' | 'dim' = 'dim';
  let checkinWidth = 0;
  if (checkin) {
    const score = (checkin.energy + (11 - checkin.soreness) + (11 - checkin.stress)) / 3;
    checkinValue = `${checkin.energy} energy · ${checkin.soreness} sore · ${checkin.stress} stress`;
    checkinTone = score >= 7 ? 'green' : score >= 5 ? 'amber' : 'amber';
    checkinWidth = Math.round((score / 10) * 100);
  }

  // ── Biometrics from HealthKit ingest (health_samples), 7-day avgs ──
  interface BioRow { sample_type: string; avg: number }
  const bioRows = await query<BioRow>(
    `SELECT sample_type, AVG(value)::float8 AS avg
       FROM health_samples
      WHERE user_id = $1
        AND sample_date >= (CURRENT_DATE - INTERVAL '7 days')
        AND sample_type IN ('resting_hr', 'hrv', 'sleep_hours', 'vo2_max',
                            'max_hr', 'respiratory_rate', 'wrist_temp')
      GROUP BY sample_type`,
    [auth.id],
  ).catch(() => [] as BioRow[]);
  const bio = new Map(bioRows.map((r) => [r.sample_type, Number(r.avg)]));
  const rhr = bio.get('resting_hr') ?? null;
  const hrv = bio.get('hrv') ?? null;
  const sleep = bio.get('sleep_hours') ?? null;
  const vo2 = bio.get('vo2_max') ?? null;
  const maxHr = bio.get('max_hr') ?? null;
  const resp = bio.get('respiratory_rate') ?? null;
  const wristTemp = bio.get('wrist_temp') ?? null;
  const hasBio = rhr != null || hrv != null || sleep != null || vo2 != null;
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  // 14-day sleep deficit (Whoop-style debt). Single source of truth
  // with iPhone — same helper computes the buckets + coach copy.
  const sleepDebt = await loadSleepDeficit14d(auth.id);

  // ── Running dynamics (health_samples), 30-day averages ──
  const dynRows = await query<BioRow>(
    `SELECT sample_type, AVG(value)::float8 AS avg
       FROM health_samples
      WHERE user_id = $1
        AND sample_date >= (CURRENT_DATE - INTERVAL '30 days')
        AND sample_type IN ('cadence', 'stride_length', 'vertical_oscillation',
                            'ground_contact_time', 'vertical_ratio', 'run_power')
      GROUP BY sample_type`,
    [auth.id],
  ).catch(() => [] as BioRow[]);
  const dyn = new Map(dynRows.map((r) => [r.sample_type, Number(r.avg)]));
  const dynVal = (k: string, dec: number, unit: string) => {
    const v = dyn.get(k);
    return v != null ? { value: v.toFixed(dec), unit } : { value: '-', unit: '' };
  };
  const cadence    = dynVal('cadence', 0, 'spm');
  const stride     = dynVal('stride_length', 2, 'm');
  const vertOsc    = dynVal('vertical_oscillation', 1, 'cm');
  const groundC    = dynVal('ground_contact_time', 0, 'ms');
  const vertRatio  = dynVal('vertical_ratio', 1, '%');
  const runPower   = dynVal('run_power', 0, 'W');
  const hasDyn = dynRows.length > 0;

  // ── Body composition + extra vitals (health_samples), 7-day avgs ──
  // Weight / body-fat / lean mass change slowly, so a 7-day window is a
  // stable read; HR-recovery / SpO2 / active-energy are daily readings.
  const bodyRows = await query<BioRow>(
    `SELECT sample_type, AVG(value)::float8 AS avg
       FROM health_samples
      WHERE user_id = $1
        AND sample_date >= (CURRENT_DATE - INTERVAL '7 days')
        AND sample_type IN ('body_mass', 'body_fat_pct', 'lean_mass',
                            'hr_recovery', 'spo2', 'active_energy')
      GROUP BY sample_type`,
    [auth.id],
  ).catch(() => [] as BioRow[]);
  const body = new Map(bodyRows.map((r) => [r.sample_type, Number(r.avg)]));
  const bodyVal = (k: string, dec: number, unit: string) => {
    const v = body.get(k);
    return v != null ? { value: v.toFixed(dec), unit } : { value: '-', unit: '' };
  };
  const bodyMass    = bodyVal('body_mass', 1, 'kg');
  const bodyFat     = bodyVal('body_fat_pct', 1, '%');
  const leanMass    = bodyVal('lean_mass', 1, 'kg');
  const hrRecovery  = bodyVal('hr_recovery', 0, 'bpm');
  const spo2        = bodyVal('spo2', 0, '%');
  const activeEnergy = bodyVal('active_energy', 0, 'kcal');
  const hasBody = bodyRows.length > 0;

  const sleepRow = sleep != null
    ? { value: `${sleep.toFixed(1)} h`, tone: (sleep >= 7 ? 'green' : 'amber') as 'green' | 'amber', width: clamp((sleep / 8) * 100) }
    : { value: 'No data', tone: 'dim' as const, width: 0 };
  const rhrRow = rhr != null
    ? { value: `${Math.round(rhr)} bpm`, tone: (rhr <= 55 ? 'green' : 'amber') as 'green' | 'amber', width: clamp(((75 - rhr) / 35) * 100) }
    : { value: 'No data', tone: 'dim' as const, width: 0 };
  const hrvRow = hrv != null
    ? { value: `${Math.round(hrv)} ms`, tone: (hrv >= 60 ? 'green' : 'amber') as 'green' | 'amber', width: clamp((hrv / 120) * 100) }
    : { value: 'No data', tone: 'dim' as const, width: 0 };
  const vo2Row = vo2 != null
    ? { value: `${vo2.toFixed(1)}`, tone: (vo2 >= 50 ? 'green' : 'amber') as 'green' | 'amber', width: clamp((vo2 / 60) * 100) }
    : { value: 'No data', tone: 'dim' as const, width: 0 };

  // ── Readiness + coach brief (real, not placeholder) ──
  const fitness = await resolveFitness(auth.id, today).catch(() => null);
  const z2Finding = fitness
    ? await computeZ2CoverageFinding(auth.id, today, fitness.maxHr.value, fitness.restingHr.value, fitness.vdot.value).catch(() => null)
    : null;
  const readiness = fitness
    ? await computeReadinessScore(auth.id, today, fitness.maxHr.value, fitness.restingHr.value, z2Finding).catch(() => null)
    : null;
  const readyScore = readiness?.score ?? null;
  const readyState = readiness?.state ?? null;

  // ── HR zones, Karvonen scale anchored on the runner's real anchors.
  // resolveFitness already merges manual + computed max/resting HR; the
  // health_samples max_hr above is a separate (wearable-derived) read and
  // is only a fallback when fitness has no anchor.
  const anchorMaxHr = fitness?.maxHr.value ?? (maxHr != null ? Math.round(maxHr) : null);
  const anchorRestingHr = fitness?.restingHr.value ?? (rhr != null ? Math.round(rhr) : null);
  const hrBundle = buildHrZonesBundle(anchorMaxHr, anchorRestingHr);
  const zoneColors: Record<ZoneTier, string> = {
    z1: 'rgba(8,8,8,.35)', // Recovery, grey
    z2: '#3EBD41',            // Easy, green
    z3: '#F3AD38',            // Steady, amber
    z4: '#E85D26',            // Threshold, orange
    z5: '#FC4D64',            // VO2max, red
  };
  const maxHrSourceLabel = fitness?.maxHr.sourceLabel
    ?? (fitness?.maxHr.source === 'manual' ? 'Manual override'
      : fitness?.maxHr.source === 'computed' ? 'Computed from activity'
        : maxHr != null ? 'Apple Health (7-day max)' : 'No data');
  const restingHrSourceLabel = fitness?.restingHr.source === 'manual' ? 'Manual override'
    : fitness?.restingHr.source === 'computed' ? 'Computed from activity'
      : rhr != null ? 'Apple Health (7-day avg)' : 'No data';
  const stateColor = readyState === 'green' ? '#3EBD41' : readyState === 'yellow' ? '#F3AD38' : readyState === 'red' ? '#FC4D64' : 'rgba(8,8,8,.32)';
  const stateWord = readyState === 'green' ? 'Recovered' : readyState === 'yellow' ? 'Hold steady' : readyState === 'red' ? 'Back off' : 'Waiting on data';
  // Build the four-section brief from the readiness inputs + vitals.
  const posInputs = (readiness?.inputs ?? []).filter((i) => i.delta > 0).map((i) => i.note);
  const negInputs = (readiness?.inputs ?? []).filter((i) => i.delta < 0).map((i) => i.note);
  const vitalBits: string[] = [];
  if (hrv != null) vitalBits.push(`HRV ${Math.round(hrv)}ms`);
  if (rhr != null) vitalBits.push(`resting HR ${Math.round(rhr)}`);
  if (sleep != null) vitalBits.push(`${sleep.toFixed(1)}h sleep`);
  const briefRead = readiness?.recommendation
    ?? (hasBio ? readBodyShort() : 'Connect a wearable or log check-ins and a daily readiness read lands here.');
  const briefWorking = posInputs.length ? cap(posInputs.join('; ')) + '.' : (vitalBits.length ? `${cap(vitalBits.join(', '))}, vitals tracking.` : 'No positive signals logged yet.');
  const briefWatch = negInputs.length ? cap(negInputs.join('; ')) + '.' : 'Nothing flagged, no elevated load or drift signals.';
  const briefFrame = [
    readyScore != null ? `Readiness ${readyScore}/100` : null,
    vo2 != null ? `VO₂max ${vo2.toFixed(1)}` : null,
    readiness?.missingInputs?.length ? `Missing: ${readiness.missingInputs.join(', ')}` : null,
  ].filter(Boolean).join(' · ') || 'The frame fills in as more days of data accumulate.';

  function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
  function readBodyShort(): string {
    return `From Apple Health: ${vitalBits.join(', ')}. Trends build as more days sync.`;
  }

  const heroTitle = readyState ? stateWord.toUpperCase() : (hasBio ? 'TRACKED' : (checkin ? 'CHECK IN LOGGED' : 'NO DATA'));

  // ── Training Load (CTL / ATL / TSB), real, from coach-state volume ──
  // Same computation /api/health serves, via the shared pure helper.
  const coachState = await gatherCoachState({ userId: auth.id }).catch(() => null);
  const trainingLoad = coachState
    ? buildTrainingLoad({
        weeklyAvg8wMi: coachState.volume.weeklyAvg8w,
        last7Mi: coachState.volume.last7Mi,
      })
    : null;

  // ── Weekly insights, plan-aware pattern reads (same call /overview uses) ──
  // Needs the runner's real plan (current week's planned mileage + phase)
  // and the VDOT-derived easy band from resolveFitness.
  let insights: Awaited<ReturnType<typeof generateWeeklyInsights>> = [];
  try {
    const weeks = await getRealPlanWeeks(await resolvePlanUserId());
    if (weeks.length > 0 && fitness) {
      const currentWeek = findCurrentWeek(weeks, today);
      insights = await generateWeeklyInsights(auth.id, today, {
        thisWeekPlannedMi: currentWeek.plannedMi,
        easyPaceLowSec: fitness.easyPaceBand.lowS,
        easyPaceHighSec: fitness.easyPaceBand.highS,
        phase: currentWeek.phase,
      });
    }
  } catch {
    insights = [];
  }

  return (
    <div className="health-v4-page">
      <Topbar activeTab="health" showAdmin={auth.is_admin} />
      <ConnectBannerIsland />

      <div className="page">

        {/* ── COACH STRIP ── */}
        <div className="coach-strip">
          <div className="coach-strip-text">
            <div className="coach-label">
              <span className="dot"></span>
              COACH · {todayLabel} · HEALTH READOUT
            </div>
            <p className="coach-briefing">
              {readyScore != null
                ? <>Readiness <strong>{readyScore}/100 · {stateWord.toLowerCase()}</strong>. {briefRead}</>
                : <>Connect Apple Health from <a href="/profile" style={{ color: 'var(--green)', textDecoration: 'underline' }}>your profile</a> to see daily readiness, HR trends, and sleep here.</>}
              {checkin ? <> Today&apos;s check-in: <strong>{checkin.energy} energy · {checkin.soreness} soreness · {checkin.stress} stress</strong>.</> : <> Log a quick check-in on the right.</>}
            </p>
          </div>
          <CheckInMiniIsland today={today} />
        </div>

        {/* Injury + Illness logging affordances — give the runner real
            ways to enter INJURY / ILLNESS mode, which trigger the
            ActiveModeBanner + return-protocol or rest-prescription
            gating across every page. */}
        <div style={{ marginTop: 16, marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <InjuryLogIsland />
          <IllnessLogIsland />
        </div>

        {/* ── HEALTH HERO ── */}
        <div className="health-hero">
          <div className="health-hero-left">
            <div className="health-hero-eyebrow">TODAY · {todayLabel} · HEALTH</div>
            <div className="health-hero-title">{heroTitle}</div>
            <div className="brief-sections">
              <div className="brief-section">
                <div className="brief-section-label read">The Read</div>
                <p className="brief-section-body">{briefRead}</p>
              </div>
              <div className="brief-section">
                <div className="brief-section-label work">What&apos;s Working</div>
                <p className="brief-section-body">{briefWorking}</p>
              </div>
              <div className="brief-section">
                <div className="brief-section-label watch">The Watch</div>
                <p className="brief-section-body">{briefWatch}</p>
              </div>
              <div className="brief-section">
                <div className="brief-section-label frame">The Frame</div>
                <p className="brief-section-body">{briefFrame}</p>
              </div>
            </div>
          </div>

          <div className="health-hero-right">
            <div className="health-hero-right-header">
              <span className="health-hero-right-label">What&apos;s Driving It</span>
            </div>
            <div className="health-hero-ring-section">
              <div className="health-hero-ring">
                <svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet">
                  <circle cx="150" cy="150" r="130" fill="none" stroke="rgba(8,8,8,.08)" strokeWidth="16" strokeDasharray="816.81 0" strokeLinecap="round" transform="rotate(135 150 150)" />
                  {readyScore != null && (
                    <circle
                      cx="150" cy="150" r="130" fill="none" stroke={stateColor} strokeWidth="16"
                      strokeDasharray={`${(readyScore / 100) * 816.81} 816.81`} strokeLinecap="round"
                      transform="rotate(-90 150 150)"
                    />
                  )}
                  <text x="150" y="166" fontFamily="Bebas Neue" fontSize="64" fill={readyScore != null ? '#080808' : 'rgba(8,8,8,.32)'} textAnchor="middle">{readyScore ?? '-'}</text>
                  <text x="150" y="200" fontFamily="Inter" fontSize="11" fontWeight="600" fill={stateColor} textAnchor="middle" letterSpacing="1">{(readyState ?? 'no data').toUpperCase()}</text>
                </svg>
              </div>
              <div className="health-hero-state" style={{ color: stateColor }}>{stateWord}</div>
            </div>

            <div className="health-trend-rows">
              <HealthTrendRow label="Sleep 7d"   value={sleepRow.value} tone={sleepRow.tone} width={sleepRow.width} />
              <HealthTrendRow label="Resting HR" value={rhrRow.value}   tone={rhrRow.tone}   width={rhrRow.width} />
              <HealthTrendRow label="HRV"        value={hrvRow.value}   tone={hrvRow.tone}   width={hrvRow.width} />
              <HealthTrendRow label="VO₂max"     value={vo2Row.value}   tone={vo2Row.tone}   width={vo2Row.width} />
              <HealthTrendRow label="Check-In"   value={checkinValue} tone={checkinTone} width={checkinWidth} />
            </div>
          </div>
        </div>

        {/* ── HR ZONES + ANCHORS ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">HR Zones</div>
              <div className="card-sub">
                {hrBundle
                  ? <>What each effort should feel like, set from your own max and resting heart rate.</>
                  : 'Add your max heart rate below to see your personal zones.'}
              </div>
            </div>
            <div className="card-meta" style={{ color: hrBundle ? '#080808' : 'rgba(8,8,8,.45)' }}>
              {hrBundle
                ? <><strong>{hrBundle.maxHr}</strong> max{hrBundle.restingHr != null ? <> · <strong>{hrBundle.restingHr}</strong> rest</> : ''}</>
                : 'No anchors'}
            </div>
          </div>

          {hrBundle ? (
            <div className="hr-zones">
              {hrBundle.zones.map((z) => {
                // Band width is proportional to the bpm span of the zone,
                // so wider physiological zones read as wider bands.
                const span = z.highBpm - z.lowBpm;
                const total = hrBundle.zones[4].highBpm - hrBundle.zones[0].lowBpm;
                const widthPct = total > 0 ? (span / total) * 100 : 20;
                return (
                  <div className="hr-zone-row" key={z.tier}>
                    <div className="hr-zone-name">{ZONE_PLAIN[z.tier]?.name ?? z.name}</div>
                    <div className="hr-zone-band-wrap">
                      <div
                        className="hr-zone-band"
                        style={{ width: `${widthPct}%`, background: zoneColors[z.tier] }}
                      >
                        <span className="hr-zone-band-bpm">{z.lowBpm}–{z.highBpm} bpm</span>
                      </div>
                    </div>
                    <div className="hr-zone-pct">{ZONE_PLAIN[z.tier]?.feel ?? ''}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '8px 40px 28px', fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(8,8,8,.55)' }}>
              Add your max heart rate below and your five effort zones, from very easy to all-out, 
              show up here, tuned to you.
            </div>
          )}

          {/* HR anchors, editable, POST to /api/profile/{max,resting}-hr */}
          <div className="hr-anchors-header">HR Anchors</div>
          <HrAnchorsIsland
            initialMaxHr={{ value: anchorMaxHr, source: fitness?.maxHr.source ?? (maxHr != null ? 'computed' : 'none'), autoValue: fitness?.maxHr.autoValue ?? null }}
            initialRestingHr={{ value: anchorRestingHr, source: fitness?.restingHr.source ?? (rhr != null ? 'computed' : 'none') }}
          />
          <div className="hr-anchor-provenance">
            Resolved Max HR source: <strong>{maxHrSourceLabel}</strong> · Resting HR source: <strong>{restingHrSourceLabel}</strong>.
            Edits save instantly and re-anchor every zone above.
          </div>
        </div>

        {/* ── INSIGHTS ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Insights</div>
              <div className="card-sub">What we&apos;re noticing in your last 2 weeks</div>
            </div>
          </div>
          <div className="insights-list">
            {insights.length > 0 ? (
              insights.map((ins, i) => {
                const icon = ins.tone === 'green' ? '↑' : ins.tone === 'amber' ? '!' : 'i';
                const title = ins.tone === 'green' ? 'On track' : ins.tone === 'amber' ? 'Worth a look' : 'Pattern';
                return (
                  <Insight key={i} tone={ins.tone} icon={icon} title={title}>
                    {ins.text}
                  </Insight>
                );
              })
            ) : (
              <div style={{ padding: '20px 40px 28px', fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(8,8,8,.55)', textAlign: 'center' }}>
                Nothing’s jumping out from your last couple of weeks, keep logging runs and we’ll
                point out anything worth knowing (easy pace creeping up, mileage spiking, your long
                run climbing).
              </div>
            )}
          </div>
        </div>

        {/* ── TRAINING LOAD (form curve) ── */}
        <div className="card form-curve-card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Fitness &amp; Freshness</div>
              <div className="card-sub">How much fitness you&apos;re building vs. how tired you are right now.</div>
            </div>
            <div className="card-meta" style={{ color: trainingLoad?.hasData ? '#080808' : 'rgba(8,8,8,.45)' }}>
              {trainingLoad?.hasData ? trainingLoad.verdictLabel : 'No data'}
            </div>
          </div>

          <div className="form-stats">
            <div className="form-stat">
              <div className="form-stat-label">Fitness</div>
              <div className="form-stat-val" style={trainingLoad?.hasData ? undefined : { color: 'rgba(8,8,8,.32)' }}>
                {trainingLoad?.hasData ? trainingLoad.fitnessCtl : '-'}
              </div>
              <div className="form-stat-sub">{trainingLoad?.hasData ? 'your aerobic base' : 'No data'}</div>
            </div>
            <div className="form-stat">
              <div className="form-stat-label">Fatigue</div>
              <div className="form-stat-val" style={trainingLoad?.hasData ? undefined : { color: 'rgba(8,8,8,.32)' }}>
                {trainingLoad?.hasData ? trainingLoad.fatigueAtl : '-'}
              </div>
              <div className="form-stat-sub">{trainingLoad?.hasData ? 'how hard this week was' : 'No data'}</div>
            </div>
            <div className="form-stat">
              <div className="form-stat-label">Form</div>
              <div
                className={`form-stat-val${trainingLoad?.hasData ? (trainingLoad.formTsb > 0 ? ' green' : trainingLoad.formTsb < -20 ? ' orange' : '') : ''}`}
                style={trainingLoad?.hasData ? undefined : { color: 'rgba(8,8,8,.32)' }}
              >
                {trainingLoad?.hasData ? (trainingLoad.formTsb > 0 ? `+${trainingLoad.formTsb}` : trainingLoad.formTsb) : '-'}
              </div>
              <div className="form-stat-sub">{trainingLoad?.hasData ? 'how fresh you feel' : 'No data'}</div>
            </div>
          </div>

          {trainingLoad?.hasData ? (
            <div style={{ padding: '4px 40px 12px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(8,8,8,.7)' }}>
              {trainingLoad.formTsb > 5
                ? 'You’re fresh right now, fitness is ahead of fatigue. A good window to push hard or race.'
                : trainingLoad.formTsb >= -20
                  ? 'You’re building and carrying a little tiredness, exactly what a normal training week feels like. You’ll feel fresher as you ease off toward race day.'
                  : 'You’re carrying a lot of fatigue right now, a heavy stretch. Keep easy days truly easy so you absorb the work instead of digging a hole.'}
            </div>
          ) : (
            <div style={{ padding: '40px 40px 48px', fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(8,8,8,.55)', textAlign: 'center' }}>
              Training load curves need ~30 days of activity history before they read meaningfully.
              Keep logging runs, Strava is connected, and the chart will fill in here.
            </div>
          )}
        </div>

        {/* ── SLEEP DEBT (Whoop-style 14-day) ── */}
        {sleepDebt && (
          (() => {
            const status = sleepDebt.status;
            const statusLabel =
              status === 'banked' ? 'BANKED'
              : status === 'depleted' ? 'DEPLETED'
              : status === 'building-deficit' ? 'BUILDING DEFICIT'
              : 'ON TARGET';
            const statusBg =
              status === 'banked' ? 'rgba(54, 168, 83, 0.14)'
              : status === 'depleted' ? 'rgba(252, 77, 100, 0.14)'
              : status === 'building-deficit' ? 'rgba(247, 159, 31, 0.14)'
              : 'rgba(8, 8, 8, 0.07)';
            const statusFg =
              status === 'banked' ? '#36A853'
              : status === 'depleted' ? '#FC4D64'
              : status === 'building-deficit' ? '#F79F1F'
              : '#080808';
            return (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div className="card-title-group">
                    <div className="card-title">Sleep · 14 days</div>
                    <div className="card-sub">
                      Cumulative debt against an 8h target. A few short
                      nights stack up faster than you&rsquo;d think.
                    </div>
                  </div>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '4px 9px', borderRadius: 6,
                    background: statusBg, color: statusFg,
                    fontFamily: 'Oswald, sans-serif', fontSize: 10,
                    fontWeight: 600, letterSpacing: 1.2,
                  }}>{statusLabel}</div>
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 16, padding: '8px 0 12px',
                }}>
                  <div>
                    <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 28, color: '#080808', lineHeight: 1 }}>
                      {sleepDebt.hoursOver14d.toFixed(1)}
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(8,8,8,.45)', marginLeft: 3 }}>h</span>
                    </div>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 9.5, fontWeight: 600, letterSpacing: 0.8, color: 'rgba(8,8,8,.55)', marginTop: 3 }}>DEBT</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 28, color: '#080808', lineHeight: 1 }}>
                      {sleepDebt.avg14dHrs.toFixed(1)}
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'rgba(8,8,8,.45)', marginLeft: 3 }}>h</span>
                    </div>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 9.5, fontWeight: 600, letterSpacing: 0.8, color: 'rgba(8,8,8,.55)', marginTop: 3 }}>NIGHTLY AVG</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 28, color: sleepDebt.daysShort > 0 ? '#FC4D64' : '#080808', lineHeight: 1 }}>
                      {sleepDebt.daysShort}
                    </div>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 9.5, fontWeight: 600, letterSpacing: 0.8, color: 'rgba(8,8,8,.55)', marginTop: 3 }}>UNDER 7H</div>
                  </div>
                </div>
                {sleepDebt.message && (
                  <div style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 13.5,
                    color: '#080808', lineHeight: 1.55, paddingTop: 4,
                  }}>{sleepDebt.message}</div>
                )}
              </div>
            );
          })()
        )}

        {/* ── RECOVERY VITALS ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Recovery &amp; Vitals</div>
              <div className="card-sub">Daily readings from Apple Health · 7-day average</div>
            </div>
          </div>
          <div className="vitals-grid">
            <VitalTile label="Sleep"       value={sleep != null ? sleep.toFixed(1) : '-'} unit={sleep != null ? 'h' : ''}     range={[', ',', ']} markerPct={0} avgPct={0} status={sleep != null ? '7-day avg' : 'No data'} />
            <VitalTile label="Resting HR"  value={rhr != null ? String(Math.round(rhr)) : '-'} unit={rhr != null ? 'bpm' : ''} range={[', ',', ']} markerPct={0} avgPct={0} status={rhr != null ? '7-day avg' : 'No data'} />
            <VitalTile label="HRV"         value={hrv != null ? String(Math.round(hrv)) : '-'} unit={hrv != null ? 'ms' : ''}  range={[', ',', ']} markerPct={0} avgPct={0} status={hrv != null ? '7-day avg' : 'No data'} />
            <VitalTile label="VO₂max"      value={vo2 != null ? vo2.toFixed(1) : '-'} unit=""                                  range={[', ',', ']} markerPct={0} avgPct={0} status={vo2 != null ? 'latest' : 'No data'} />
            <VitalTile label="Respiration" value={resp != null ? resp.toFixed(1) : '-'} unit={resp != null ? 'br/m' : ''}      range={[', ',', ']} markerPct={0} avgPct={0} status={resp != null ? '7-day avg' : 'No data'} />
            <VitalTile label="Wrist Temp"  value={wristTemp != null ? wristTemp.toFixed(1) : '-'} unit={wristTemp != null ? '°C' : ''} range={[', ',', ']} markerPct={0} avgPct={0} status={wristTemp != null ? 'sleeping' : 'No data'} />
          </div>
        </div>

        {/* ── BODY COMPOSITION ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Body Composition</div>
              <div className="card-sub">Mass, composition &amp; cardio markers from Apple Health · 7-day average</div>
            </div>
            <div className="card-meta" style={{ color: hasBody ? '#080808' : 'rgba(8,8,8,.45)' }}>{hasBody ? '7-day avg' : 'No data'}</div>
          </div>
          <div className="vitals-grid">
            <VitalTile label="Weight"        value={bodyMass.value}     unit={bodyMass.unit}     range={[', ',', ']} markerPct={0} avgPct={0} status={bodyMass.value !== ', ' ? '7-day avg' : 'No data'} />
            <VitalTile label="Body Fat"      value={bodyFat.value}      unit={bodyFat.unit}      range={[', ',', ']} markerPct={0} avgPct={0} status={bodyFat.value !== ', ' ? '7-day avg' : 'No data'} />
            <VitalTile label="Lean Mass"     value={leanMass.value}     unit={leanMass.unit}     range={[', ',', ']} markerPct={0} avgPct={0} status={leanMass.value !== ', ' ? '7-day avg' : 'No data'} />
            <VitalTile label="HR Recovery"   value={hrRecovery.value}   unit={hrRecovery.unit}   range={[', ',', ']} markerPct={0} avgPct={0} status={hrRecovery.value !== ', ' ? '7-day avg' : 'No data'} />
            <VitalTile label="Blood O₂"      value={spo2.value}         unit={spo2.unit}         range={[', ',', ']} markerPct={0} avgPct={0} status={spo2.value !== ', ' ? '7-day avg' : 'No data'} />
            <VitalTile label="Active Energy" value={activeEnergy.value} unit={activeEnergy.unit} range={[', ',', ']} markerPct={0} avgPct={0} status={activeEnergy.value !== ', ' ? '7-day avg' : 'No data'} />
          </div>
          {!hasBody && (
            <div style={{ padding: '0 40px 28px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(8,8,8,.55)' }}>
              Body composition and cardio markers sync from a connected scale and your Apple Watch once Apple Health is linked.
            </div>
          )}
        </div>

        {/* ── RUNNING DYNAMICS (cumulative) ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Running Dynamics</div>
              <div className="card-sub">Form metrics from Apple Health · 30-day average across runs</div>
            </div>
            <div className="card-meta" style={{ color: 'rgba(8,8,8,.45)' }}>{hasDyn ? '30-day avg' : 'No data'}</div>
          </div>
          <div className="vitals-grid">
            <VitalTile label="Cadence"      value={cadence.value}   unit={cadence.unit}   range={[', ',', ']} markerPct={0} avgPct={0} status={hasDyn && cadence.value !== ', ' ? '30-day avg' : 'No data'} />
            <VitalTile label="Stride"       value={stride.value}    unit={stride.unit}    range={[', ',', ']} markerPct={0} avgPct={0} status={hasDyn && stride.value !== ', ' ? '30-day avg' : 'No data'} />
            <VitalTile label="Vert Osc"     value={vertOsc.value}   unit={vertOsc.unit}   range={[', ',', ']} markerPct={0} avgPct={0} status={hasDyn && vertOsc.value !== ', ' ? '30-day avg' : 'No data'} />
            <VitalTile label="Grnd Contact" value={groundC.value}   unit={groundC.unit}   range={[', ',', ']} markerPct={0} avgPct={0} status={hasDyn && groundC.value !== ', ' ? '30-day avg' : 'No data'} />
            <VitalTile label="Vert Ratio"   value={vertRatio.value} unit={vertRatio.unit} range={[', ',', ']} markerPct={0} avgPct={0} status={hasDyn && vertRatio.value !== ', ' ? '30-day avg' : 'No data'} />
            <VitalTile label="Run Power"    value={runPower.value}  unit={runPower.unit}  range={[', ',', ']} markerPct={0} avgPct={0} status={hasDyn && runPower.value !== ', ' ? '30-day avg' : 'No data'} />
          </div>
          {!hasDyn && (
            <div style={{ padding: '0 40px 28px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(8,8,8,.55)' }}>
              Running dynamics sync from your Apple Watch runs once Apple Health is connected. Per-run form appears on each run recap.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function HealthTrendRow({ label, value, tone, width }: { label: string; value: string; tone: 'green' | 'amber' | 'dim'; width: number }) {
  return (
    <div className="health-trend-row">
      <div className="health-trend-row-top">
        <span className="health-trend-row-label">{label}</span>
        <span className={`health-trend-row-value ${tone}`}>{value}</span>
      </div>
      <div className="health-trend-bar-track">
        <div className={`health-trend-bar-fill ${tone}`} style={{ width: `${width}%` }}></div>
      </div>
    </div>
  );
}

function Insight({ tone, icon, title, children }: { tone: 'green' | 'amber' | 'blue'; icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="insight-row">
      <div className={`insight-icon ${tone}`}>{icon}</div>
      <div className="insight-body">
        <div className="insight-title">{title}</div>
        <div className="insight-detail">{children}</div>
      </div>
    </div>
  );
}

function VitalTile({ label, value, unit, range, markerPct, avgPct, status, sample }: {
  label: string; value: string; unit: string;
  range: [string, string]; markerPct: number; avgPct: number;
  status: string; sample?: boolean;
}) {
  return (
    <div className={`vital-tile${sample ? ' sample' : ''}`}>
      <div className="vital-tile-header">
        <span className="vital-tile-label">{label}</span>
        {sample && <span className="vital-tile-badge sample">Sample</span>}
      </div>
      <div className="vital-tile-value">{value}<span className="vital-tile-unit">{unit}</span></div>
      <div className="vital-tile-range">
        <span className="vital-tile-range-end">{range[0]}</span>
        <div className="vital-tile-range-bar">
          <span className="vital-tile-range-avg" style={{ left: `${avgPct}%` }}></span>
          <span className={`vital-tile-range-marker${sample ? ' amber' : ''}`} style={{ left: `${markerPct}%` }}></span>
        </div>
        <span className="vital-tile-range-end right">{range[1]}</span>
      </div>
      <div className={`vital-tile-status ${sample ? '' : 'green'}`}>{status}</div>
    </div>
  );
}
