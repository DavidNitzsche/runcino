'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed, ActivityRange, HeatCell, RecentRun } from '@/components/faff-app/types';
import { Tile } from '@/components/redesign/core/Tile';
import { Badge, type BadgeTone } from '@/components/redesign/core/Badge';
import { Button } from '@/components/redesign/core/Button';
import { Stat } from '@/components/redesign/core/Stat';
import { SegmentBar } from '@/components/redesign/nav/SegmentBar';
import { FaffChartRegistrar } from '@/components/redesign/graphics/FaffChartRegistrar';

/**
 * components/redesign/activity/ActivityClient.tsx
 *
 * The redesigned Activity screen, wired to the SAME real seed the live
 * ActivityView (components/faff-app/views/ActivityView.tsx, mounted inside
 * Shell.tsx) renders — seed.activity, from components/faff-app/seed.ts's
 * adaptActivity()/buildRange(). No new data path.
 *
 * SCOPE — this is deliberately NOT a narrow port of the design handoff's
 * WebActivity.jsx (designs/design-review-0818/ui_kits/web/WebActivity.jsx,
 * 39 lines: 3 stat tiles + a flat recent-runs list). That mock is thinner
 * than the app's real, currently-shipping Activity surface, which also
 * renders a volume-by-month chart, an effort-mix donut, a Personal Records
 * section, an 18-week consistency heatmap, a "by the numbers" facts strip,
 * and a grouped/filterable recent-runs log. Per this task's brief, the
 * mock is read as the new visual GRAMMAR (label sizing, spacing rhythm,
 * the recent-run row with a colored left bar keyed to effort state) to
 * apply across the app's full real feature set — not as a spec that caps
 * the page at what the mock happened to show. Every section below has a
 * live counterpart in ActivityView.tsx; nothing here is invented.
 *
 * Sections, each with its real source:
 *   · Range hero + totals  — d.eyebrow/d.big/d.sub/d.totals (buildRange)
 *   · Volume chart         — d.vol[] via <faff-chart type="bars">
 *   · Effort mix           — d.mix[] (custom SVG donut — <faff-chart> has
 *                             no multi-segment mark; ring/bars/line only)
 *   · Personal records     — d.recs[] (fastest 5K/10K, longest run, biggest week)
 *   · Consistency heatmap  — d.heat[][] + d.heatLabels (18 weeks × 7 days)
 *   · By the numbers       — d.facts[] (elev/miles/hours/long-run-day pattern)
 *   · Recent runs          — seed.activity.recent, grouped by week, with the
 *                             real type-filter chips and Show more window
 *                             ActivityView's RecentRunsLog already has
 *
 * DROPPED, matching what's ALREADY hidden in the live view (not a cut this
 * pass made): the Efficiency Trend band. ActivityView.tsx gates it behind
 * `{false && ...}` with an explicit comment — easy pace is intentionally
 * slow, so pace-at-HR always reads as "declining" for a runner executing
 * the plan correctly, and a redesign of the underlying signal (tempo/
 * threshold pace vs HR) is pending. Reproducing a band David turned off
 * would be a regression dressed as parity, not parity.
 *
 * Colour: recent-run bars, heatmap cells, mix-donut slices and PR accents
 * all resolve through the SAME state-hue mapping Today/WeekStrip already
 * use (easy → --state-easy, long → --state-long, tempo/intervals/recovery
 * → --state-quality — recovery is the same "ease" bucket TodayClient's
 * posterStateFor and WeekStrip's ACCENT_KEY already fold into quality,
 * race → --state-race), never the legacy seed.ts EFFORT_COLOR hex values
 * (#27B4E0 etc.) the live ActivityView paints with. Those are the OLD
 * app's palette; the redesign owns a separate, CI-locked one (CLAUDE.md
 * "Design source of truth" / check-palette-sync.sh) — reusing the legacy
 * hex here would quietly reintroduce a second, unlocked colour system.
 */

