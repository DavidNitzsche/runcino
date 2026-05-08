'use client';

import { useEffect, useRef, useState } from 'react';
import { Nav } from '../../components/nav';
import { Modal } from '../../components/modal';
import { HubProvider, useHub } from '../../lib/hub-provider';
import { MILEAGE_TIER_RECOVERY, mileageTier, type MileageTier } from '../../coach/doctrine';
import type { Shoe, RunType } from '../../lib/shoe-utils';
import { loadRunnerProfile, saveRunnerProfile, ageFromBirthDate, type RunnerProfile } from '../../lib/runner-profile';
// (RunnerSex import removed — sex options are inlined as a {male,female}
// literal type below since 'unspecified' is an internal default, not a UI option.)

const RUN_TYPE_LABELS: Record<RunType, string> = {
  race:       'Race',
  long:       'Long run',
  easy:       'Easy',
  recovery:   'Recovery',
  tempo:      'Tempo',
  intervals:  'Intervals',
  as_needed:  'As needed',
};

const ALL_RUN_TYPES: RunType[] = ['race', 'long', 'easy', 'recovery', 'tempo', 'intervals', 'as_needed'];

const MILEAGE_CAPS: Record<RunType, number> = {
  race: 300, long: 500, easy: 500, recovery: 400,
  tempo: 400, intervals: 400, as_needed: 500,
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_LONG_DAY = 'Sun';

// Page is a thin HubProvider wrapper around the inner content so the
// new TrainingTierSection can read the runner's weeklyAvg4w from the
// hub via useHub().
export default function ProfilePage() {
  return (
    <HubProvider>
      <ProfilePageInner />
    </HubProvider>
  );
}

function ProfilePageInner() {
  const [shoes, setShoes]       = useState<Shoe[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editingShoe, setEditingShoe] = useState<Shoe | null>(null);
  const [addingShoe, setAddingShoe]   = useState(false);
  const [longDay, setLongDay]   = useState(DEFAULT_LONG_DAY);

  useEffect(() => {
    fetch('/api/shoes')
      .then(r => r.json())
      .then(d => { setShoes(d.shoes ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function toggleRetired(shoe: Shoe) {
    const res = await fetch(`/api/shoes/${shoe.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ retired: !shoe.retired }),
    });
    const d = await res.json();
    setShoes(s => s.map(x => x.id === shoe.id ? d.shoe : x));
  }

  async function saveShoe(id: number, patch: Partial<Shoe>) {
    const res = await fetch(`/api/shoes/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const d = await res.json();
    setShoes(s => s.map(x => x.id === id ? d.shoe : x));
    setEditingShoe(null);
  }

  async function addShoe(input: { brand: string; model: string; color: string; run_types: RunType[]; mileage: number; mileage_cap: number; preferred: boolean; notes: string }) {
    const res = await fetch('/api/shoes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const d = await res.json();
    setShoes(s => [...s, d.shoe]);
    setAddingShoe(false);
  }

  const active  = shoes.filter(s => !s.retired);
  const retired = shoes.filter(s => s.retired);

  return (
    <div className="stage">
      <Nav active="profile" />
      <div className="body">

        <div className="page-head" style={{ marginBottom: 32 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>ATHLETE PROFILE</div>
            <h1 style={{ fontSize: 48, letterSpacing: '-0.03em' }}>Profile</h1>
          </div>
        </div>

        {/* ── Runner profile (age + sex for VDOT grading) ───────── */}
        <RunnerProfileSection />

        {/* ── Training tier (mileage-history-aware recovery
             calibration; doctrine MILEAGE_TIER_RECOVERY) ────────── */}
        <TrainingTierSection />

        {/* ── Training preferences ──────────────────────────────── */}
        <section style={{ marginBottom: 40 }}>
          <div className="tile-sub" style={{ marginBottom: 16 }}>TRAINING SCHEDULE</div>
          <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 10, fontWeight: 500 }}>
                Long run day
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {DAYS.map(d => (
                  <button
                    key={d}
                    onClick={() => setLongDay(d)}
                    style={{
                      padding: '7px 12px', borderRadius: 8, border: '1px solid', cursor: 'pointer',
                      borderColor: longDay === d ? 'var(--color-attention)' : 'var(--color-l4)',
                      background: longDay === d ? 'var(--color-attention)' : 'transparent',
                      color: longDay === d ? 'var(--color-l0)' : 'var(--color-t2)',
                      fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-t3)', paddingTop: 4, borderTop: '1px solid var(--color-l4)' }}>
              Long run anchors the week. Coach fills remaining days as training load requires.
            </div>
          </div>
        </section>

        {/* ── Shoe Closet ──────────────────────────────────────── */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div className="tile-sub">SHOE CLOSET</div>
            <button
              className="btn btn--primary"
              style={{ padding: '8px 16px', fontSize: 12 }}
              onClick={() => setAddingShoe(true)}
            >
              + Add shoe
            </button>
          </div>

          {loading && (
            <div style={{ color: 'var(--color-t3)', fontSize: 13, padding: '24px 0' }}>Loading closet…</div>
          )}

          {active.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
              {active.map(shoe => (
                <ShoeCard
                  key={shoe.id}
                  shoe={shoe}
                  onEdit={() => setEditingShoe(shoe)}
                  onToggleRetired={() => toggleRetired(shoe)}
                />
              ))}
            </div>
          )}

          {retired.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div className="tile-sub" style={{ marginBottom: 12, opacity: 0.6 }}>RETIRED</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {retired.map(shoe => (
                  <ShoeCard
                    key={shoe.id}
                    shoe={shoe}
                    retired
                    onEdit={() => setEditingShoe(shoe)}
                    onToggleRetired={() => toggleRetired(shoe)}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ── Modals ───────────────────────────────────────────────── */}
      {addingShoe && (
        <Modal title="New shoe" onClose={() => setAddingShoe(false)}>
          <ShoeForm
            onSave={data => addShoe(data)}
            onCancel={() => setAddingShoe(false)}
            submitLabel="Add to closet"
          />
        </Modal>
      )}

      {editingShoe && (
        <Modal title={`${editingShoe.brand} ${editingShoe.model}`} onClose={() => setEditingShoe(null)}>
          <ShoeForm
            initial={editingShoe}
            onSave={data => saveShoe(editingShoe.id, data)}
            onCancel={() => setEditingShoe(null)}
            submitLabel="Save changes"
          />
        </Modal>
      )}
    </div>
  );
}

// ── Shoe card ─────────────────────────────────────────────────────────────────

function ShoeCard({
  shoe, retired = false, onEdit, onToggleRetired,
}: {
  shoe: Shoe; retired?: boolean; onEdit: () => void; onToggleRetired: () => void;
}) {
  const cap     = shoe.mileage_cap ?? 500;
  const pct     = Math.min(100, (shoe.mileage / cap) * 100);
  const warning = pct >= 80 && pct < 100;
  const over    = pct >= 100;
  const barClr  = over ? 'var(--color-race)' : warning ? 'var(--color-warn)' : 'var(--color-success)';

  return (
    <div className="tile" style={{ opacity: retired ? 0.55 : 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <div className="tile-sub">{shoe.brand.toUpperCase()}</div>
            {shoe.preferred && !retired && (
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '1px',
                padding: '2px 6px', borderRadius: 3,
                background: 'rgba(62,189,65,0.12)', color: 'var(--color-success)',
                textTransform: 'uppercase',
              }}>IN ROTATION</span>
            )}
          </div>
          <div className="tile-lbl" style={{ fontSize: 18, marginTop: 2 }}>{shoe.model}</div>
          {shoe.color && (
            <div style={{ fontSize: 12, color: 'var(--color-t3)', marginTop: 2 }}>{shoe.color}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={onEdit} style={{ ...iconBtnStyle, width: 'auto', padding: '0 10px', fontSize: 11, fontWeight: 600, color: 'var(--color-t2)', letterSpacing: '0.02em' }}>Edit</button>
          <button onClick={onToggleRetired} title={retired ? 'Restore' : 'Retire'} style={iconBtnStyle}>
            {retired ? '↩' : '✕'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {shoe.run_types.map(t => (
          <span key={t} style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: 'var(--color-l3)', color: 'var(--color-t1)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            {RUN_TYPE_LABELS[t]}
          </span>
        ))}
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-t3)', marginBottom: 4 }}>
          <span>{shoe.mileage.toFixed(0)} mi</span>
          <span style={{ color: over ? 'var(--color-race)' : warning ? 'var(--color-warn)' : undefined }}>
            {over ? '⚠ Retire — ' : warning ? '⚠ ' : ''}{cap} mi cap
          </span>
        </div>
        <div style={{ height: 4, background: 'var(--color-l3)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barClr, borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
      </div>

      {shoe.notes && (
        <div style={{ fontSize: 12, color: 'var(--color-t3)', borderTop: '1px solid var(--color-l4)', paddingTop: 8 }}>
          {shoe.notes}
        </div>
      )}
    </div>
  );
}

// ── Shoe mileage cap lookup ───────────────────────────────────────────────────

const SHOE_CAPS: Array<{ match: RegExp; cap: number }> = [
  // Carbon-plate racers (200–300 mi)
  { match: /alphafly|vaporfly|dragonfly|adizero adios pro|metaspeed (sky|edge)|sc pacer|supercomp pacer|endorphin pro|mach x|pk/i, cap: 250 },
  { match: /sc trainer|sc elite|rc elite|zoomx streakfly/i, cap: 300 },
  // Plush daily / long-run trainers (450–500 mi)
  { match: /superblast|bondi|clifton|ghost|vomero|invincible|nimbus|cumulus|gel-nimbus|gel-kayano/i, cap: 500 },
  // Versatile tempo / daily (400 mi)
  { match: /zoom fly|novablast|endorphin speed|adizero boston|launch|kinvara|glide|freedom|guide/i, cap: 400 },
  // Recovery / plush (400–450 mi)
  { match: /recover|recharge|relief|jog|walk|carbon x|arahi|kayano/i, cap: 450 },
];

function suggestCap(brand: string, model: string, runTypes: RunType[]): number {
  const key = `${brand} ${model}`;
  for (const entry of SHOE_CAPS) {
    if (entry.match.test(key)) return entry.cap;
  }
  return runTypes.length > 0 ? MILEAGE_CAPS[runTypes[0]] : 400;
}

// ── Shared shoe form (add + edit) ─────────────────────────────────────────────

function ShoeForm({
  initial,
  onSave,
  onCancel,
  submitLabel,
}: {
  initial?: Shoe;
  onSave: (data: { brand: string; model: string; color: string; run_types: RunType[]; mileage: number; mileage_cap: number; preferred: boolean; notes: string }) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [brand,     setBrand]     = useState(initial?.brand ?? '');
  const [model,     setModel]     = useState(initial?.model ?? '');
  const [color,     setColor]     = useState(initial?.color ?? '');
  const [types,     setTypes]     = useState<RunType[]>(initial?.run_types ?? []);
  const [mileage,   setMileage]   = useState(String(initial?.mileage ?? 0));
  const [cap,       setCap]       = useState(String(initial?.mileage_cap ?? ''));
  const [capSource, setCapSource] = useState<'auto' | 'manual'>(initial?.mileage_cap ? 'manual' : 'auto');
  const [preferred, setPreferred] = useState(initial?.preferred ?? true);
  const [notes,     setNotes]     = useState(initial?.notes ?? '');
  const brandRef = useRef(brand);
  const modelRef = useRef(model);
  brandRef.current = brand;
  modelRef.current = model;

  useEffect(() => {
    if (capSource === 'manual') return;
    const suggested = suggestCap(brand, model, types);
    setCap(String(suggested));
  }, [brand, model, types, capSource]);

  const toggleType = (t: RunType) =>
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const suggestedCap = suggestCap(brand, model, types);
  const canSubmit = brand.trim() && model.trim() && types.length > 0;
  const resolvedCap = cap ? parseFloat(cap) : suggestedCap;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div className="runcino-label">Brand</div>
          <input className="runcino-input" value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Nike" />
        </div>
        <div>
          <div className="runcino-label">Model</div>
          <input className="runcino-input" value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. Vaporfly 3" />
        </div>
      </div>

      <div>
        <div className="runcino-label">Color</div>
        <input className="runcino-input" value={color} onChange={e => setColor(e.target.value)} placeholder="e.g. Black / White" />
      </div>

      <div>
        <div className="runcino-label">Run types</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {ALL_RUN_TYPES.map(t => {
            const on = types.includes(t);
            return (
              <button key={t} onClick={() => toggleType(t)} style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: '1px solid', cursor: 'pointer', fontFamily: 'inherit',
                borderColor: on ? 'var(--color-attention)' : 'var(--color-l4)',
                background: on ? 'var(--color-attention)' : 'transparent',
                color: on ? 'var(--color-l0)' : 'var(--color-t2)',
                textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                {RUN_TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div className="runcino-label">Current mileage</div>
          <input className="runcino-input" type="number" min="0" value={mileage}
            onChange={e => setMileage(e.target.value)} placeholder="0" />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
            <div className="runcino-label" style={{ marginBottom: 0 }}>Mileage cap</div>
            {capSource === 'auto' && cap && (
              <span style={{ fontSize: 10, color: 'var(--color-recovery)', fontFamily: 'var(--font-data)', letterSpacing: '0.5px' }}>AUTO</span>
            )}
            {capSource === 'manual' && (
              <button onClick={() => setCapSource('auto')} style={{
                fontSize: 10, color: 'var(--color-t3)', background: 'none', border: 'none',
                cursor: 'pointer', padding: 0, fontFamily: 'var(--font-data)', letterSpacing: '0.5px',
              }}>reset</button>
            )}
          </div>
          <input className="runcino-input" type="number" min="0" value={cap}
            onChange={e => { setCap(e.target.value); setCapSource('manual'); }}
            placeholder={String(suggestedCap)} />
        </div>
      </div>

      <div>
        <div className="runcino-label">Notes</div>
        <input className="runcino-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
      </div>

      {/* Preferred rotation toggle */}
      <button
        onClick={() => setPreferred(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', borderRadius: 10,
          border: '1px solid',
          borderColor: preferred ? 'var(--color-success)' : 'var(--color-l4)',
          background: preferred ? 'rgba(62,189,65,0.08)' : 'transparent',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
        }}
      >
        <div style={{
          width: 20, height: 20, borderRadius: 5, border: '1.5px solid',
          borderColor: preferred ? 'var(--color-success)' : 'var(--color-l4)',
          background: preferred ? 'var(--color-success)' : 'transparent',
          display: 'grid', placeItems: 'center', flexShrink: 0,
          color: '#fff', fontSize: 12, fontWeight: 700,
        }}>
          {preferred ? '✓' : ''}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: preferred ? 'var(--color-success)' : 'var(--color-t2)' }}>
            In active rotation
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 2 }}>
            Coach assigns this shoe to runs automatically
          </div>
        </div>
      </button>

      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          className="btn btn--primary"
          style={{ flex: 1 }}
          disabled={!canSubmit}
          onClick={() => onSave({
            brand: brand.trim(),
            model: model.trim(),
            color: color.trim(),
            run_types: types,
            mileage: parseFloat(mileage) || 0,
            mileage_cap: resolvedCap,
            preferred,
            notes: notes.trim(),
          })}
        >
          {submitLabel}
        </button>
        <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  border: '1px solid var(--color-l4)',
  background: 'transparent', color: 'var(--color-t3)',
  fontSize: 12, cursor: 'pointer', display: 'grid', placeItems: 'center',
  fontFamily: 'inherit',
};

/* ── Training tier section ───────────────────────────────────
   Surfaces the runner's mileage tier (low / mid / high / elite)
   derived from their 4-week rolling weekly average. The tier
   drives recovery calibration across the engine — rest-day
   count, post-marathon return weeks, recovery-jog floor,
   heavy-block volume reduction. Doctrine: MILEAGE_TIER_RECOVERY
   (Research/00b §Recovery Scaled to Weekly Mileage). Read-only;
   the tier auto-tracks weeklyAvg4w from real activities. */
function TrainingTierSection() {
  const hub = useHub();
  if (hub === null) {
    return (
      <section style={{ marginBottom: 40 }}>
        <div className="tile-sub" style={{ marginBottom: 16 }}>TRAINING TIER</div>
        <div className="tile" style={{ minHeight: 120, opacity: 0.4 }}>Loading…</div>
      </section>
    );
  }
  const weeklyAvg4w = hub.coach.state.volume.weeklyAvg4w;
  const weeklyAvg8w = hub.coach.state.volume.weeklyAvg8w;
  const tier: MileageTier = mileageTier(weeklyAvg4w);
  const data = MILEAGE_TIER_RECOVERY.value[tier];
  const tierColor: Record<MileageTier, string> = {
    low: 'var(--color-t1)',
    mid: 'var(--color-corporate)',
    high: 'var(--color-attention)',
    elite: 'var(--color-warning)',
  };
  const TIERS: Array<{ key: MileageTier; label: string }> = [
    { key: 'low',   label: '20-40' },
    { key: 'mid',   label: '40-60' },
    { key: 'high',  label: '60-80' },
    { key: 'elite', label: '80+' },
  ];
  // Position inside the band (0-1) so the indicator dot lands at the
  // right horizontal slot when rendered. Uses weeklyAvg4w clamped to
  // [10, 100] so the strip stays meaningful across the spectrum.
  const stripPos = (() => {
    const v = Math.max(10, Math.min(100, weeklyAvg4w));
    return ((v - 10) / 90) * 100;  // percentage along the strip
  })();
  return (
    <section style={{ marginBottom: 40 }}>
      <div className="tile-sub" style={{ marginBottom: 16 }}>TRAINING TIER</div>
      <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36,
              letterSpacing: '-.02em', lineHeight: 1, color: tierColor[tier],
              textTransform: 'uppercase',
            }}>
              {tier}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', marginTop: 4 }}>
              {data.label} band · you're at <strong style={{ color: 'var(--color-t0)' }}>{Math.round(weeklyAvg4w)} mi/wk</strong> (4-week avg)
            </div>
          </div>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--color-t3)', textAlign: 'right' }}>
            8w baseline: {Math.round(weeklyAvg8w)} mi/wk
          </div>
        </div>

        {/* Tier strip — visualizes where the runner sits across the
            full spectrum, with the dot at their actual avg. */}
        <div>
          <div style={{ position: 'relative', height: 8, background: 'var(--color-l3)', borderRadius: 4, marginTop: 4 }}>
            <div style={{
              position: 'absolute', top: -3, left: `calc(${stripPos}% - 7px)`, width: 14, height: 14,
              borderRadius: 7, background: tierColor[tier], border: '2px solid var(--color-l0)',
              boxShadow: '0 0 0 1px var(--color-l4)',
            }} />
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', marginTop: 6,
            fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700,
            color: 'var(--color-t3)', letterSpacing: '0.06em',
          }}>
            {TIERS.map(t => (
              <span key={t.key} style={{ color: t.key === tier ? tierColor[tier] : undefined }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {/* Calibration grid — shows what the tier adjusts. */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14,
          paddingTop: 12, borderTop: '1px solid var(--color-l4)',
        }}>
          <TierStat
            label="Rest days/wk"
            value={data.restDaysPerWeekLow === data.restDaysPerWeekHigh ? `${data.restDaysPerWeekLow}` : `${data.restDaysPerWeekLow}-${data.restDaysPerWeekHigh}`}
          />
          <TierStat
            label="Cutback every"
            value={data.cutbackEveryWeeksLow === data.cutbackEveryWeeksHigh ? `${data.cutbackEveryWeeksLow}w` : `${data.cutbackEveryWeeksLow}-${data.cutbackEveryWeeksHigh}w`}
          />
          <TierStat
            label="Post-marathon"
            value={`${data.postMarathonReturnWeeksLow}-${data.postMarathonReturnWeeksHigh}w`}
          />
          <TierStat
            label="Sleep target"
            value={`${data.sleepHoursLow}-${data.sleepHoursHigh}h`}
          />
        </div>

        <div style={{ fontSize: 11, color: 'var(--color-t3)', paddingTop: 8, borderTop: '1px solid var(--color-l4)', lineHeight: 1.55 }}>
          Tier auto-tracks your 4-week rolling weekly mileage. Drives recovery posture across the app:
          rest-day count, cutback cadence, post-race stage gates, recovery-jog floor, and heavy-block volume reduction.
          {data.shakeoutReplacesRest ? ' At your tier, full rest is typically replaced by a 30-min shake-out.' : ''}
        </div>
      </div>
    </section>
  );
}

function TierStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--color-t3)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--color-t0)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

/* ── Runner profile section ──────────────────────────────────
   Birth year + sex + HRmax + RHR for VDOT age/sex grading
   (Research/24) and HR-zone derivation (Research/03). Server-side
   Postgres-backed — cross-device synced, visible to the coach
   engine. Auto-saves on change so there's no Save button.
   Migrates any pre-existing localStorage profile on first load. */
function RunnerProfileSection() {
  const [profile, setProfile] = useState<RunnerProfile>({
    birthDate: null, sex: 'unspecified', hrmaxBpm: null, rhrBpm: null,
    healthFlags: null, gpsWatchModel: null, kitNotes: null,
    lastPeriodDate: null, cyclePhase: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadRunnerProfile();
      if (!cancelled) setProfile(loaded);
    })();
    return () => { cancelled = true; };
  }, []);

  function update(patch: Partial<RunnerProfile>) {
    const next = { ...profile, ...patch };
    setProfile(next);
    setError(null);
    setSaving(true);
    saveRunnerProfile(next)
      .then(saved => setProfile(saved))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  }

  const age = ageFromBirthDate(profile.birthDate);
  const SEX_OPTIONS: Array<{ value: 'male' | 'female'; label: string }> = [
    { value: 'male',   label: 'Male' },
    { value: 'female', label: 'Female' },
  ];
  // Today's ISO date — caps the birth-date picker so the runner
  // can't pick a future birthday.
  const todayISOStr = new Date().toISOString().slice(0, 10);

  return (
    <section style={{ marginBottom: 40 }}>
      <div className="tile-sub" style={{ marginBottom: 16 }}>RUNNER PROFILE</div>
      <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 8, fontWeight: 500 }}>
              Birthday
            </div>
            <input
              type="date"
              value={profile.birthDate ?? ''}
              onChange={e => update({ birthDate: e.target.value === '' ? null : e.target.value })}
              max={todayISOStr}
              min="1900-01-01"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--color-l4)', background: 'var(--color-l2)',
                color: 'var(--color-t0)', fontFamily: 'var(--font-data)', fontSize: 14,
                fontVariantNumeric: 'tabular-nums', fontWeight: 700,
              }}
            />
            {age != null && (
              <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 4 }}>
                Age {age}
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 8, fontWeight: 500 }}>
              Sex
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {SEX_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => update({ sex: opt.value })}
                  style={{
                    padding: '7px 14px', borderRadius: 8, border: '1px solid', cursor: 'pointer',
                    borderColor: profile.sex === opt.value ? 'var(--color-corporate)' : 'var(--color-l4)',
                    background: profile.sex === opt.value ? 'rgba(38,127,255,.18)' : 'transparent',
                    color: profile.sex === opt.value ? 'var(--color-corporate)' : 'var(--color-t2)',
                    fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 8, fontWeight: 500 }}>
              Max heart rate <span style={{ color: 'var(--color-t3)', fontWeight: 400 }}>(BPM, optional)</span>
            </div>
            <input
              type="number"
              value={profile.hrmaxBpm ?? ''}
              onChange={e => update({ hrmaxBpm: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="e.g. 188"
              min={130}
              max={230}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--color-l4)', background: 'var(--color-l2)',
                color: 'var(--color-t0)', fontFamily: 'var(--font-data)', fontSize: 14,
                fontVariantNumeric: 'tabular-nums', fontWeight: 700,
              }}
            />
            <div style={{ fontSize: 10.5, color: 'var(--color-t3)', marginTop: 4 }}>
              Lab or field test if known. Otherwise estimated from age (Tanaka).
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 8, fontWeight: 500 }}>
              Resting heart rate <span style={{ color: 'var(--color-t3)', fontWeight: 400 }}>(BPM, optional)</span>
            </div>
            <input
              type="number"
              value={profile.rhrBpm ?? ''}
              onChange={e => update({ rhrBpm: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="e.g. 48"
              min={30}
              max={100}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--color-l4)', background: 'var(--color-l2)',
                color: 'var(--color-t0)', fontFamily: 'var(--font-data)', fontSize: 14,
                fontVariantNumeric: 'tabular-nums', fontWeight: 700,
              }}
            />
            <div style={{ fontSize: 10.5, color: 'var(--color-t3)', marginTop: 4 }}>
              For Karvonen / HR-reserve zones. Optional.
            </div>
          </div>
        </div>
        {/* Health flags — free text the coach should remember. Injuries,
            conditions, recent illness, cycle notes, anything else. The
            engine doesn't parse this yet but it's available context for
            LLM-driven brief generation, and a place for the runner to
            keep a personal medical-coaching log. */}
        <div style={{ paddingTop: 8 }}>
          <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 8, fontWeight: 500 }}>
            Health flags <span style={{ color: 'var(--color-t3)', fontWeight: 400 }}>(notes, optional)</span>
          </div>
          <textarea
            value={profile.healthFlags ?? ''}
            onChange={e => update({ healthFlags: e.target.value })}
            placeholder="e.g. Right Achilles tightness Mar–Apr; cleared. Allergies May–Jun. Iron supplement starting Aug 2026."
            rows={4}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 6,
              border: '1px solid var(--color-l4)', background: 'var(--color-l2)',
              color: 'var(--color-t0)', fontFamily: 'var(--font-body, system-ui)', fontSize: 13,
              lineHeight: 1.5, resize: 'vertical', minHeight: 80,
            }}
          />
          <div style={{ fontSize: 10.5, color: 'var(--color-t3)', marginTop: 4 }}>
            Injuries, conditions, recent illness, cycle notes, supplements — anything you want the coach to keep in mind. Up to ~1KB.
          </div>
        </div>

        {/* Equipment — GPS watch model + kit notes. Free text. */}
        <div style={{ paddingTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 8, fontWeight: 500 }}>
              GPS watch / device <span style={{ color: 'var(--color-t3)', fontWeight: 400 }}>(model)</span>
            </div>
            <input
              type="text"
              value={profile.gpsWatchModel ?? ''}
              onChange={e => update({ gpsWatchModel: e.target.value === '' ? null : e.target.value })}
              placeholder="e.g. Garmin Forerunner 965, Apple Watch Ultra 2, COROS Pace 3"
              maxLength={200}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--color-l4)', background: 'var(--color-l2)',
                color: 'var(--color-t0)', fontFamily: 'var(--font-body, system-ui)', fontSize: 13,
              }}
            />
            <div style={{ fontSize: 10.5, color: 'var(--color-t3)', marginTop: 4 }}>
              Lets the coach reference your actual gear in briefs.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 8, fontWeight: 500 }}>
              Kit notes <span style={{ color: 'var(--color-t3)', fontWeight: 400 }}>(optional)</span>
            </div>
            <input
              type="text"
              value={profile.kitNotes ?? ''}
              onChange={e => update({ kitNotes: e.target.value === '' ? null : e.target.value })}
              placeholder="e.g. Tend toward Maurten 100s, hate caffeine after mile 18"
              maxLength={500}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--color-l4)', background: 'var(--color-l2)',
                color: 'var(--color-t0)', fontFamily: 'var(--font-body, system-ui)', fontSize: 13,
              }}
            />
            <div style={{ fontSize: 10.5, color: 'var(--color-t3)', marginTop: 4 }}>
              Fueling preferences, brand notes, anything else.
            </div>
          </div>
        </div>

        {/* Cycle tracking — only shown when sex='female'. Self-reported
            phase + last-period date so the coach has cycle context for
            future cycle-aware adjustments. */}
        {profile.sex === 'female' && (
          <div style={{
            paddingTop: 14, marginTop: 14, borderTop: '1px solid var(--color-l4)',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.4px', color: 'var(--color-attention)', fontWeight: 700, textTransform: 'uppercase' }}>
              Cycle tracking
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-t2)', lineHeight: 1.5 }}>
              Optional. Cycle phase affects training response (luteal-phase heat sensitivity, follicular-phase strength gains, etc.). Leave blank if you don&apos;t want to track here.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 8, fontWeight: 500 }}>
                  Last period start
                </div>
                <input
                  type="date"
                  value={profile.lastPeriodDate ?? ''}
                  onChange={e => update({ lastPeriodDate: e.target.value === '' ? null : e.target.value })}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    border: '1px solid var(--color-l4)', background: 'var(--color-l2)',
                    color: 'var(--color-t0)', fontFamily: 'var(--font-data)', fontSize: 13,
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 8, fontWeight: 500 }}>
                  Current phase
                </div>
                <select
                  value={profile.cyclePhase ?? ''}
                  onChange={e => update({ cyclePhase: (e.target.value || null) as typeof profile.cyclePhase })}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    border: '1px solid var(--color-l4)', background: 'var(--color-l2)',
                    color: 'var(--color-t0)', fontFamily: 'var(--font-body, system-ui)', fontSize: 13,
                  }}
                >
                  <option value="">— self-report —</option>
                  <option value="menstruation">Menstruation</option>
                  <option value="follicular">Follicular</option>
                  <option value="ovulation">Ovulation</option>
                  <option value="luteal">Luteal</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Connections — Strava is the live one. Garmin/HealthKit are
            future. Click-through to the Strava connect flow. */}
        <ConnectionsRow />

        <div style={{ fontSize: 11, color: 'var(--color-t3)', paddingTop: 4, borderTop: '1px solid var(--color-l4)', lineHeight: 1.5 }}>
          Used to compute age-graded VDOT, sex-cohort tier framing, and HR zone targets on the dashboard.
          All fields optional — leave blank for open-class / age-estimated zones. Synced across devices. {saving && <span style={{ color: 'var(--color-corporate)', fontWeight: 700 }}>· Saving…</span>}{error && <span style={{ color: 'var(--color-warning)', fontWeight: 700 }}>· {error}</span>}
        </div>
      </div>
    </section>
  );
}

