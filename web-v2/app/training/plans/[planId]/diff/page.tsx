/**
 * /training/plans/[planId]/diff?from=<oldPlanId>
 *
 * SEE THE NEW PLAN · side-by-side diff after an auto-rebuild.
 * Linked from the PlanProposalCard (status='auto_applied'). Reads
 * the structured diff from GET /api/plan/diff and renders:
 *
 *   · Header · "PLAN UPDATED" eyebrow + old → new label
 *   · Summary chip row · daysChanged · milesDelta · qualityDaysChanged
 *   · Per-ISO-week sections grouping byDate entries
 *   · Per-row · date · old (left) · arrow · new (right) · change-kind badge
 *
 * Server component · reads cookies from the incoming request to
 * forward auth when calling /api/plan/diff. Gracefully handles missing
 * ?from (renders the new plan in single-column mode with a "no prior
 * plan to compare" note).
 *
 * Brief: designs/briefs/web-todayview-fixes-consolidated-2026-06-02.md §2
 */

import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface WorkoutRow {
  date: string;
  type: string;
  distanceMi: number;
  subLabel: string | null;
  isQuality: boolean;
  isLong: boolean;
  workoutSpec: Record<string, unknown> | null;
}

interface PlanMeta {
  id: string;
  label: string;
  authoredIso: string | null;
  archivedIso: string | null;
  totalMiles: number;
  weekCount: number;
}

type ChangeKind = 'unchanged' | 'distance' | 'type' | 'sub_label' | 'added' | 'removed';

interface ByDateRow {
  date: string;
  old: WorkoutRow | null;
  new: WorkoutRow | null;
  changeKind: ChangeKind;
}

interface DiffResponse {
  ok: true;
  from: PlanMeta;
  to: PlanMeta;
  byDate: ByDateRow[];
  summary: { daysChanged: number; milesDelta: number; qualityDaysChanged: number };
}

interface DiffError { ok: false; error: string }