// ── effort → redesign state-hue mapping ──────────────────────────────────
// Mirrors TodayClient's posterStateFor / WeekStrip's ACCENT_KEY exactly:
// recovery folds into 'quality' (the same bucket "ease" resolves to for a
// solid ink — WeekStrip's ACCENT_KEY has ease: 'quality'), tempo/intervals
// are both the one 'quality' bucket for hard non-long work, rest reads as
// disabled ink rather than a state color (also matching WeekStrip).
type InkHue = 'easy' | 'quality' | 'long' | 'race';
function effortInkHue(effort: string): InkHue {
  switch (effort) {
    case 'easy': return 'easy';
    case 'long': return 'long';
    case 'race': return 'race';
    case 'tempo':
    case 'intervals':
    case 'recovery':
    default: return 'quality';
  }
}
function effortInk(effort: string): string {
  if (effort === 'rest') return 'var(--text-disabled)';
  return `var(--state-${effortInkHue(effort)}-ink)`;
}

const BADGE_TONE: Record<NonNullable<RecentRun['badge']>, BadgeTone> = {
  'ON TARGET': 'easy', SOLID: 'easy', LONGEST: 'long', PR: 'signal', RACE: 'race',
};

/** Recent runs' `.k`/`.t` records use the same three-bucket vocabulary
 *  (tempo/long/race) the mix + heatmap use; PRs never carry 'easy'. */
function recAccent(t: string): string {
  return effortInk(t);
}

/** seed.ts formats totals/PR values as `"38<small> mi</small>"` (the live
 *  ActivityView renders this with dangerouslySetInnerHTML). Splitting it
 *  into Stat's own value/unit props instead of injecting raw HTML is a
 *  pure presentation change — same real string, same real number, just
 *  read through the format seed.ts already guarantees rather than
 *  re-injected as markup. */
function splitValueUnit(html: string): { value: string; unit?: string } {
  const m = /^(.*?)<small>\s*([^<]*?)\s*<\/small>\s*$/.exec(html);
  if (!m) return { value: html };
  return { value: m[1], unit: m[2] };
}

/** seed.ts's RecentRun.meta is always built as `${mi.toFixed(1)} mi${pace
 *  ? ' · ' + pace : ''}` (components/faff-app/seed.ts:adaptActivity). This
 *  reverses that exact, deterministic format to recover the two columns
 *  the design's row grammar wants (dose, pace) — not a guess, the inverse
 *  of a format string in this same codebase. */
function splitMeta(meta: string): { dose: string; pace: string | null } {
  const [dose, pace] = meta.split(' · ');
  return { dose, pace: pace ?? null };
}

const RANGE_OPTIONS = [
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All time' },
];

const HEAT_SCALE = [
  'var(--material-track)',
  'color-mix(in oklab, var(--state-long) 35%, var(--material-track))',
  'color-mix(in oklab, var(--state-long) 62%, var(--material-track))',
  'color-mix(in oklab, var(--state-long) 88%, var(--material-track))',
  'var(--state-long-ink)',
];

const FACT_ICON: Record<string, ReactNode> = {
  mtn: <path d="M3 19l6-11 4 6 3-5 5 10z" />,
  route: <><path d="M6 19a3 3 0 0 1 0-6h9a3 3 0 0 0 0-6H7" /><circle cx="6" cy="19" r="1.6" /><circle cx="18" cy="5" r="1.6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  cal: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
};

function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-7)' }}>
      <div className="faff-label">{children}</div>
      {right && <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', letterSpacing: 'var(--tracking-label)' }}>{right}</div>}
    </div>
  );
}

