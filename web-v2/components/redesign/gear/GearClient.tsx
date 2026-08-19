'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed, ShoeRec } from '@/components/faff-app/types';
import { Sheet } from '@/components/redesign/feedback/Sheet';
import { Tile } from '@/components/redesign/core/Tile';
import { Badge } from '@/components/redesign/core/Badge';
import { Button } from '@/components/redesign/core/Button';
import { Input } from '@/components/redesign/core/Input';
import { Select } from '@/components/redesign/core/Select';
import {
  SHOE_LIFESPAN,
  SHOE_TYPES,
  DEFAULT_SHOE_TYPE,
  defaultCapMi,
  type ShoeType,
} from '@/lib/shoe/lifespan';
import { RangeScale } from '@/components/redesign/graphics/RangeScale';
import { EmptyState } from '@/components/redesign/feedback/EmptyState';
import { Dialog } from '@/components/redesign/feedback/Dialog';

/**
 * components/redesign/gear/GearClient.tsx
 *
 * The redesigned Gear screen — the shoe garage. Structurally ported from
 * the outside-studio handoff's WebGear.jsx (designs/design-review-0818/
 * ui_kits/web/WebGear.jsx), which the source's own header comment marks
 * as "Level 3 · gear. Off Settings, over whatever surface was showing —
 * the shoe rack is never a surface of its own." It renders inside the
 * shared Sheet shell (components/redesign/feedback/Sheet.tsx) exactly as
 * the source does (`<WebSheet title="Gear" kicker="Settings" ...>`) —
 * unlike RunDetailClient/TodayClient/ActivityClient/BlockClient, which are
 * standalone top-level screens in the source design with no Sheet wrapper.
 * Reached here as a direct route (/redesign/gear) per this session's
 * route-per-screen approach; onClose falls back through router history to
 * /redesign/today since there is no live caller screen to return to yet.
 *
 * REAL DATA / REAL ACTIONS — every number and every mutation here is wired
 * to the same `shoes` table the live (non-redesign) /profile Shoe Garage
 * already uses (components/faff-app/views/ProfileView.tsx), via the same
 * /api/shoe route (web-v2/app/api/shoe/route.ts):
 *
 *   · Active pairs + mileage-vs-target — GET /api/shoe, adapted below.
 *   · Add a pair — POST /api/shoe (brand + model, split from a single
 *     "Name" field exactly as ProfileView's persistAdd already does, since
 *     the mock's Add form only collects one name field, not brand/model
 *     separately).
 *   · Retire — PATCH /api/shoe { id, retired: true }. Same call
 *     RunDetailClient.tsx's shoe-retire flow already makes.
 *
 * Two real fields seed.shoes does NOT carry, both needed by this screen:
 *
 *   · Retired shoes. components/faff-app/seed.ts#adaptShoes filters
 *     `!s.retired` before shoes ever reach the seed (seed.shoes is written
 *     for the active-shoe pickers elsewhere in the app, which have no use
 *     for retired pairs). The mock's "Retired" section needs them, so this
 *     component does its own GET /api/shoe on mount — the same endpoint,
 *     just unfiltered — mirroring the loading/ready/error fetch pattern
 *     ProfileView.tsx's PhysiologyBlock already uses for a client-fetched
 *     slice of profile data.
 *   · seed.shoes is used only for the very first paint (no fetch-flash on
 *     an already-real number); the GET response supersedes it the instant
 *     it lands.
 *
 * HONESTY GAPS (mock shows no real backing, or backing exists but the mock
 * doesn't render it — neither is silently faked here):
 *
 *   · None found for the flows the mock actually renders. WebGear.jsx's
 *     only two mutations are Add and Retire, and both map onto real,
 *     already-proven endpoints. /api/shoe also supports PATCH of
 *     `preferred` / `run_types` / `mileage_cap` post-creation and a hard
 *     DELETE — real capabilities ProfileView.tsx's fuller shoe editor uses
 *     — but WebGear.jsx's own 76 lines render no edit/delete/preferred
 *     affordance at all, only Add and Retire. Wiring UI the source design
 *     doesn't ask for would be inventing product, not porting it, so
 *     those two real-but-unrendered actions are left for whichever future
 *     pass ports Settings' fuller shoe editor (WebSheet lists Settings as
 *     a sibling sheet not yet wired).
 *   · Null `mileage_cap`. A shoe added before this table had the column
 *     (or added via a path that omits it) could have no retirement
 *     target. The mock's local state always has one, so it never
 *     considers this case. Handled honestly here — the progress bar is
 *     dropped in favor of a plain mileage line rather than fabricating a
 *     default target — same defensive shape RunDetailClient.tsx already
 *     uses for the identical field (`shoeMileageCap != null` gate).
 */