async function loadDiff(toPlanId: string, fromPlanId: string | null): Promise<DiffResponse | DiffError | null> {
  if (!fromPlanId) {
    // No prior plan to compare · the page renders a single-column
    // fallback explaining there's no diff. Return null to signal
    // that state without making a doomed API call.
    return null;
  }
  const h = await headers();
  const c = await cookies();
  const cookieHeader = c.getAll().map(({ name, value }) => `${name}=${value}`).join('; ');
  // Build absolute URL · server-side fetch can't use relative paths.
  // X-Forwarded-Host is set by Next when running behind a reverse proxy
  // (Railway); fall back to host.
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const url = `${proto}://${host}/api/plan/diff?from=${encodeURIComponent(fromPlanId)}&to=${encodeURIComponent(toPlanId)}`;
  try {
    const r = await fetch(url, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function fmtSignedMiles(n: number): string {
  if (n === 0) return '0 mi';
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(1)} mi`;
}

function groupByWeek(rows: ByDateRow[]): Array<{ weekKey: string; rows: ByDateRow[] }> {
  const groups = new Map<string, ByDateRow[]>();
  for (const r of rows) {
    // Group by ISO week-start (Monday). YYYY-MM-DD → week-Monday string.
    try {
      const d = new Date(r.date + 'T12:00:00');
      const dow = (d.getUTCDay() + 6) % 7;          // 0=Mon ... 6=Sun
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - dow);
      const key = monday.toISOString().slice(0, 10);
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    } catch {
      const k = r.date;
      const list = groups.get(k) ?? [];
      list.push(r);
      groups.set(k, list);
    }
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, rows]) => ({ weekKey, rows }));
}

const KIND_LABEL: Record<ChangeKind, string> = {
  unchanged: '',
  distance: 'DISTANCE',
  type: 'TYPE',
  sub_label: 'LABEL',
  added: 'NEW',
  removed: 'DROPPED',
};

const KIND_COLOR: Record<ChangeKind, string> = {
  unchanged: 'rgba(255,255,255,.32)',
  distance:  '#F3AD38',
  type:      '#E88021',
  sub_label: 'rgba(255,255,255,.72)',
  added:     '#3EBD41', // --green
  removed:   '#FC4D64',
};

function WorkoutCell({ w, muted }: { w: WorkoutRow | null; muted: boolean }) {
  if (!w) {
    return <span style={{ opacity: 0.4, fontSize: 13 }}>·</span>;
  }
  return (
    <div style={{ opacity: muted ? 0.55 : 1 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}>
        {w.type}
      </div>
      <div style={{ fontFamily: "'Oswald',sans-serif", fontSize: 19, fontWeight: 600, marginTop: 2 }}>
        {w.distanceMi.toFixed(1)} mi
      </div>
      {w.subLabel ? (
        <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.7, marginTop: 2 }}>
          {w.subLabel}
        </div>
      ) : null}
    </div>
  );
}

export default async function PlanDiffPage({
  params, searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { planId: toPlanId } = await params;
  const { from: fromParam } = await searchParams;
  const fromPlanId = fromParam && fromParam.length > 0 ? fromParam : null;

  if (!toPlanId || toPlanId === 'undefined' || toPlanId === 'null') notFound();

  const data = await loadDiff(toPlanId, fromPlanId);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(165deg,#0e5a52,#0a423a 60%,#0c5048)',
      color: 'var(--txt,#F6F7F8)',
      padding: '32px 24px 64px',
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <Link
          href="/today"
          style={{
            display: 'inline-block', marginBottom: 18,
            fontSize: 12, fontWeight: 700, letterSpacing: 1.4,
            textTransform: 'uppercase', color: 'rgba(255,255,255,.7)',
            textDecoration: 'none',
          }}
        >
          ← Today
        </Link>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, opacity: 0.6 }}>
          PLAN UPDATED
        </div>

        {data && data.ok && fromPlanId ? (
          <>
            <h1 style={{
              fontFamily: "'Oswald',sans-serif", fontSize: 44, fontWeight: 600,
              lineHeight: 1, letterSpacing: '-1px', margin: '8px 0 4px',
            }}>
              {data.from.label} → {data.to.label}
            </h1>
            <div style={{ fontSize: 13, fontWeight: 500, opacity: 0.7, marginBottom: 22 }}>
              {data.from.weekCount} weeks · {data.from.totalMiles.toFixed(0)} mi → {data.to.weekCount} weeks · {data.to.totalMiles.toFixed(0)} mi
            </div>

            {/* Summary chips */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
              <SummaryChip label="DAYS CHANGED" value={data.summary.daysChanged.toString()} />
              <SummaryChip
                label="MILES"
                value={fmtSignedMiles(data.summary.milesDelta)}
                color={data.summary.milesDelta > 0 ? '#3EBD41' /* --green */ : data.summary.milesDelta < 0 ? '#F3AD38' : undefined}
              />
              <SummaryChip label="QUALITY DAYS CHANGED" value={data.summary.qualityDaysChanged.toString()} />
            </div>

            {/* Per-week groups */}
            {groupByWeek(data.byDate.filter(r => r.changeKind !== 'unchanged')).map(({ weekKey, rows }) => (
              <section key={weekKey} style={{ marginBottom: 32 }}>
                <div style={{
                  fontSize: 11, fontWeight: 800, letterSpacing: 2, opacity: 0.55,
                  marginBottom: 12,
                }}>
                  WEEK OF {fmtDate(weekKey).toUpperCase()}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {rows.map(r => (
                    <div
                      key={r.date}
                      style={{
                        background: 'rgba(4,18,16,.4)',
                        border: '1px solid rgba(255,255,255,.1)',
                        borderRadius: 14,
                        padding: '14px 18px',
                        display: 'grid',
                        gridTemplateColumns: '100px 1fr 28px 1fr 100px',
                        alignItems: 'center',
                        gap: 16,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.78)' }}>
                        {fmtDate(r.date)}
                      </div>
                      <WorkoutCell w={r.old} muted={r.changeKind === 'removed' || r.changeKind === 'added'} />
                      <div style={{ textAlign: 'center', opacity: 0.45, fontSize: 18 }}>→</div>
                      <WorkoutCell w={r.new} muted={r.changeKind === 'removed'} />
                      <span style={{
                        textAlign: 'right',
                        fontSize: 10, fontWeight: 800, letterSpacing: 1.2,
                        color: KIND_COLOR[r.changeKind],
                      }}>
                        {KIND_LABEL[r.changeKind]}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {data.byDate.every(r => r.changeKind === 'unchanged') ? (
              <div style={{
                background: 'rgba(4,18,16,.4)',
                border: '1px solid rgba(255,255,255,.1)',
                borderRadius: 14,
                padding: 20,
                textAlign: 'center',
                color: 'rgba(255,255,255,.7)',
                fontSize: 14,
              }}>
                No day-level differences between these two plans.
              </div>
            ) : null}
          </>
        ) : null}

        {/* No prior plan to compare · single-column fallback */}
        {!fromPlanId ? (
          <>
            <h1 style={{
              fontFamily: "'Oswald',sans-serif", fontSize: 44, fontWeight: 600,
              lineHeight: 1, letterSpacing: '-1px', margin: '8px 0 16px',
            }}>
              New plan active
            </h1>
            <div style={{
              background: 'rgba(4,18,16,.4)',
              border: '1px solid rgba(255,255,255,.1)',
              borderRadius: 14,
              padding: 22,
              color: 'rgba(255,255,255,.78)',
              fontSize: 14,
              lineHeight: 1.5,
            }}>
              No prior plan to compare against. The auto-adapter rebuilt your
              plan without a previous baseline (likely a first-time generation
              or a goal change before the original archived). View the active
              plan on <Link href="/train" style={{ color: '#3EBD41' /* --green */ }}>/train</Link>.
            </div>
          </>
        ) : null}

        {/* Error path */}
        {data && !data.ok ? (
          <div style={{
            background: 'rgba(252,77,100,.1)',
            border: '1px solid rgba(252,77,100,.4)',
            borderRadius: 14,
            padding: 18,
            color: '#FC4D64',
            fontSize: 13,
            fontWeight: 600,
          }}>
            Couldn&rsquo;t load plan diff · {data.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SummaryChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: 'rgba(4,18,16,.4)',
      border: '1px solid rgba(255,255,255,.1)',
      borderRadius: 14,
      padding: '12px 18px',
      minWidth: 140,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
        opacity: 0.6, marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontFamily: "'Oswald',sans-serif", fontSize: 28, fontWeight: 600,
        color: color ?? '#fff', letterSpacing: '-.5px', lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  );
}