/* ── Connections row ─────────────────────────────────────────
   Surfaces what's connected vs not. Strava is currently the only
   live integration; HealthKit + Garmin are planned. The runner sees
   their integration status in one row instead of having to find
   the Strava connect page in the docs. */
function ConnectionsRow() {
  const [stravaConnected, setStravaConnected] = useState<boolean | null>(null);

  useEffect(() => {
    // Probe whether Strava tokens are present server-side. The
    // /api/strava/sync endpoint returns a payload when connected,
    // an error code when not — we just need a yes/no.
    fetch('/api/strava/activities?limit=1')
      .then(r => r.json())
      .then((d: { activities?: unknown[]; error?: string }) => {
        setStravaConnected(Array.isArray(d.activities));
      })
      .catch(() => setStravaConnected(false));
  }, []);

  return (
    <div style={{
      paddingTop: 14, marginTop: 14, borderTop: '1px solid var(--color-l4)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.4px', color: 'var(--color-corporate)', fontWeight: 700, textTransform: 'uppercase' }}>
        Connections
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        <ConnectionPill
          name="Strava"
          status={stravaConnected === null ? 'checking' : stravaConnected ? 'connected' : 'disconnected'}
          actionHref={stravaConnected ? null : '/api/strava/connect'}
          actionLabel={stravaConnected ? null : 'Connect'}
        />
        <ConnectionPill name="HealthKit" status="planned" sub="iOS app · M2" />
        <ConnectionPill name="Garmin" status="planned" sub="future" />
      </div>
    </div>
  );
}

function ConnectionPill({ name, status, sub, actionHref, actionLabel }: {
  name: string;
  status: 'connected' | 'disconnected' | 'checking' | 'planned';
  sub?: string;
  actionHref?: string | null;
  actionLabel?: string | null;
}) {
  const color = status === 'connected' ? 'var(--color-success)'
              : status === 'disconnected' ? 'var(--color-attention)'
              : status === 'planned' ? 'var(--color-t3)'
              : 'var(--color-t2)';
  const label = status === 'connected' ? 'CONNECTED'
              : status === 'disconnected' ? 'NOT CONNECTED'
              : status === 'planned' ? 'PLANNED'
              : 'CHECKING';
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 6, background: 'var(--color-l2)',
      borderLeft: `3px solid ${color}`,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--color-t0)' }}>{name}</span>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 8.5, fontWeight: 700, letterSpacing: '1.2px', color }}>
          {label}
        </span>
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--color-t3)' }}>{sub}</div>}
      {actionHref && actionLabel && (
        <a href={actionHref} style={{
          fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.2px',
          color: 'var(--color-corporate)', textDecoration: 'none', marginTop: 4,
        }}>
          {actionLabel} →
        </a>
      )}
    </div>
  );
}
