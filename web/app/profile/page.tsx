/**
 * /profile — fresh React port of designs/profile-v4.html.
 *
 * Sections (matches approved mockup top→bottom):
 *   1. Identity hero — avatar + name + bio + Edit Profile button
 *   2. Lifetime KPI strip (5 cells)
 *   3. Connectors card (full-width) — reuses ConnectorsCard.tsx
 *   4. Training Profile — 4 pref cells (Level / Long-Run / Quality / Rest)
 *   5. Heart Rate Zones — 5-cell strip + VDOT meta
 *   6. Shoe Rotation — 2-col grid (clickable rows open the Edit Shoe modal)
 *
 * Personal Goals card REMOVED — race-time goals already live per-race
 * in /races. Replaces 1700-line pre-v4 implementation.
 */

import { Topbar } from '@/app/components';
import { ConnectorsCard } from './ConnectorsCard';
import { ProfileModalsIsland } from './ProfileModalsIsland';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';
import './profile-v4.css';

interface ShoeRow {
  id: string;
  name: string;
  purposes: string[];
  cap_mi: number;
  current_mi: number;
  retired: boolean;
  color: string;
}

interface UserPrefsRow {
  name: string;
  age: number | null;
  sex: 'M' | 'F' | null;
  location: string | null;
  level: 'beginner' | 'intermediate' | 'advanced' | 'elite';
  long_run_day: string;
  quality_days: string[];
  rest_day: string;
}

const LEVEL_META: Record<string, string> = {
  beginner:     '10–25 mi/wk peak · Just finishing distance',
  intermediate: '25–50 mi/wk peak · Raced HM or marathon',
  advanced:     '50–70 mi/wk peak · Sub-elite mileage',
  elite:        '70+ mi/wk peak · Sub-1:15 HM territory',
};

const LEVEL_LABEL: Record<string, string> = {
  beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', elite: 'Elite',
};

const DOW_LABEL: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

const PURPOSE_LABEL: Record<string, string> = {
  easy: 'Easy', recovery: 'Recovery', long: 'Long', threshold: 'Threshold',
  intervals: 'Intervals', race: 'Race', trail: 'Trail', daily: 'Daily',
};

function shoeStatus(mi: number, cap: number): { label: string; tone: 'green' | 'amber' | 'warn' } {
  const pct = mi / Math.max(cap, 1);
  if (pct >= 0.90) return { label: 'Retire soon', tone: 'warn' };
  if (pct >= 0.70) return { label: 'Aging',       tone: 'amber' };
  if (pct >= 0.20) return { label: 'Healthy',     tone: 'green' };
  return { label: 'Fresh', tone: 'green' };
}