export function ActivityClient({ seed }: { seed: FaffSeed }) {
  const router = useRouter();
  const [range, setRange] = useState<'month' | 'year' | 'all'>('year');
  const d: ActivityRange = seed.activity.ranges[range];

  const openRun = (slug?: string) => {
    if (slug) router.push(`/runs/${encodeURIComponent(slug)}`);
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--stack-gap)', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
      <FaffChartRegistrar />

      <header style={{ display: 'grid', gap: 'var(--sp-2)' }}>
        <div className="faff-kicker">Training log</div>
        <div className="faff-display" style={{ fontSize: 'var(--type-display-3)' }}>Activity</div>
        <div style={{ color: 'var(--text-quiet)', fontSize: 'var(--type-body-s)' }}>Every run, every range, one real log.</div>
      </header>

      {/* ── range hero ──────────────────────────────────────────────── */}
      <Tile pad="lg" radius="2xl">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--sp-7)', flexWrap: 'wrap' }}>
          <div>
            <div className="faff-kicker">{d.eyebrow}</div>
            <div className="faff-value" style={{ fontSize: 'var(--type-value-1)', marginTop: 'var(--sp-4)' }}>
              {d.big}
              <span style={{
                fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
                letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', marginLeft: 8, color: 'var(--text-quiet)',
              }}>mi</span>
            </div>
            <div style={{ fontSize: 'var(--type-body-s)', color: 'var(--text-quiet)', marginTop: 'var(--sp-3)' }}>{d.sub}</div>
          </div>
          <SegmentBar value={range} options={RANGE_OPTIONS} onChange={(v) => setRange(v as typeof range)} />
        </div>
      </Tile>

      {/* ── totals ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 'var(--stack-gap)' }}>
        {d.totals.map(([label, html]) => {
          const { value, unit } = splitValueUnit(html);
          return (
            <Tile key={label}>
              <Stat label={label} value={value} unit={unit} size="md" />
            </Tile>
          );
        })}
      </div>

      {/* ── volume + effort mix ────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 'var(--stack-gap)', alignItems: 'stretch' }}>
        <Tile pad="lg" radius="l" style={{ display: 'flex', flexDirection: 'column' }}>
          <SectionLabel right={d.volS}>{d.volT}</SectionLabel>
          <div style={{ flex: '1 1 auto', minHeight: 200 }}>
            <faff-chart
              type="bars"
              values={JSON.stringify(d.vol.map((v) => v.v))}
              labels={JSON.stringify(d.vol.map((v) => v.l))}
              hue="long"
            />
          </div>
          {/* seed.ts computes an average-mileage marker for this same series
             (ActivityView draws it as an overlay line). Dropped here, not
             softened — chart.css's own doctrine is explicit: "ONE MARK TYPE
             PER CHART... nothing is laid over the marks: no gridlines, axes,
             bands, thresholds or labels on the data." An avg overlay is
             exactly the shape that rule forbids. */}
        </Tile>

        <Tile pad="lg" radius="l">
          <SectionLabel>Effort mix</SectionLabel>
          <MixDonut mix={d.mix} />
        </Tile>
      </div>

      {/* ── personal records ───────────────────────────────────────── */}
      <Tile pad="lg" radius="l">
        <SectionLabel>Personal records</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 'var(--stack-gap)' }}>
          {d.recs.map((r) => {
            const { value, unit } = splitValueUnit(r.v);
            return (
              <div key={r.k} style={{ boxShadow: 'inset 0 1px 0 var(--rule-light)', paddingTop: 'var(--sp-6)' }}>
                <div style={{
                  fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
                  letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
                }}>{r.k}</div>
                <div className="faff-value" style={{ fontSize: 'var(--type-value-3)', color: recAccent(r.t), marginTop: 'var(--sp-4)' }}>
                  {value}
                  {unit && (
                    <span style={{
                      fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
                      letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', marginLeft: 6, color: 'var(--text-quiet)',
                    }}>{unit}</span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginTop: 'var(--sp-3)' }}>{r.c}</div>
              </div>
            );
          })}
        </div>
      </Tile>

      {/* ── consistency heatmap ────────────────────────────────────── */}
      <Tile pad="lg" radius="l">
        <SectionLabel right="Last 18 weeks">Consistency</SectionLabel>
        <ConsistencyHeat cols={d.heat} labels={d.heatLabels} onOpenRun={openRun} />
      </Tile>

      {/* ── by the numbers ─────────────────────────────────────────── */}
      <Tile pad="lg" radius="l">
        <SectionLabel>By the numbers</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 'var(--stack-gap)' }}>
          {d.facts.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 'var(--sp-6)', alignItems: 'flex-start' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--state-quality-ink)" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto', marginTop: 2 }}>
                {FACT_ICON[f.i]}
              </svg>
              <div>
                <div className="faff-value" style={{ fontSize: 'var(--type-value-4)' }}>{f.v}</div>
                <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginTop: 2 }}>{f.c}</div>
              </div>
            </div>
          ))}
        </div>
      </Tile>

      {/* ── recent runs ─────────────────────────────────────────────── */}
      <Tile pad="md" radius="l">
        <div style={{ padding: '0 var(--sp-2)' }}>
          <SectionLabel>Recent runs</SectionLabel>
        </div>
        <RecentRunsLog recent={seed.activity.recent} onOpenRun={openRun} />
      </Tile>
    </div>
  );
}

