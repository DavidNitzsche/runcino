/**
 * LogFilterStrip — URL-driven filter chips for /log.
 *
 * Four axes: SOURCE / TYPE / PHASE / SHOE. Each chip is a <Link> that
 * toggles the corresponding URL search param. Filters compose with AND
 * server-side in loadLogState() — this component just renders the strip
 * and lets the browser hit the same URL with a different query string.
 *
 * Per-axis chips are only rendered for values that actually appear in
 * the unfiltered set (passed in via `axes`), so we don't show CROSS
 * when the runner has zero cross-trains, etc.
 *
 * Stays a server component (no client state) — the URL IS the state.
 */
import Link from 'next/link';
import type { LogFilters, LogFilterAxes } from '@/lib/coach/log-state';

const SOURCE_LABELS: Record<string, string> = {
  watch: 'WATCH',
  strava: 'STRAVA',
  apple_health: 'HEALTH',
  manual: 'MANUAL',
};

interface ChipProps {
  href: string;
  label: string;
  active: boolean;
  sub?: string;
}

function Chip({ href, label, active, sub }: ChipProps) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
        padding: '6px 11px',
        borderRadius: 999,
        border: active ? '1px solid var(--green)' : '1px solid var(--line)',
        background: active ? 'rgba(127, 209, 152, 0.10)' : 'transparent',
        color: active ? 'var(--green)' : 'var(--mute)',
        fontFamily: 'var(--f-body)',
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '1.4px',
        textDecoration: 'none',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        transition: 'border-color .12s, color .12s, background .12s',
      }}
    >
      {label}
      {sub && (
        <span style={{
          fontSize: 9,
          fontWeight: 600,
          color: active ? 'var(--green)' : 'var(--dim)',
          letterSpacing: '1px',
        }}>{sub}</span>
      )}
    </Link>
  );
}

function AxisLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'var(--f-body)',
      fontSize: 9.5,
      fontWeight: 700,
      color: 'var(--dim)',
      letterSpacing: '1.6px',
      textTransform: 'uppercase',
      marginRight: 4,
    }}>{children}</span>
  );
}

/**
 * Build an href that toggles a single axis. Passing value=null clears it.
 * Other axes are preserved.
 */
function hrefFor(filters: LogFilters, axis: keyof LogFilters, value: string | null): string {
  const sp = new URLSearchParams();
  const next = { ...filters, [axis]: value };
  if (next.source) sp.set('source', next.source);
  if (next.type) sp.set('type', next.type);
  if (next.phase) sp.set('phase', next.phase);
  if (next.shoe) sp.set('shoe', next.shoe);
  const qs = sp.toString();
  return qs ? `/log?${qs}` : '/log';
}

interface LogFilterStripProps {
  filters: LogFilters;
  axes: LogFilterAxes;
}

export function LogFilterStrip({ filters, axes }: LogFilterStripProps) {
  const activeCount =
    (filters.source ? 1 : 0) +
    (filters.type ? 1 : 0) +
    (filters.phase ? 1 : 0) +
    (filters.shoe ? 1 : 0);

  const showSources = axes.sources.length > 1;
  const showTypes = axes.types.length > 0;
  const showPhases = axes.phases.length > 0;
  const showShoes = axes.shoes.length > 0;

  return (
    <div style={{ marginBottom: 22 }}>
      {/* Active-count banner — only shown when ≥1 filter is set */}
      {activeCount > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          fontFamily: 'var(--f-body)',
          fontSize: 10.5,
          fontWeight: 700,
          color: 'var(--green)',
          letterSpacing: '1.6px',
        }}>
          {activeCount} {activeCount === 1 ? 'FILTER' : 'FILTERS'} ACTIVE
          <span style={{ color: 'var(--line-2)' }}>·</span>
          <Link
            href="/log"
            style={{
              color: 'var(--mute)',
              textDecoration: 'underline',
              textDecorationColor: 'var(--line)',
              letterSpacing: '1.6px',
            }}
          >CLEAR ALL</Link>
        </div>
      )}

      {/* SOURCE axis — only show when >1 source is present (skipping when
          the runner only has one source bringing in everything). */}
      {showSources && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          <AxisLabel>SOURCE</AxisLabel>
          <Chip
            href={hrefFor(filters, 'source', null)}
            label="ALL"
            active={!filters.source}
          />
          {axes.sources.map((s) => (
            <Chip
              key={s}
              href={hrefFor(filters, 'source', filters.source === s ? null : s)}
              label={SOURCE_LABELS[s] ?? s.toUpperCase()}
              active={filters.source === s}
            />
          ))}
        </div>
      )}

      {/* TYPE axis */}
      {showTypes && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          <AxisLabel>TYPE</AxisLabel>
          <Chip
            href={hrefFor(filters, 'type', null)}
            label="ALL"
            active={!filters.type}
          />
          {axes.types.map((t) => (
            <Chip
              key={t}
              href={hrefFor(filters, 'type', filters.type === t ? null : t)}
              label={t.toUpperCase()}
              active={filters.type === t}
            />
          ))}
        </div>
      )}

      {/* PHASE axis */}
      {showPhases && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          <AxisLabel>PHASE</AxisLabel>
          <Chip
            href={hrefFor(filters, 'phase', null)}
            label="ALL"
            active={!filters.phase}
          />
          {axes.phases.map((p) => (
            <Chip
              key={p}
              href={hrefFor(filters, 'phase', filters.phase === p ? null : p)}
              label={p.toUpperCase()}
              active={filters.phase === p}
            />
          ))}
        </div>
      )}

      {/* SHOE axis — each chip carries the run count as a subscript */}
      {showShoes && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <AxisLabel>SHOE</AxisLabel>
          <Chip
            href={hrefFor(filters, 'shoe', null)}
            label="ALL"
            active={!filters.shoe}
          />
          {axes.shoes.map((s) => (
            <Chip
              key={s.slug}
              href={hrefFor(filters, 'shoe', filters.shoe === s.slug ? null : s.slug)}
              label={s.name}
              active={filters.shoe === s.slug}
              sub={String(s.runs)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Empty-state card — rendered inside the table area when filters
 * return 0 rows. Keeps the table layout intact (uses the .card class)
 * and offers a one-click escape hatch back to the full log.
 */
export function LogEmptyMatch({ totalUnfiltered }: { totalUnfiltered: number }) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '40px 0', textAlign: 'center' }}>
      <div className="card-eyebrow" style={{ color: 'var(--mute)' }}>NO RUNS MATCH</div>
      <p style={{ color: 'var(--mute)', fontSize: 13, marginTop: 8, letterSpacing: '0.5px' }}>
        <Link
          href="/log"
          style={{
            color: 'var(--green)',
            textDecoration: 'underline',
            textDecorationColor: 'var(--line)',
            fontWeight: 700,
          }}
        >CLEAR FILTERS</Link>
        {' '}TO SEE ALL {totalUnfiltered} RUNS
      </p>
    </div>
  );
}