// Shape returned by GET /api/shoe (web-v2/app/api/shoe/route.ts) — a
// superset of ShoeRec that additionally carries `retired`, which is
// exactly the field this screen exists to show.
interface ShoeRow {
  id: number;
  brand: string | null;
  model: string | null;
  mileage: number;
  mileage_cap: number | null;
  retired: boolean;
}

interface GearShoe {
  id: number;
  name: string;
  mi: number;
  max: number | null;
  retired: boolean;
}

function seedToGearShoe(s: ShoeRec): GearShoe | null {
  if (s.id == null) return null;
  return { id: s.id, name: s.nm, mi: Math.round(s.mi), max: s.max ?? null, retired: false };
}

function rowToGearShoe(r: ShoeRow): GearShoe {
  return {
    id: r.id,
    name: [r.brand, r.model].filter(Boolean).join(' ') || 'Shoe',
    mi: Math.round(r.mileage ?? 0),
    max: r.mileage_cap == null ? null : Number(r.mileage_cap),
    retired: Boolean(r.retired),
  };
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
      letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
    }}>
      {children}
    </div>
  );
}

export function GearClient({ seed }: { seed: FaffSeed }) {
  const router = useRouter();

  const [shoes, setShoes] = useState<GearShoe[]>(() =>
    seed.shoes.map(seedToGearShoe).filter((s): s is GearShoe => s != null),
  );
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadShoes = useCallback(() => {
    setLoadState('loading');
    fetch('/api/shoe')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !Array.isArray(j.shoes)) { setLoadState('error'); return; }
        setShoes((j.shoes as ShoeRow[]).map(rowToGearShoe));
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }, []);

  useEffect(() => { loadShoes(); }, [loadShoes]);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  // Category first · it sets the retirement mileage. Was a bare '350' input
  // with no category at all, which is how this file came to hold a fifth
  // different default (Research/17 bands no category at 350).
  const [shoeType, setShoeType] = useState<ShoeType>(DEFAULT_SHOE_TYPE);
  const [retireAt, setRetireAt] = useState(String(defaultCapMi(DEFAULT_SHOE_TYPE)));
  const [addBusy, setAddBusy] = useState(false);
  const [retiringId, setRetiringId] = useState<number | null>(null);
  const [retireBusy, setRetireBusy] = useState(false);

  const active = shoes.filter((s) => !s.retired);
  const retired = shoes.filter((s) => s.retired);
  const target = shoes.find((s) => s.id === retiringId) ?? null;

  function close() {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/today');
  }

  async function addShoe() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setAddBusy(true);
    try {
      // Split a single "Name" field into brand + model — the mock's Add
      // form has one Name input, not separate brand/model fields, so this
      // follows the exact same split ProfileView.tsx's persistAdd uses
      // against the same POST /api/shoe endpoint.
      const parts = trimmed.split(/\s+/);
      const brand = parts[0] || 'Brand';
      const model = parts.slice(1).join(' ') || trimmed;
      // Send a cap ONLY when the runner moved it off the category's doctrine
      // default. Leaving it null keeps "nobody said" distinguishable from
      // "the runner chose this number", so the shoe follows doctrine if the
      // band is ever revised.
      const typed = Number(retireAt);
      const isDefault = !Number.isFinite(typed) || typed <= 0 || typed === defaultCapMi(shoeType);
      const res = await fetch('/api/shoe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand, model,
          shoe_type: shoeType,
          ...(isDefault ? {} : { mileage_cap: typed }),
        }),
      });
      if (res.ok) {
        setName('');
        setShoeType(DEFAULT_SHOE_TYPE);
        setRetireAt(String(defaultCapMi(DEFAULT_SHOE_TYPE)));
        setAdding(false);
        loadShoes();
      }
    } finally {
      setAddBusy(false);
    }
  }

  async function confirmRetire() {
    if (!target) return;
    setRetireBusy(true);
    try {
      const res = await fetch('/api/shoe', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id, retired: true }),
      });
      if (res.ok) loadShoes();
    } finally {
      setRetireBusy(false);
      setRetiringId(null);
    }
  }

  return (
    <>
      <Sheet title="Gear" kicker="Settings" onClose={close} width={520}>
        <div style={{ display: 'grid', gap: 'var(--sp-6)' }}>
          <Label>Active pairs</Label>

          {active.length === 0 && !adding && loadState !== 'loading' && (
            <EmptyState
              headline="No shoes logged yet"
              action={<Button variant="primary" onClick={() => setAdding(true)}>Add your first pair</Button>}
            >
              Log a pair to track mileage toward retirement.
            </EmptyState>
          )}

          {active.map((s) => {
            const near = s.max != null && s.max > 0 && s.mi / s.max >= 0.9;
            return (
              <Tile key={s.id} pad="md" radius="l">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-6)' }}>
                  <div style={{ fontSize: 'var(--type-body)', fontWeight: 'var(--weight-medium)' }}>{s.name}</div>
                  {near && <Badge tone="attention">Near retirement</Badge>}
                </div>
                {s.max != null ? (
                  <RangeScale mode="progress" min={0} max={s.max} value={s.mi} hue={near ? 'alarm' : 'neutral'}
                    endpoints={[`${s.mi} mi`, `${s.max} mi target`]} />
                ) : (
                  <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>
                    {s.mi} mi &middot; no retirement target set
                  </div>
                )}
                <div style={{ marginTop: 'var(--sp-6)' }}>
                  <Button variant="ghost" size="sm" onClick={() => setRetiringId(s.id)}>Retire these shoes</Button>
                </div>
              </Tile>
            );
          })}

          {adding ? (
            <Tile pad="md" radius="l" tone="raised">
              <div style={{ display: 'grid', gap: 'var(--sp-6)' }}>
                <Input label="Name" value={name} onChange={setName} helper="e.g. Pegasus 42" full />
                <Select
                  label="Type"
                  value={shoeType}
                  options={SHOE_TYPES.map((t) => ({ value: t, label: SHOE_LIFESPAN[t].label }))}
                  onChange={(v) => {
                    const next = v as ShoeType;
                    setShoeType(next);
                    // Follow the new category's default. A runner who wants a
                    // different number types over it.
                    setRetireAt(String(defaultCapMi(next)));
                  }}
                  full
                />
                <Input
                  label="Retire at"
                  type="number"
                  value={retireAt}
                  onChange={setRetireAt}
                  unit="mi"
                  helper={`${SHOE_LIFESPAN[shoeType].label}: ${SHOE_LIFESPAN[shoeType].lowMi} to ${SHOE_LIFESPAN[shoeType].highMi} mi`}
                  full
                />
                <div style={{ display: 'flex', gap: 'var(--sp-5)', justifyContent: 'flex-end' }}>
                  <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setName(''); }}>Cancel</Button>
                  <Button variant="primary" size="sm" disabled={addBusy} onClick={() => void addShoe()}>
                    {addBusy ? 'Adding…' : 'Add shoes'}
                  </Button>
                </div>
              </div>
            </Tile>
          ) : (
            <Button variant="secondary" full onClick={() => setAdding(true)}>Add a pair</Button>
          )}

          {retired.length > 0 && (
            <>
              <div style={{ marginTop: 'var(--sp-4)' }}><Label>Retired</Label></div>
              {retired.map((s) => (
                <Tile key={s.id} pad="md" radius="l" flat>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 'var(--type-body)', color: 'var(--text-secondary)' }}>{s.name}</div>
                      <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginTop: 2 }}>
                        {s.mi} mi total &middot; final
                      </div>
                    </div>
                    <Badge tone="quiet">Retired</Badge>
                  </div>
                </Tile>
              ))}
            </>
          )}

          {loadState === 'error' && (
            <p style={{ fontSize: 'var(--type-label-s)', color: 'var(--fault)', margin: 0 }}>
              Could not refresh your shoe list. Showing what loaded initially.
            </p>
          )}
        </div>
      </Sheet>

      {/* Rendered as a sibling of Sheet, not inside its scrollable content
          area — Sheet's content div sets overflowY:auto with no position
          of its own, and Dialog's position:absolute/inset:0 would resolve
          against Sheet's fixed root through that scroll container and get
          visually clipped/scrolled. As a direct child of the (position:
          static) redesign-root wrapper instead, it has no positioned
          ancestor at all and resolves against the viewport — the same
          effect the source gets from Dialog and WebSheet both being
          children of one already-positioned wrapper, and the same
          placement RunDetailClient.tsx already uses for its own
          shoe-retire Dialog. */}
      {target && (
        <Dialog
          open
          title={`Retire the ${target.name}?`}
          destructive
          confirmLabel={retireBusy ? 'Retiring…' : 'Retire shoes'}
          cancelLabel="Keep logging to them"
          onCancel={() => setRetiringId(null)}
          onConfirm={() => void confirmRetire()}
        >
          They&rsquo;ll stop appearing as an option when you log a run, and their mileage total is final at {target.mi} mi. This can&rsquo;t be undone.
        </Dialog>
      )}
    </>
  );
}