// ── effort mix donut ────────────────────────────────────────────────────
// <faff-chart> only draws ring / bars / line marks (one value each) — no
// multi-segment mark exists in the ported chart element, so a mix donut is
// composed directly with the same circle-dasharray technique the live
// ActivityView already uses, recoloured through the redesign's own
// state-ink tokens instead of the legacy EC hex table.
function MixDonut({ mix }: { mix: [string, string, number][] }) {
  const C = 2 * Math.PI * 42;
  let acc = 0;
  const arcs = mix.filter((m) => m[2] > 0).map((m) => {
    const len = (m[2] / 100) * C;
    const el = (
      <circle key={m[0]} cx="50" cy="50" r="42" fill="none" stroke={effortInk(m[0])} strokeWidth="14"
        strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)" strokeLinecap="butt" />
    );
    acc += len;
    return el;
  });
  const top = mix[0];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-9)', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: 148, height: 148, flex: '0 0 auto' }}>
        <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
          <circle cx="50" cy="50" r="42" fill="none" stroke="var(--material-track)" strokeWidth="14" />
          {arcs}
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        }}>
          <div className="faff-value" style={{ fontSize: 'var(--type-value-3)' }}>{top?.[2] ?? 0}%</div>
          <div style={{
            fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
            letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
          }}>{top?.[1] ?? ''}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 'var(--sp-4)', flex: '1 1 auto', minWidth: 120 }}>
        {mix.map((m) => (
          <div key={m[0]} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', fontSize: 'var(--type-body-s)' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: effortInk(m[0]), flex: '0 0 auto' }} />
            <span style={{ flex: '1 1 auto', color: 'var(--text-secondary)' }}>{m[1]}</span>
            <span className="faff-value" style={{ fontSize: 'var(--type-label)' }}>{m[2]}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── consistency heatmap ─────────────────────────────────────────────────
function ConsistencyHeat({ cols, labels, onOpenRun }: { cols: HeatCell[][]; labels: string[]; onOpenRun: (id?: string) => void }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length},minmax(0,1fr))`, gap: 3 }}>
        {cols.map((col, ci) => (
          <div key={ci} style={{ display: 'grid', gap: 3 }}>
            {col.map((cell, di) => {
              const clickable = !!cell.runId;
              return (
                <div
                  key={di}
                  title={cell.label}
                  onClick={clickable ? () => onOpenRun(cell.runId) : undefined}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenRun(cell.runId); } } : undefined}
                  style={{
                    aspectRatio: '1', borderRadius: 3, background: HEAT_SCALE[cell.lv],
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-5)' }}>
        {labels.map((l, i) => (
          <span key={i} style={{
            fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
            letterSpacing: 'var(--tracking-label)', color: 'var(--text-quiet)',
          }}>{l}</span>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'var(--sp-7)', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>Less</span>
        {HEAT_SCALE.map((c, i) => <span key={i} style={{ width: 12, height: 12, borderRadius: 3, background: c }} />)}
        <span style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>More</span>
      </div>
    </div>
  );
}

// ── recent runs, grouped by week ────────────────────────────────────────
// Same grouping + type-filter behavior as ActivityView.tsx's RecentRunsLog
// (2026-08-17): consecutive runs sharing a week label form one group, a
// type filter narrows the whole list, "Show more" widens the visible
// window four weeks at a time. Reused here rather than reimplemented from
// scratch, restyled to the redesign's own row grammar (the mock's date /
// bar / name / dose / pace columns).
const EFFORT_ORDER = ['easy', 'long', 'tempo', 'intervals', 'recovery', 'race'];

function RecentRunsLog({ recent, onOpenRun }: { recent: RecentRun[]; onOpenRun: (id?: string) => void }) {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [weeksShown, setWeeksShown] = useState(4);

  const effortsPresent = useMemo(
    () => EFFORT_ORDER.filter((e) => recent.some((r) => r.effort === e)),
    [recent],
  );
  const filtered = typeFilter ? recent.filter((r) => r.effort === typeFilter) : recent;

  const groups = useMemo(() => {
    const out: { week: string; runs: RecentRun[]; mi: number }[] = [];
    for (const r of filtered) {
      const wk = r.week ?? 'RECENT';
      const last = out[out.length - 1];
      if (last && last.week === wk) { last.runs.push(r); last.mi += r.mi ?? 0; }
      else out.push({ week: wk, runs: [r], mi: r.mi ?? 0 });
    }
    return out;
  }, [filtered]);
  const visible = groups.slice(0, weeksShown);

  if (recent.length === 0) {
    return <div style={{ padding: 'var(--sp-8) var(--sp-2)', color: 'var(--text-quiet)', fontSize: 'var(--type-body-s)' }}>No runs logged yet.</div>;
  }

  return (
    <>
      {effortsPresent.length > 1 && (
        <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', padding: '0 var(--sp-2)', marginBottom: 'var(--sp-7)' }}>
          <FilterChip on={!typeFilter} onClick={() => { setTypeFilter(null); setWeeksShown(4); }}>All</FilterChip>
          {effortsPresent.map((e) => (
            <FilterChip key={e} on={typeFilter === e} dot={effortInk(e)}
              onClick={() => { setTypeFilter(typeFilter === e ? null : e); setWeeksShown(4); }}>
              {e[0].toUpperCase() + e.slice(1)}
            </FilterChip>
          ))}
        </div>
      )}

      <div>
        {visible.map((g, gi) => (
          <div key={`${g.week}-${gi}`}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', padding: 'var(--sp-6) var(--sp-2) var(--sp-3)',
              fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
              letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
            }}>
              <span>{g.week}</span>
              <span>{g.mi.toFixed(1)} mi</span>
            </div>
            {g.runs.map((r, i) => {
              const { dose, pace } = splitMeta(r.meta);
              const clickable = !!r.slug;
              return (
                <div
                  key={r.slug ?? `${g.week}-${i}`}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onOpenRun(r.slug) : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenRun(r.slug); } } : undefined}
                  style={{
                    display: 'grid', gridTemplateColumns: '96px 4px minmax(0,1fr) auto 76px 68px', gap: 'var(--sp-6)',
                    alignItems: 'center', padding: 'var(--sp-6) var(--sp-2)', cursor: clickable ? 'pointer' : 'default',
                    boxShadow: 'inset 0 1px 0 var(--rule-light)',
                  }}
                >
                  <div style={{ fontSize: 'var(--type-body-s)', color: 'var(--text-quiet)' }}>{r.date}</div>
                  <div style={{ width: 4, height: 26, borderRadius: 2, background: effortInk(r.effort) }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--type-body)', fontWeight: 'var(--weight-medium)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                  </div>
                  {r.badge ? (
                    r.badge === 'RACE' && r.raceSlug ? (
                      <a href={`/goal/${r.raceSlug}`} onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none' }}>
                        <Badge tone="race">Race</Badge>
                      </a>
                    ) : (
                      <Badge tone={BADGE_TONE[r.badge]}>{r.badge}</Badge>
                    )
                  ) : <span />}
                  <div className="faff-value" style={{ fontSize: 'var(--type-value-4)' }}>{dose}</div>
                  <div className="faff-value" style={{ fontSize: 'var(--type-value-4)', color: 'var(--text-secondary)', textAlign: 'right' }}>{pace ?? ''}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {groups.length > weeksShown && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--sp-8)' }}>
          <Button variant="ghost" size="sm" onClick={() => setWeeksShown((n) => n + 4)}>Show more</Button>
        </div>
      )}
    </>
  );
}

function FilterChip({ children, on, dot, onClick }: { children: ReactNode; on: boolean; dot?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-4)', height: 32, padding: '0 var(--sp-6)',
        borderRadius: 'var(--radius-pill)', border: 0, cursor: 'pointer', fontFamily: 'var(--font-core)',
        fontSize: 'var(--type-label)', fontWeight: 'var(--weight-medium)',
        background: on ? 'var(--material-control)' : 'transparent',
        boxShadow: on ? 'var(--elevation-control)' : 'inset 0 0 0 1px var(--rule-light)',
        color: on ? 'var(--text-primary)' : 'var(--text-quiet)',
      }}
    >
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />}
      {children}
    </button>
  );
}