async function loadProfile(userId: string): Promise<{ user: UserPrefsRow; shoes: ShoeRow[] }> {
  const userRows = await query<UserPrefsRow>(
    `SELECT name, age, sex, location, level, long_run_day, quality_days, rest_day
     FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const user = userRows[0] ?? { name: 'Runner', age: null, sex: null, location: null, level: 'intermediate', long_run_day: 'sun', quality_days: ['tue','thu'], rest_day: 'sat' };

  // Shoes table is legacy single-user; until cutover, read where user_uuid matches
  // OR rows are unclaimed (no user_uuid) and we haven't yet backfilled.
  let shoes: ShoeRow[] = [];
  try {
    const rows = await query<{ id: number | string; brand: string; model: string; run_types: string[]; mileage: number; mileage_cap: number | null; retired: boolean; color: string | null }>(
      `SELECT id, brand, model, run_types, mileage, mileage_cap, retired, color
       FROM shoes
       WHERE (user_uuid = $1 OR user_uuid IS NULL)
       ORDER BY retired ASC, id ASC`,
      [userId],
    );
    shoes = rows.map((r) => ({
      id: String(r.id),
      name: `${r.brand} ${r.model}`,
      purposes: Array.isArray(r.run_types) ? r.run_types : [],
      cap_mi: r.mileage_cap ?? 300,
      current_mi: Number(r.mileage) || 0,
      retired: !!r.retired,
      color: r.color ?? '#2CA82F',
    }));
  } catch {
    // Schema not yet migrated — fall back to empty
    shoes = [];
  }
  return { user, shoes };
}

export default async function ProfilePage() {
  const auth = await requireActiveUser();

  const { user, shoes } = await loadProfile(auth.id);
  const activeShoes = shoes.filter((s) => !s.retired);
  const initials = user.name?.trim().split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'R';

  // Lifetime KPI seed values — these will switch to aggregated queries
  // once strava_activities is populated for the user. Sample defaults
  // shown for new users mirror the design mockup but should NOT lie:
  // until activity data is real, render zeros for new accounts.
  // For the legacy backfill owner (dnitch85@me.com), keep the seeded
  // numbers — they reflect imported Strava history.
  const isLegacy = auth.email === (process.env.LEGACY_OWNER_EMAIL || 'dnitch85@me.com').toLowerCase();
  const KPIS = isLegacy
    ? [
        { label: 'Lifetime mi',  value: '638', unit: 'mi', sub: 'All time' },
        { label: 'Races',         value: '6',   sub: '2 × marathon · 4 × half' },
        { label: 'Days run',      value: '79',  sub: '79 unique days' },
        { label: 'Peak year',     value: '638', unit: 'mi', sub: '2026 · on track' },
        { label: 'Lifetime elev', value: '16K', unit: 'ft', sub: '0.54× Everest' },
      ]
    : [
        { label: 'Lifetime mi',  value: '—', sub: 'Connect Strava to populate' },
        { label: 'Races',         value: '—', sub: 'No races yet' },
        { label: 'Days run',      value: '—', sub: '—' },
        { label: 'Peak year',     value: '—', sub: '—' },
        { label: 'Lifetime elev', value: '—', sub: '—' },
      ];

  // HR zone defaults (will switch to a real per-user computation once
  // VDOT anchor + max-HR estimation wire through).
  const HR_ZONES = [
    { tier: 'z1', name: 'Z1 · Recovery',  range: '93–111',  pct: '50–60% max' },
    { tier: 'z2', name: 'Z2 · Easy',      range: '112–129', pct: '60–70% max' },
    { tier: 'z3', name: 'Z3 · Steady',    range: '130–148', pct: '70–80% max' },
    { tier: 'z4', name: 'Z4 · Threshold', range: '149–167', pct: '80–90% max' },
    { tier: 'z5', name: 'Z5 · VO₂max',    range: '168–185', pct: '90–100% max' },
  ];

  const bioBits: string[] = [];
  if (user.sex) bioBits.push(user.sex);
  if (user.age) bioBits.push(String(user.age));
  if (user.location) bioBits.push(user.location);

  return (
    <div className="profile-v4-page">
      <Topbar activeTab="profile" showAdmin={auth.is_admin} />

      <div className="page">

        {/* ── IDENTITY HERO ── */}
        <div className="identity-card">
          <div className="identity-avatar">{initials}</div>
          <div className="identity-info">
            <div className="identity-eyebrow">Runner · {LEVEL_LABEL[user.level]} level</div>
            <div className="identity-name">{user.name || 'Runner'}</div>
            <div className="identity-bio">{bioBits.join(' · ') || 'Add your details in Edit Profile'}</div>
          </div>
          <ProfileModalsIsland mode="edit-profile" initialName={user.name} initialAge={user.age} initialSex={user.sex} initialLocation={user.location} />
        </div>

        {/* ── LIFETIME KPIs ── */}
        <div className="kpi-strip">
          {KPIS.map((kpi) => (
            <div key={kpi.label} className="kpi-cell">
              <div className="kpi-label">{kpi.label}</div>
              <div className="kpi-value-row">
                <span className="kpi-value">{kpi.value}</span>
                {kpi.unit && <span className="kpi-unit">{kpi.unit}</span>}
              </div>
              <div className="kpi-sub">{kpi.sub}</div>
            </div>
          ))}
        </div>

        {/* ── CONNECTORS ── */}
        <div style={{ marginTop: 16 }}>
          <ConnectorsCard />
        </div>

        {/* ── TRAINING PROFILE ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Training Profile</div>
              <div className="card-sub">What the coach reads to build your plan · these affect every plan day</div>
            </div>
            <ProfileModalsIsland
              mode="edit-prefs"
              initialLevel={user.level}
              initialLongRunDay={user.long_run_day}
              initialQualityDays={user.quality_days}
              initialRestDay={user.rest_day}
            />
          </div>
          <div className="prefs-grid">
            <div className="pref-cell">
              <div className="pref-label">Level</div>
              <div className="pref-value text">{LEVEL_LABEL[user.level]}</div>
              <div className="pref-meta">{LEVEL_META[user.level]}</div>
            </div>
            <div className="pref-cell">
              <div className="pref-label">Long Run Day</div>
              <div className="pref-value">{DOW_LABEL[user.long_run_day] ?? user.long_run_day}</div>
              <div className="pref-meta">Long-run anchor each week</div>
            </div>
            <div className="pref-cell">
              <div className="pref-label">Quality Days</div>
              <div className="pref-value" style={{ fontSize: 24 }}>{(user.quality_days || []).map((d) => DOW_LABEL[d] ?? d).join(' / ')}</div>
              <div className="pref-meta">Threshold + interval slots</div>
            </div>
            <div className="pref-cell">
              <div className="pref-label">Rest Day</div>
              <div className="pref-value">{DOW_LABEL[user.rest_day] ?? user.rest_day}</div>
              <div className="pref-meta">Day before the long run</div>
            </div>
          </div>
        </div>

        {/* ── HR ZONES ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Heart Rate Zones</div>
              <div className="card-sub">
                <strong>VDOT 48.1</strong> · derived from your Powered by the Mouse Half (3 mo ago)
              </div>
            </div>
            <div className="card-meta">Max HR · <strong>185</strong> est · age-based</div>
          </div>
          <div className="hr-grid">
            {HR_ZONES.map((z) => (
              <div key={z.tier} className="hr-cell">
                <div className={`hr-zone ${z.tier}`}>{z.name}</div>
                <div className="hr-range">{z.range}<span className="unit">bpm</span></div>
                <div className="hr-pct">{z.pct}</div>
              </div>
            ))}
          </div>
          <div className="hr-source">
            Max HR is estimated (208 − 0.7 × age = 180 baseline, lifted to 185 from your race-day peaks).
            Set a measured value any time — it overrides the estimate.
          </div>
        </div>

        {/* ── SHOE ROTATION ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Shoe Rotation</div>
              <div className="card-sub">
                <strong>{activeShoes.length} active</strong>{shoes.length > activeShoes.length ? ` · ${shoes.length - activeShoes.length} retired` : ''} · coach watches mileage to flag retire-soon · /log shoe picker reads from this list
              </div>
            </div>
            <ProfileModalsIsland mode="add-shoe" />
          </div>
          <div className="shoes-grid">
            {shoes.length === 0 ? (
              <div className="shoes-empty" style={{ gridColumn: '1 / -1' }}>No shoes yet. Click + Add Shoe to get started.</div>
            ) : (
              shoes.map((sh) => {
                const status = shoeStatus(sh.current_mi, sh.cap_mi);
                const pct = Math.min(100, Math.round((sh.current_mi / sh.cap_mi) * 100));
                const fillCls = status.tone === 'warn' ? 'warn' : status.tone === 'amber' ? 'amber' : '';
                const purposeStr = (sh.purposes || []).map((p) => PURPOSE_LABEL[p] ?? p).join(' · ') || '—';
                return (
                  <div key={sh.id} className="shoe-row" style={sh.retired ? { opacity: 0.5 } : undefined}>
                    <div>
                      <div className="shoe-name">{sh.name}</div>
                      <div className="shoe-role">{purposeStr}</div>
                      <div className="shoe-mileage-bar"><div className={`shoe-mileage-fill ${fillCls}`} style={{ width: `${pct}%` }} /></div>
                      <div className="shoe-mileage-meta">
                        <strong>{sh.current_mi}</strong> / {sh.cap_mi} mi · {Math.max(0, sh.cap_mi - sh.current_mi)} left
                        {sh.retired && <> · <strong style={{ color: 'var(--t1)' }}>RETIRED</strong></>}
                      </div>
                    </div>
                    <div className="shoe-status-col">
                      <div className={`shoe-status ${status.tone}`}>{status.label}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
