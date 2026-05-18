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

import { redirect } from 'next/navigation';
import { Topbar } from '@/app/components';
import { ConnectBannerIsland } from '../training/ConnectBannerIsland';
import { CheckInMiniIsland } from './CheckInMiniIsland';
import { getCurrentUser } from '@/lib/auth';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';
import './health-v4.css';

export default async function HealthPage() {
  const auth = await getCurrentUser();
  if (!auth) redirect('/login?next=/health');

  const today = todayISO(userTimezone(auth.location));
  const todayLabel = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();

  return (
    <div className="health-v4-page">
      <Topbar activeTab="health" />
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
              <strong>Fitness is climbing, fatigue has settled.</strong> The four-point lift over
              the last month puts you in a productive window — good place to start Build phase.
              Sleep and resting HR are clean. <strong>Watch:</strong> aerobic markers still
              rebuilding from Big Sur. Give threshold sessions another 10 days before pushing pace.
            </p>
          </div>
          <CheckInMiniIsland today={today} />
        </div>

        {/* ── HEALTH HERO ── */}
        <div className="health-hero">
          <div className="health-hero-left">
            <div className="health-hero-eyebrow">TODAY · {todayLabel} · HEALTH</div>
            <div className="health-hero-title">READY</div>
            <div className="brief-sections">
              <div className="brief-section">
                <div className="brief-section-label read">The Read</div>
                <p className="brief-section-body">
                  HRV climbing 4ms over the week, resting HR down 2 bpm, sleep duration 24 min above your baseline.
                  Three independent signals pointing the same direction — <strong>the body has cleared the marathon
                  and rebuilt past where it started</strong>. Quiet, real progress.
                </p>
              </div>
              <div className="brief-section">
                <div className="brief-section-label work">What&apos;s Working</div>
                <p className="brief-section-body">
                  Tuesday&apos;s threshold pushed strain to 14.2. By Friday it was back to 9 — dose, absorb, baseline,
                  inside 72 hours. That&apos;s the arc of a body that&apos;s <strong>adapting, not surviving</strong>.
                  Sleep is doing the heavy lifting here; protect it like part of the plan.
                </p>
              </div>
              <div className="brief-section">
                <div className="brief-section-label watch">The Watch</div>
                <p className="brief-section-body">
                  Tendons are day 12 of a 14–28 day window — <strong>Sunday&apos;s long sits at conversational pace
                  the whole way</strong>, no hot finish. Tempo paces this week will feel softer than memory says
                  they should. That&apos;s recovery, not a fitness regression. Don&apos;t push.
                </p>
              </div>
              <div className="brief-section">
                <div className="brief-section-label frame">The Frame</div>
                <p className="brief-section-body">
                  Build opens in 24 days with the first hard threshold session. Until then every Tuesday is
                  rehearsal — finding the rhythm so when the real work arrives, the body answers without
                  negotiation. <strong>Patience compounds. The fast pays for the patient.</strong>
                </p>
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
                  <circle cx="150" cy="150" r="130" fill="none" stroke="rgba(13,15,18,.08)" strokeWidth="16" strokeDasharray="612.61 204.20" strokeLinecap="round" transform="rotate(135 150 150)" />
                  <circle cx="150" cy="150" r="130" fill="none" stroke="var(--green)" strokeWidth="16" strokeDasharray="539.10 277.70" strokeLinecap="round" transform="rotate(135 150 150)" />
                  <text x="150" y="166" fontFamily="Bebas Neue" fontSize="96" fill="var(--t0)" textAnchor="middle">88</text>
                  <text x="150" y="188" fontFamily="Inter" fontSize="13" fontWeight="600" fill="rgba(13,15,18,.32)" textAnchor="middle" letterSpacing="1">/ 100</text>
                </svg>
              </div>
              <div className="health-hero-state">Building</div>
            </div>

            <div className="health-trend-rows">
              <HealthTrendRow label="Sleep 7d"   value="+0.4h"        tone="green" width={68} />
              <HealthTrendRow label="Resting HR" value="−2 bpm"       tone="green" width={55} />
              <HealthTrendRow label="HRV"        value="+4 ms"        tone="green" width={62} />
              <HealthTrendRow label="Strain 7d"  value="11.4 · Moderate" tone="amber" width={45} />
              <HealthTrendRow label="Check-In"   value="Not logged"   tone="dim"   width={0} />
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
            <Insight tone="green" icon="↑" title="Sleep is doing real work">
              7.4h avg over the last 7 days, +24min vs your 30-day baseline. Resting HR followed it down 2 bpm. This is the cleanest recovery window since Big Sur.
            </Insight>
            <Insight tone="amber" icon="!" title="Strain accumulated mid-week, recovered by Friday">
              Tuesday threshold pushed strain to 14.2. By Friday it was back to 9. Sleep covered it — that&apos;s the pattern you want. If strain stays elevated past 72h, that&apos;s the call to back off.
            </Insight>
            <Insight tone="blue" icon="i" title="Big Sur recovery — 2 systems still rebuilding">
              20 days in. Tendons need another ~8 days, aerobic markers ~14. Keep volume conservative and don&apos;t read soft tempo paces as a fitness drop — that&apos;s the body finishing the marathon. This insight clears when both systems are back.
            </Insight>
          </div>
        </div>

        {/* ── TRAINING LOAD (form curve) ── */}
        <div className="card form-curve-card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Training Load</div>
              <div className="card-sub">Last 90 days · fitness building, fatigue back to baseline · race markers shown</div>
            </div>
            <div className="card-meta"><strong style={{ color: 'var(--green)' }}>FRESH · ready to push</strong></div>
          </div>

          <div className="form-stats">
            <div className="form-stat">
              <div className="form-stat-label">Fitness</div>
              <div className="form-stat-val green">52</div>
              <div className="form-stat-sub">+4 vs 30 days ago · climbing</div>
            </div>
            <div className="form-stat">
              <div className="form-stat-label">Fatigue</div>
              <div className="form-stat-val orange">40</div>
              <div className="form-stat-sub">Back near baseline after Big Sur</div>
            </div>
            <div className="form-stat">
              <div className="form-stat-label">Form</div>
              <div className="form-stat-val green">+12</div>
              <div className="form-stat-sub">Productive zone · room to push</div>
            </div>
          </div>

          <div className="form-chart-wrap">
            <svg viewBox="0 0 1280 320" width="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
              <line x1="40"  y1="40"  x2="1200" y2="40"  stroke="rgba(13,15,18,.04)" strokeWidth="1" />
              <line x1="40"  y1="100" x2="1200" y2="100" stroke="rgba(13,15,18,.04)" strokeWidth="1" />
              <line x1="40"  y1="160" x2="1200" y2="160" stroke="rgba(13,15,18,.04)" strokeWidth="1" />
              <line x1="40"  y1="220" x2="1200" y2="220" stroke="rgba(13,15,18,.04)" strokeWidth="1" />
              <line x1="40"  y1="280" x2="1200" y2="280" stroke="rgba(13,15,18,.12)" strokeWidth="1" />
              <line x1="40"  y1="215" x2="1200" y2="215" stroke="rgba(232,93,38,.45)" strokeWidth="1.5" strokeDasharray="2,4" />
              <line x1="392" y1="36"  x2="392"  y2="280" stroke="rgba(232,93,38,.45)" strokeWidth="1" strokeDasharray="3,3" />
              <text x="392" y="28" fontFamily="Inter" fontSize="9" fill="var(--orange)" textAnchor="middle" fontWeight="700" letterSpacing="1">LA MARATHON</text>
              <line x1="939" y1="36"  x2="939"  y2="280" stroke="rgba(232,93,38,.45)" strokeWidth="1" strokeDasharray="3,3" />
              <text x="939" y="28" fontFamily="Inter" fontSize="9" fill="var(--orange)" textAnchor="middle" fontWeight="700" letterSpacing="1">BIG SUR</text>
              <polyline
                points="40,220 92,214 144,210 196,212 248,208 300,204 352,202 392,124 432,170 484,196 536,206 588,208 640,202 692,200 744,196 796,192 848,188 884,176 939,118 980,160 1032,184 1084,194 1136,198 1200,220"
                fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85"
              />
              <polyline
                points="40,166 144,164 248,162 352,158 456,154 560,150 664,146 768,140 872,136 976,134 1080,132 1200,124"
                fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              />
              <line x1="1200" y1="36" x2="1200" y2="280" stroke="var(--t0)" strokeWidth="2" />
              <text x="1196" y="28" fontFamily="Inter" fontSize="9" fill="var(--t0)" textAnchor="end" fontWeight="700" letterSpacing="1">TODAY</text>
              <circle cx="1200" cy="124" r="5" fill="var(--green)" stroke="white" strokeWidth="2" />
              <text x="1212" y="128" fontFamily="Inter" fontSize="12" fill="var(--green)" fontWeight="700">Fitness</text>
              <circle cx="1200" cy="220" r="5" fill="var(--orange)" stroke="white" strokeWidth="2" />
              <text x="1212" y="224" fontFamily="Inter" fontSize="12" fill="var(--orange)" fontWeight="700">Fatigue</text>
              <text x="40"   y="302" fontFamily="Inter" fontSize="10" fill="rgba(13,15,18,.4)">Feb 16</text>
              <text x="260"  y="302" fontFamily="Inter" fontSize="10" fill="rgba(13,15,18,.4)" textAnchor="middle">Mar 1</text>
              <text x="640"  y="302" fontFamily="Inter" fontSize="10" fill="rgba(13,15,18,.4)" textAnchor="middle">Apr 1</text>
              <text x="1020" y="302" fontFamily="Inter" fontSize="10" fill="rgba(13,15,18,.4)" textAnchor="middle">May 1</text>
              <text x="1200" y="302" fontFamily="Inter" fontSize="10" fill="var(--t0)" fontWeight="600" textAnchor="end">May 16</text>
            </svg>
          </div>

          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.55, color: 'var(--t1)', padding: '8px 40px 24px', fontStyle: 'italic' }}>
            Read it like this: <strong>green is fitness building over months</strong>, orange is
            fatigue reacting to hard sessions. The two race spikes show your body absorbed the
            effort and bounced back. Where green is above orange, you&apos;re fresh.
          </p>
        </div>

        {/* ── RECOVERY VITALS ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Recovery Vitals</div>
              <div className="card-sub">Last 30 days · daily readings from HealthKit + watch</div>
            </div>
          </div>
          <div className="vitals-grid">
            <VitalTile label="Sleep"      value="7.4"  unit="h"   range={['6.5h','8.2h']} markerPct={53} avgPct={29} status="+0.4h vs avg · 30d" />
            <VitalTile label="Resting HR" value="48"   unit="bpm" range={['46','52']}     markerPct={33} avgPct={67} status="−2 bpm vs avg · steady" />
            <VitalTile label="HRV"        value="62"   unit="ms"  range={['54','68']}     markerPct={57} avgPct={29} status="+4 ms vs avg · trending up" />
            <VitalTile label="Body Mass"  value="165"  unit="lb"  range={['163','167']}   markerPct={50} avgPct={50} status="At baseline" sample />
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
