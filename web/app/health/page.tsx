/**
 * /health — fresh React port of designs/health-v4.html.
 *
 * Sections matching the approved mockup:
 *   1. Coach strip — health readout narrative + compact Today's Check-In
 *   2. Today's Readiness hero — 4-section coach brief (The Read /
 *      What's Working / The Watch / The Frame) + readiness ring +
 *      5 trend rows (Sleep / Resting HR / HRV / Strain / Check-In)
 *   3. Insights — pattern reads from last 14 days
 *   4. Check-In Timeline — 14-day legend + bar chart (placeholder)
 *   5. Training Load — Fitness/Fatigue/Form stats + form-curve SVG
 *   6. Recovery Vitals — Sleep / Resting HR / HRV / Body Mass tiles
 *
 * Sample seed values mirror designs/health-v4.html. Real-data wiring
 * happens when HealthKit / Strava streams hook in.
 */

import { Topbar } from '@/app/components';
import { ConnectBannerIsland } from '../training/ConnectBannerIsland';
import { CheckInMiniIsland } from './CheckInMiniIsland';
import { requireActiveUser } from '@/lib/auth';
import { syncStravaIfStale } from '@/lib/sync-strava-user';
import { query } from '@/lib/db';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';
import './health-v4.css';

export default async function HealthPage() {
  const auth = await requireActiveUser();
  await syncStravaIfStale(auth.id);

  const today = todayISO(userTimezone(auth.location));
  const todayLabel = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();

  // Today's check-in (from /api/checkin POST). Used by the "What's
  // driving it" panel — was hardcoded "Not logged" in the v4 mockup.
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
        AND sample_type IN ('resting_hr', 'hrv', 'sleep_hours', 'vo2_max')
      GROUP BY sample_type`,
    [auth.id],
  ).catch(() => [] as BioRow[]);
  const bio = new Map(bioRows.map((r) => [r.sample_type, Number(r.avg)]));
  const rhr = bio.get('resting_hr') ?? null;
  const hrv = bio.get('hrv') ?? null;
  const sleep = bio.get('sleep_hours') ?? null;
  const vo2 = bio.get('vo2_max') ?? null;
  const hasBio = rhr != null || hrv != null || sleep != null || vo2 != null;
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

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

  const heroTitle = hasBio ? 'TRACKED' : (checkin ? 'CHECK IN LOGGED' : 'NO DATA');
  const readBody = hasBio
    ? `From Apple Health (7-day average): ${rhr != null ? `resting HR ${Math.round(rhr)} bpm` : ''}${rhr != null && (hrv != null || sleep != null) ? ', ' : ''}${hrv != null ? `HRV ${Math.round(hrv)} ms` : ''}${hrv != null && sleep != null ? ', ' : ''}${sleep != null ? `${sleep.toFixed(1)} h sleep` : ''}. Trends build as more days sync.`
    : 'No data. Once a wearable is connected (Apple Health, Whoop, Oura) or you’ve logged a few days of check-ins, daily readouts of HRV, resting HR, and sleep will land here.';

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
              No wearable data yet. Connect Apple Health, Whoop, or Oura from <a href="/profile" style={{ color: 'var(--green)', textDecoration: 'underline' }}>your profile</a> to see daily readiness, HR trends, sleep, and strain readouts here.
              {checkin ? <> Your check-in today: <strong>{checkin.energy} energy · {checkin.soreness} soreness · {checkin.stress} stress</strong>.</> : <> Log a quick check-in on the right to get started.</>}
            </p>
          </div>
          <CheckInMiniIsland today={today} />
        </div>

        {/* ── HEALTH HERO ── */}
        <div className="health-hero">
          <div className="health-hero-left">
            <div className="health-hero-eyebrow">TODAY · {todayLabel} · HEALTH</div>
            <div className="health-hero-title">{heroTitle}</div>
            <div className="brief-sections">
              <div className="brief-section">
                <div className="brief-section-label read">The Read</div>
                <p className="brief-section-body">{readBody}</p>
              </div>
              <div className="brief-section">
                <div className="brief-section-label work">What&apos;s Working</div>
                <p className="brief-section-body">No data yet.</p>
              </div>
              <div className="brief-section">
                <div className="brief-section-label watch">The Watch</div>
                <p className="brief-section-body">No data yet.</p>
              </div>
              <div className="brief-section">
                <div className="brief-section-label frame">The Frame</div>
                <p className="brief-section-body">No data yet.</p>
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
                  <circle cx="150" cy="150" r="130" fill="none" stroke="rgba(13,15,18,.08)" strokeWidth="16" strokeDasharray="816.81 0" strokeLinecap="round" transform="rotate(135 150 150)" />
                  <text x="150" y="166" fontFamily="Bebas Neue" fontSize="64" fill="rgba(13,15,18,.32)" textAnchor="middle">—</text>
                  <text x="150" y="200" fontFamily="Inter" fontSize="11" fontWeight="600" fill="rgba(13,15,18,.32)" textAnchor="middle" letterSpacing="1">NO DATA</text>
                </svg>
              </div>
              <div className="health-hero-state" style={{ color: 'rgba(13,15,18,.45)' }}>Waiting on data</div>
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

        {/* ── INSIGHTS ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Insights</div>
              <div className="card-sub">Pattern reads from the last 14 days</div>
            </div>
          </div>
          <div className="insights-list">
            <div style={{ padding: '20px 40px 28px', fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(13,15,18,.55)', textAlign: 'center' }}>
              No insights yet. Connect a wearable + log a few days of check-ins, and patterns
              from the last 14 days will surface here automatically.
            </div>
          </div>
        </div>

        {/* ── TRAINING LOAD (form curve) ── */}
        <div className="card form-curve-card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Training Load</div>
              <div className="card-sub">Fitness / fatigue / form curves derived from training data</div>
            </div>
            <div className="card-meta" style={{ color: 'rgba(13,15,18,.45)' }}>No data</div>
          </div>

          <div className="form-stats">
            <div className="form-stat">
              <div className="form-stat-label">Fitness</div>
              <div className="form-stat-val" style={{ color: 'rgba(13,15,18,.32)' }}>—</div>
              <div className="form-stat-sub">No data</div>
            </div>
            <div className="form-stat">
              <div className="form-stat-label">Fatigue</div>
              <div className="form-stat-val" style={{ color: 'rgba(13,15,18,.32)' }}>—</div>
              <div className="form-stat-sub">No data</div>
            </div>
            <div className="form-stat">
              <div className="form-stat-label">Form</div>
              <div className="form-stat-val" style={{ color: 'rgba(13,15,18,.32)' }}>—</div>
              <div className="form-stat-sub">No data</div>
            </div>
          </div>

          <div style={{ padding: '40px 40px 48px', fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(13,15,18,.55)', textAlign: 'center' }}>
            Training load curves need ~30 days of activity history before they read meaningfully.
            Keep logging runs — Strava is connected — and the chart will fill in here.
          </div>
        </div>

        {/* ── RECOVERY VITALS ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Recovery Vitals</div>
              <div className="card-sub">Daily readings from connected wearables</div>
            </div>
          </div>
          <div className="vitals-grid">
            <VitalTile label="Sleep"      value={sleep != null ? sleep.toFixed(1) : '—'} unit={sleep != null ? 'h' : ''}    range={['—','—']} markerPct={0} avgPct={0} status={sleep != null ? '7-day avg' : 'No data'} />
            <VitalTile label="Resting HR" value={rhr != null ? String(Math.round(rhr)) : '—'} unit={rhr != null ? 'bpm' : ''}    range={['—','—']} markerPct={0} avgPct={0} status={rhr != null ? '7-day avg' : 'No data'} />
            <VitalTile label="HRV"        value={hrv != null ? String(Math.round(hrv)) : '—'} unit={hrv != null ? 'ms' : ''}    range={['—','—']} markerPct={0} avgPct={0} status={hrv != null ? '7-day avg' : 'No data'} />
            <VitalTile label="Body Mass"  value="—" unit=""    range={['—','—']} markerPct={0} avgPct={0} status="No data" />
          </div>
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
