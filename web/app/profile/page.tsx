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
import { MaxHrIsland } from './MaxHrIsland';
import { RestingHrIsland } from './RestingHrIsland';
import { CoachReadsCard } from './CoachReadsCard';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { resolveEffectiveMaxHr } from '@/lib/compute-max-hr';
import { resolveFitness } from '@/lib/fitness-resolver';
import { validateMaxHr } from '@/lib/validate-max-hr';
import './profile-v4.css';

interface ShoeRow {
  id: string;
  name: string;
  brand: string;
  model: string;
  purposes: string[];
  cap_mi: number;
  current_mi: number;
  retired: boolean;
  preferred: boolean;
  notes: string | null;
  color: string;
  raw_color: string | null;
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
  accent_color: string | null;
}

const DEFAULT_ACCENT = '#E85D26';

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

// Shoe-purpose labels. 'recovery' rolls into 'easy' but we keep the
// legacy key so old shoe records still render.
const PURPOSE_LABEL: Record<string, string> = {
  easy: 'Easy', recovery: 'Easy', long: 'Long', threshold: 'Threshold',
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
    `SELECT name, age, sex, location, level, long_run_day, quality_days, rest_day, accent_color
     FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const user = userRows[0] ?? {
    name: 'Runner', age: null, sex: null, location: null,
    level: 'intermediate', long_run_day: 'sun', quality_days: ['tue','thu'], rest_day: 'sat',
    accent_color: null,
  };

  // Shoes table is legacy single-user; until cutover, read where user_uuid matches
  // OR rows are unclaimed (no user_uuid) and we haven't yet backfilled.
  let shoes: ShoeRow[] = [];
  try {
    const rows = await query<{ id: number | string; brand: string; model: string; run_types: string[]; mileage: number; mileage_cap: number | null; retired: boolean; color: string | null; preferred?: boolean; notes?: string | null }>(
      `SELECT id, brand, model, run_types, mileage, mileage_cap, retired, color, preferred, notes
       FROM shoes
       WHERE (user_uuid = $1 OR user_uuid IS NULL)
       ORDER BY retired ASC, id ASC`,
      [userId],
    );
    shoes = rows.map((r) => ({
      id: String(r.id),
      name: `${r.brand} ${r.model}`,
      brand: r.brand,
      model: r.model,
      purposes: Array.isArray(r.run_types) ? r.run_types : [],
      cap_mi: r.mileage_cap ?? 300,
      current_mi: Number(r.mileage) || 0,
      retired: !!r.retired,
      preferred: r.preferred ?? true,
      notes: r.notes ?? null,
      color: r.color ?? '#2CA82F',
      raw_color: r.color,
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

  // Resolve max HR (manual override → computed peak) so the zones
  // strip can show real bpm ranges, not "—". The MaxHrIsland below
  // hits the same API client-side for its provenance UI; we mirror
  // the value here for fast server render of the zone ranges.
  const resolvedMaxHr = await resolveEffectiveMaxHr(auth.id);
  const maxHr = resolvedMaxHr.value;

  // Resolve the full fitness bundle — same function every other page
  // calls. Surfacing it via CoachReadsCard lets the user verify the
  // whole app is reading from one coherent set of numbers.
  const today = new Date().toISOString().slice(0, 10);
  const fitness = await resolveFitness(auth.id, today);

  // Adaptive max-HR validation — passive scan + race-anchored LTHR
  // estimate. Verdict drives the Apply / Keep current banner inside
  // CoachReadsCard's Heart Rate section.
  const maxHrVerdict = await validateMaxHr(auth.id, fitness.maxHr.value);

  // Real lifetime KPIs computed from strava_activities. Until activity
  // data is present, every cell reads "No data" — no more seeded mockups.
  interface KpiRow {
    lifetime_mi: string | null;
    races: string | null;
    days_run: string | null;
    elev_ft: string | null;
    peak_year: string | null;
    peak_year_mi: string | null;
  }
  const kpiRows = await query<KpiRow>(
    `WITH acts AS (
      SELECT (data->>'distanceMi')::NUMERIC AS mi,
             COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day,
             LEFT(COALESCE(data->>'date', data->>'startLocal'), 4) AS yr,
             (data->>'elevGainFt')::NUMERIC AS elev,
             data->>'type' AS type
        FROM strava_activities
       WHERE user_uuid = $1 OR user_uuid IS NULL
    )
    SELECT
      COALESCE(SUM(mi), 0)::int::text AS lifetime_mi,
      COUNT(*) FILTER (WHERE LOWER(type) = 'race')::text AS races,
      COUNT(DISTINCT day)::text AS days_run,
      COALESCE(SUM(elev), 0)::int::text AS elev_ft,
      (SELECT yr  FROM acts WHERE yr IS NOT NULL GROUP BY yr ORDER BY SUM(mi) DESC LIMIT 1) AS peak_year,
      (SELECT SUM(mi)::int::text FROM acts WHERE yr IS NOT NULL GROUP BY yr ORDER BY SUM(mi) DESC LIMIT 1) AS peak_year_mi
    FROM acts`,
    [auth.id],
  );
  const k = kpiRows[0] ?? null;
  const lifetimeMi = k && parseInt(k.lifetime_mi ?? '0', 10) > 0 ? parseInt(k.lifetime_mi!, 10) : null;
  const racesCount = k && parseInt(k.races ?? '0', 10) > 0 ? parseInt(k.races!, 10) : null;
  const daysRun = k && parseInt(k.days_run ?? '0', 10) > 0 ? parseInt(k.days_run!, 10) : null;
  const elevFt = k && parseInt(k.elev_ft ?? '0', 10) > 0 ? parseInt(k.elev_ft!, 10) : null;
  const peakYear = k?.peak_year ?? null;
  const peakYearMi = k?.peak_year_mi ? parseInt(k.peak_year_mi, 10) : null;

  function fmtElev(ft: number): string {
    if (ft >= 1000) return `${(ft / 1000).toFixed(0)}K`;
    return String(ft);
  }

  const KPIS = [
    { label: 'Lifetime mi',  value: lifetimeMi !== null ? String(lifetimeMi) : '—',                  unit: lifetimeMi !== null ? 'mi' : undefined, sub: lifetimeMi !== null ? 'All time' : 'No data' },
    { label: 'Races',        value: racesCount !== null ? String(racesCount) : '—',                  sub: racesCount !== null ? 'From Strava history' : 'No data' },
    { label: 'Days run',     value: daysRun !== null    ? String(daysRun)    : '—',                  sub: daysRun !== null ? `${daysRun} unique days` : 'No data' },
    { label: 'Peak year',    value: peakYearMi !== null ? String(peakYearMi) : '—',                  unit: peakYearMi !== null ? 'mi' : undefined, sub: peakYear ? `${peakYear} · biggest year` : 'No data' },
    { label: 'Lifetime elev',value: elevFt !== null     ? fmtElev(elevFt)    : '—',                  unit: elevFt !== null ? 'ft' : undefined, sub: elevFt !== null ? `${(elevFt / 29032).toFixed(2)}× Everest` : 'No data' },
  ];

  // HR zones — populated from the user's resolved max HR. Daniels-style
  // %max bands: Z1 50-60, Z2 60-70, Z3 70-80, Z4 80-90, Z5 90-100.
  const zoneRange = (loPct: number, hiPct: number): string => {
    if (!maxHr) return '—';
    return `${Math.round(maxHr * loPct)}–${Math.round(maxHr * hiPct)}`;
  };
  const HR_ZONES = [
    { tier: 'z1', name: 'Z1 · Recovery',  range: zoneRange(0.50, 0.60), pct: '50–60% max' },
    { tier: 'z2', name: 'Z2 · Easy',      range: zoneRange(0.60, 0.70), pct: '60–70% max' },
    { tier: 'z3', name: 'Z3 · Steady',    range: zoneRange(0.70, 0.80), pct: '70–80% max' },
    { tier: 'z4', name: 'Z4 · Threshold', range: zoneRange(0.80, 0.90), pct: '80–90% max' },
    { tier: 'z5', name: 'Z5 · VO₂max',    range: zoneRange(0.90, 1.00), pct: '90–100% max' },
  ];

  const bioBits: string[] = [];
  if (user.sex) bioBits.push(user.sex);
  if (user.age) bioBits.push(String(user.age));
  if (user.location) bioBits.push(user.location);

  const currentAccent = user.accent_color ?? DEFAULT_ACCENT;

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

        {/* ── COACH READS (fitness resolver output) ── */}
        <div style={{ marginTop: 16 }}>
          <CoachReadsCard fitness={fitness} maxHrVerdict={maxHrVerdict} />
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

          {/* Brand accent — sits inside Training Profile so the
              personalization controls are co-located. The accent stamps
              --accent / --orange on <html> server-side, so the wordmark,
              buttons, and pins all pick it up on first paint. */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 20,
            alignItems: 'center', padding: '18px 40px 28px',
            borderTop: '1px solid rgba(13,15,18,.08)', marginTop: 4,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: currentAccent,
              border: '1px solid rgba(13,15,18,.08)',
              boxShadow: '0 4px 12px rgba(0,0,0,.08)',
            }} aria-hidden="true" />
            <div>
              <div style={{
                fontFamily: 'Inter, sans-serif', fontSize: 11, letterSpacing: '1.5px',
                color: 'rgba(13,15,18,.55)', textTransform: 'uppercase', fontWeight: 600,
              }}>Brand accent</div>
              <div style={{
                fontFamily: 'Inter, sans-serif', fontSize: 14, color: '#0D0F12',
                fontWeight: 600, marginTop: 4,
              }}>
                {user.accent_color
                  ? <>Custom · <span style={{ fontFamily: 'monospace', color: 'rgba(13,15,18,.55)', fontWeight: 500 }}>{currentAccent}</span></>
                  : <>Default · <span style={{ fontFamily: 'monospace', color: 'rgba(13,15,18,.55)', fontWeight: 500 }}>{currentAccent}</span></>}
              </div>
              <div style={{
                fontFamily: 'Inter, sans-serif', fontSize: 12,
                color: 'rgba(13,15,18,.45)', marginTop: 2,
              }}>Applied across buttons, pins, the wordmark gradient · stored on your account.</div>
            </div>
            <ProfileModalsIsland mode="edit-accent" initialAccent={user.accent_color} />
          </div>
        </div>

        {/* ── HR ZONES ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Heart Rate Zones</div>
              <div className="card-sub" style={{ color: 'rgba(13,15,18,.55)' }}>
                {maxHr
                  ? `Daniels %max bands · used for every HR read in your debriefs`
                  : 'No data — log your max HR + recent race to populate'}
              </div>
            </div>
            <div className="card-meta" style={{ color: maxHr ? '#0D0F12' : 'rgba(13,15,18,.45)' }}>
              Max HR · {maxHr ? <strong>{maxHr}</strong> : '—'}
            </div>
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
          <MaxHrIsland />
          <RestingHrIsland />
        </div>

        {/* ── SHOE ROTATION ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Shoe Rotation</div>
              <div className="card-sub">
                <strong>{activeShoes.length} active</strong>{shoes.length > activeShoes.length ? ` · ${shoes.length - activeShoes.length} retired` : ''} · coach watches mileage to flag retire-soon · /log shoe picker reads from this list · tap any shoe to edit
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
                // Reconstruct the Shoe row shape ProfileModalsIsland expects.
                // We could re-GET from the API, but the page already has
                // every field — pass it through directly to skip the round-trip.
                const shoeForModal = {
                  id: Number(sh.id),
                  brand: sh.brand,
                  model: sh.model,
                  color: sh.raw_color,
                  run_types: sh.purposes as never,
                  mileage: sh.current_mi,
                  mileage_cap: sh.cap_mi,
                  preferred: sh.preferred,
                  retired: sh.retired,
                  notes: sh.notes,
                  created_at: '',
                };
                return (
                  <ProfileModalsIsland
                    key={sh.id}
                    mode="edit-shoe"
                    triggerAs="wrap-children"
                    initialShoe={shoeForModal}
                  >
                    <div className="shoe-row" style={sh.retired ? { opacity: 0.5 } : undefined}>
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
                  </ProfileModalsIsland>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
