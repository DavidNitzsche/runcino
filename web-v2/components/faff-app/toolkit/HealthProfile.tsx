'use client';

/**
 * Faff Toolkit · B/D extras for Health & Profile surfaces
 *
 *   VDOTPredictionTable · "what your VDOT says" 5K / 10K / HM / M
 *                         predicted-time list. Closes line 1130.
 *   ArticleIndexCard    · Learn doctrine reader card. Closes line 1624.
 *   PhysiologyStatRow   · helper that drops StatTile + ProvenanceLine
 *                         together (LTHR / HRmax / VDOT / weight rows).
 */
import { ProvenanceLine, StatTile } from './atoms';

/* ============================================================
   VDOTPredictionTable
   Caller passes already-formatted predicted times (driven by
   lib/training/vdot.ts:predictRaceTime + formatRaceTime).
   We only own the layout + framing.
   ============================================================ */
export interface VDOTPredictionRow {
  distance: string;     // "5K" / "10K" / "HM" / "Marathon"
  predictedTime: string; // "1:34:22"
}

export function VDOTPredictionTable({
  vdot,
  rows,
  caption = 'Daniels predicts these times for your current VDOT. Adjust for course + weather.',
}: {
  vdot: number | null;
  rows: VDOTPredictionRow[];
  caption?: string;
}) {
  if (!rows || rows.length === 0) return null;
  return (
    <div>
      {vdot ? (
        <p className="fa-eyebrow" style={{ color: 'var(--amber-bright)', marginBottom: 10 }}>
          WHAT YOUR VDOT SAYS · {vdot}
        </p>
      ) : null}
      <div className="fa-predict">
        {rows.map((r) => (
          <div key={r.distance} className="row">
            <span className="d">{r.distance}</span>
            <span className="t">{r.predictedTime}</span>
          </div>
        ))}
      </div>
      <p className="fa-prov">{caption}</p>
    </div>
  );
}

/* ============================================================
   PhysiologyStatRow · the Profile composite. StatTile + ProvenanceLine.
   ============================================================ */
export function PhysiologyStatRow({
  value,
  unit,
  label,
  setDate,
  method,
  stale,
  onExplain,
}: {
  value: string | number;
  unit?: string;
  label: string;
  setDate?: string | null;
  method?: string;
  stale?: boolean;
  onExplain?: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <StatTile value={value} unit={unit} label={label} onExplain={onExplain} />
      {method ? (
        <div style={{ padding: '0 16px 12px' }}>
          <ProvenanceLine set={setDate ?? undefined} method={method} stale={stale} />
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
   ArticleIndexCard · the card used in /learn index for each article.
   ============================================================ */
export function ArticleIndexCard({
  slug,
  category,
  title,
  excerpt,
}: {
  slug: string;
  category: string;
  title: string;
  excerpt?: string;
}) {
  return (
    <a href={`/learn/${slug}`} className="fa-article">
      <div className="cat">{category}</div>
      <h3 className="ttl">{title}</h3>
      {excerpt ? <p className="ex">{excerpt}</p> : null}
    </a>
  );
}
