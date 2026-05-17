/**
 * /log — fresh React port of designs/log-v4.html.
 *
 * Five sections matching approved mockup:
 *   1. Coach strip — YTD recap (left) + Strava-sync card (right)
 *   2. YTD Hero — "The Year So Far" + 4 hero stats
 *   3. Monthly Volume Chart — 12 bars, current month outlined in amber
 *   4. Year in Running heatmap — 5 rows (Jan-May), variable days
 *   5. Recent Runs — custom shoe-picker column, ordered: date · type ·
 *      name · shoes · time · miles
 *
 * Replaces the 786-line May-2026 implementation.
 */

import { redirect } from 'next/navigation';
import { Topbar } from '@/app/components';
import { ConnectBannerIsland } from '../training/ConnectBannerIsland';
import { LogRunShoePicker } from './LogRunShoePicker';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { todayISO } from '@/lib/synthetic-plan';
import './log-v4.css';

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

interface RunRow {
  id: string;
  date: string;
  dateLabel: string;
  tag: 'easy' | 'quality' | 'long' | 'race';
  tagLabel: string;
  name: string;
  sub: string;
  mi: number;
  min: number;
  pace: string;
  avgHr: number;
  shoeId: number | null;
}

interface ShoeOption {
  id: number;
  name: string;
  purposes: string[];
  color: string;
  retired: boolean;
}

async function loadLogPageData(userId: string, isLegacy: boolean): Promise<{
  recentRuns: RunRow[];
  shoes: ShoeOption[];
  totalRuns: number;
  totalMiles: number;
  longestRun: { mi: number; name: string; date: string } | null;
  peakMonth: { miles: number; month: string } | null;
  monthlyMi: number[];
  heatmapByDate: Record<string, number>;
  syncMeta: { connected: boolean; lastSyncAt: Date | null };
}> {
  // Connector status
  let syncMeta: { connected: boolean; lastSyncAt: Date | null } = { connected: false, lastSyncAt: null };
  try {
    const rows = await query<{ last_sync_at: Date | null }>(
      `SELECT last_sync_at FROM connector_tokens
       WHERE user_id = $1 AND provider = 'strava' AND disconnected_at IS NULL
       LIMIT 1`,
      [userId],
    );
    if (rows[0]) {
      syncMeta = { connected: true, lastSyncAt: rows[0].last_sync_at };
    }
  } catch {}

  // Shoes (legacy schema)
  let shoes: ShoeOption[] = [];
  try {
    const rows = await query<{ id: number; brand: string; model: string; run_types: string[]; color: string | null; retired: boolean }>(
      `SELECT id, brand, model, run_types, color, retired
       FROM shoes
       WHERE (user_uuid = $1 OR user_uuid IS NULL)
       ORDER BY retired ASC, id ASC`,
      [userId],
    );
    shoes = rows.map((r) => ({
      id: r.id, name: `${r.brand} ${r.model}`,
      purposes: r.run_types || [], color: r.color || '#2CA82F', retired: !!r.retired,
    }));
  } catch {}

  // Strava activities — pulled into the unified run feed
  let recentRuns: RunRow[] = [];
  let totalRuns = 0;
  let totalMiles = 0;
  let longestRun: { mi: number; name: string; date: string } | null = null;
  const monthlyMi = new Array(12).fill(0);
  const heatmapByDate: Record<string, number> = {};

  if (isLegacy) {
    try {
      const acts = await query<{ id: number | string; data: Record<string, unknown>; shoe_id: number | null }>(
        `SELECT id, data, shoe_id FROM strava_activities ORDER BY (data->>'date') DESC LIMIT 19`,
      );
      recentRuns = acts.map((a) => {
        const d = a.data as { name?: string; date?: string; distance_mi?: number; moving_time_sec?: number; type?: string; description?: string; avg_hr?: number };
        const mi = Number(d.distance_mi) || 0;
        const moving = Number(d.moving_time_sec) || 0;
        const paceSec = mi > 0 ? Math.round(moving / mi) : 0;
        const paceM = Math.floor(paceSec / 60);
        const paceS = paceSec % 60;
        const dateStr = d.date ?? '';
        const dt = dateStr ? new Date(dateStr + 'T00:00:00Z') : null;
        const dateLabel = dt
          ? dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
          : '';
        // Classify
        const isRace = (d.type || '').toLowerCase() === 'race';
        const tag: RunRow['tag'] = isRace ? 'race' : mi >= 12 ? 'long' : 'easy';
        const tagLabel = tag === 'race' ? 'Race' : tag === 'long' ? 'Long' : 'Easy';
        return {
          id: String(a.id), date: dateStr, dateLabel,
          tag, tagLabel,
          name: d.name || 'Untitled run',
          sub: tag === 'easy' ? 'Easy · base mileage' : tag === 'long' ? 'Long' : 'Race',
          mi: Math.round(mi * 10) / 10,
          min: Math.round(moving / 60),
          pace: paceSec > 0 ? `${paceM}:${String(paceS).padStart(2, '0')}/mi` : '—',
          avgHr: Number(d.avg_hr) || 0,
          shoeId: a.shoe_id,
        };
      });

      // Aggregate YTD
      const ytdRows = await query<{ count: string; total_mi: string; max_mi: string }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM((data->>'distance_mi')::NUMERIC), 0) AS total_mi,
                COALESCE(MAX((data->>'distance_mi')::NUMERIC), 0) AS max_mi
         FROM strava_activities
         WHERE (data->>'date') LIKE '2026-%'`,
      );
      totalRuns = parseInt(ytdRows[0]?.count ?? '0', 10);
      totalMiles = Math.round(Number(ytdRows[0]?.total_mi ?? 0));
      const maxMi = Number(ytdRows[0]?.max_mi ?? 0);
      if (maxMi > 0) {
        const longRow = await query<{ data: Record<string, unknown> }>(
          `SELECT data FROM strava_activities
           WHERE (data->>'date') LIKE '2026-%' AND (data->>'distance_mi')::NUMERIC = $1
           LIMIT 1`,
          [maxMi],
        );
        const ld = longRow[0]?.data as { name?: string; date?: string } | undefined;
        longestRun = { mi: Math.round(maxMi * 10) / 10, name: ld?.name || 'Longest run', date: ld?.date || '' };
      }

      // Monthly volume aggregation
      const monthRows = await query<{ month: string; mi: string }>(
        `SELECT SUBSTRING((data->>'date') FROM 6 FOR 2) AS month,
                COALESCE(SUM((data->>'distance_mi')::NUMERIC), 0) AS mi
         FROM strava_activities
         WHERE (data->>'date') LIKE '2026-%'
         GROUP BY month`,
      );
      monthRows.forEach((r) => {
        const m = parseInt(r.month, 10) - 1;
        if (m >= 0 && m < 12) monthlyMi[m] = Math.round(Number(r.mi));
      });

      // Heatmap — sum per date
      const heatRows = await query<{ date: string; mi: string }>(
        `SELECT (data->>'date') AS date,
                COALESCE(SUM((data->>'distance_mi')::NUMERIC), 0) AS mi
         FROM strava_activities
         WHERE (data->>'date') LIKE '2026-%'
         GROUP BY (data->>'date')`,
      );
      heatRows.forEach((r) => { if (r.date) heatmapByDate[r.date] = Number(r.mi); });
    } catch (e) {
      console.error('[/log] data load failed', e);
    }
  }

  const peakMonthIdx = monthlyMi.indexOf(Math.max(...monthlyMi));
  const peakMonth = monthlyMi[peakMonthIdx] > 0
    ? { miles: monthlyMi[peakMonthIdx], month: MONTHS[peakMonthIdx] }
    : null;

  return {
    recentRuns, shoes, totalRuns, totalMiles, longestRun, peakMonth,
    monthlyMi, heatmapByDate, syncMeta,
  };
}

function timeAgo(d: Date | null): string {
  if (!d) return '—';
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function fmtDateShort(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function heatBucket(mi: number): string {
  if (mi <= 0)  return '';
  if (mi < 4)   return 'l1';
  if (mi < 8)   return 'l2';
  if (mi < 14)  return 'l3';
  return 'l4';
}

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
}

export default async function LogPage() {
  const auth = await getCurrentUser();
  if (!auth) redirect('/login?next=/log');

  const isLegacy = auth.email === (process.env.LEGACY_OWNER_EMAIL || 'dnitch85@me.com').toLowerCase();
  const today = todayISO();
  const todayMonthIdx = parseInt(today.slice(5, 7), 10) - 1;
  const data = await loadLogPageData(auth.id, isLegacy);

  const onPace = data.totalRuns > 0
    ? Math.round((data.totalMiles / Math.max(1, todayMonthIdx + 1)) * 12)
    : 0;

  return (
    <div className="log-v4-page">
      <Topbar activeTab="log" />
      <ConnectBannerIsland />

      <div className="page">

        {/* ── COACH STRIP ── */}
        <div className="coach-strip">
          <div className="coach-left">
            <div className="coach-label">
              <span className="dot"></span>
              YEAR TO DATE · {data.syncMeta.connected ? `STRAVA SYNCED ${timeAgo(data.syncMeta.lastSyncAt)}` : 'NO ACTIVITY SOURCE'}
            </div>
            <p className="coach-briefing">
              {data.totalRuns > 0 ? (
                <>
                  <strong>{data.totalRuns} runs · {data.totalMiles} mi</strong> through 2026 so far.{' '}
                  {data.peakMonth && <><strong>{data.peakMonth.month} peaked at {data.peakMonth.miles} mi</strong>.</>}{' '}
                  {data.longestRun && <>Longest run was <strong>{data.longestRun.name}</strong> at {data.longestRun.mi} mi.</>}
                </>
              ) : (
                <>No runs logged yet. Connect Strava or log a run manually to start building your year.</>
              )}
            </p>
          </div>

          <div className="strava-card">
            <div className="strava-label">Sync</div>
            <div className="strava-status">
              <span className="strava-dot" style={{ background: data.syncMeta.connected ? 'var(--green)' : 'var(--t3)' }}></span>
              <span className="strava-text">{data.syncMeta.connected ? 'Strava connected' : 'Not connected'}</span>
            </div>
            <div className="strava-sub">{data.syncMeta.connected ? `Synced ${timeAgo(data.syncMeta.lastSyncAt)}` : 'Connect to sync runs'}</div>
            <div className="strava-stats">
              <div className="strava-stat">
                <div className="strava-stat-label">YTD Runs</div>
                <div className="strava-stat-val">{data.totalRuns}</div>
              </div>
              <div className="strava-stat">
                <div className="strava-stat-label">YTD Miles</div>
                <div className="strava-stat-val">{data.totalMiles}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── YTD HERO ── */}
        <div className="hero-card">
          <div className="hero-eyebrow">2026 · Year to Date</div>
          <div className="hero-title-line">The Year So Far</div>
          <div className="hero-sub">Through {fmtDateShort(today)} · {Math.ceil((todayMonthIdx + 1) * 52 / 12)} of 52 weeks in</div>
          <div className="hero-stats">
            <div className="hero-stat">
              <div className="hero-stat-label">Total Runs</div>
              <div className="hero-stat-val">{data.totalRuns}</div>
              <div className="hero-stat-sub">
                {data.totalRuns > 0 ? <><strong>{(data.totalRuns / Math.max(1, todayMonthIdx + 1) * 12 / 52).toFixed(1)}</strong> per week avg</> : 'No runs yet'}
              </div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-label">Total Miles</div>
              <div className="hero-stat-val">{data.totalMiles}<span className="unit">mi</span></div>
              <div className="hero-stat-sub">
                {data.totalRuns > 0 ? <>On pace for <strong>{onPace.toLocaleString()} mi</strong></> : '—'}
              </div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-label">Longest Run</div>
              <div className="hero-stat-val">{data.longestRun?.mi ?? '—'}{data.longestRun && <span className="unit">mi</span>}</div>
              <div className="hero-stat-sub">{data.longestRun ? <><strong>{data.longestRun.name}</strong> · {fmtDateShort(data.longestRun.date)}</> : '—'}</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-label">Peak Month</div>
              <div className="hero-stat-val">{data.peakMonth?.miles ?? '—'}{data.peakMonth && <span className="unit">mi</span>}</div>
              <div className="hero-stat-sub">{data.peakMonth ? <><strong>{data.peakMonth.month}</strong></> : '—'}</div>
            </div>
          </div>
        </div>

        {/* ── MONTHLY VOLUME ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Monthly Volume</div>
              <div className="card-sub">{data.totalRuns > 0 ? 'Real Strava history · current month outlined in amber' : 'Connect Strava to see monthly totals'}</div>
            </div>
            {data.peakMonth && (
              <div className="card-meta">Peak <strong>{data.peakMonth.month} · {data.peakMonth.miles} mi</strong></div>
            )}
          </div>
          <div className="monthly-bars">
            {data.monthlyMi.map((mi, i) => {
              const maxMi = Math.max(...data.monthlyMi, 1);
              const height = mi > 0 ? Math.max(8, (mi / maxMi) * 100) : 8;
              const isPeak = data.peakMonth && i === MONTHS.indexOf(data.peakMonth.month);
              const isCurrent = i === todayMonthIdx;
              const cls = `month-bar ${isPeak ? 'peak' : 'cool'} ${isCurrent ? 'current' : ''}`;
              return (
                <div key={i} className={cls} style={mi > 0 ? { height: `${height}%` } : { height: '8%', background: 'rgba(13,15,18,.05)' }}>
                  {mi > 0 && (
                    <span className="month-bar-val">
                      {mi}{isPeak ? ' ↑' : ''}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="month-axis">
            {MONTHS.map((m, i) => (
              <span key={m} className={`month-tick ${i === todayMonthIdx ? 'current' : ''}`}>{m}</span>
            ))}
          </div>
          <div style={{ height: 28 }}></div>
        </div>

        {/* ── YEAR HEATMAP ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Year in Running</div>
              <div className="card-sub">Each square is a calendar day · color = miles run</div>
            </div>
            <div className="card-meta">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(44,168,47,.20)' }}></span> 1–4 mi
                <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(44,168,47,.45)', marginLeft: 8 }}></span> 4–8
                <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(44,168,47,.70)', marginLeft: 8 }}></span> 8–14
                <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(232,93,38,.75)', marginLeft: 8 }}></span> 14+
              </span>
            </div>
          </div>
          <div className="year-heat">
            {Array.from({ length: 5 }, (_, m) => {
              const dim = daysInMonth(2026, m);
              return (
                <div key={m} className="heat-row">
                  <div className="heat-month">{MONTHS[m]}</div>
                  <div className="heat-cells" style={{ gridTemplateColumns: `repeat(${dim}, var(--heat-cell))` }}>
                    {Array.from({ length: dim }, (_, d) => {
                      const iso = `2026-${String(m + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;
                      const isFuture = iso > today;
                      const isToday = iso === today;
                      const mi = data.heatmapByDate[iso] || 0;
                      const classes = ['heat-cell'];
                      if (isFuture) classes.push('future');
                      else { const b = heatBucket(mi); if (b) classes.push(b); }
                      if (isToday) classes.push('is-today');
                      return (
                        <div
                          key={d}
                          className={classes.join(' ')}
                          title={isToday && mi <= 0 ? 'Today · no run logged' : iso + (mi > 0 ? ` · ${mi} mi` : isFuture ? ' · upcoming' : ' · rest')}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RECENT RUNS ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Recent Runs</div>
              <div className="card-sub">
                <strong>Last {data.recentRuns.length} activities</strong> · pulled from Strava · shoes read from /profile
              </div>
            </div>
          </div>
          <div>
            {data.recentRuns.length === 0 ? (
              <div style={{ padding: '40px 28px', textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 13, color: 'rgba(13,15,18,.55)' }}>
                No runs logged yet. Connect Strava or log manually to start your feed.
              </div>
            ) : (
              data.recentRuns.map((r) => (
                <div key={r.id} className="run-row" data-run-id={r.id}>
                  <div className="run-date">{r.dateLabel}</div>
                  <span className={`run-tag ${r.tag}`}>{r.tagLabel}</span>
                  <div>
                    <div className="run-name">{r.name}</div>
                    <div className="run-type">{r.sub}</div>
                  </div>
                  <div className="run-shoe-wrap" data-run-id={r.id}>
                    <LogRunShoePicker
                      runId={r.id}
                      currentShoeId={r.shoeId}
                      shoes={data.shoes.filter((s) => !s.retired)}
                    />
                  </div>
                  <div>
                    <div className="run-num">{r.min}<span style={{ fontSize: 12, color: 'var(--t2)' }}>min</span></div>
                    <div className="run-num-unit">avg {r.avgHr || '—'} HR</div>
                  </div>
                  <div>
                    <div className="run-num">{r.mi}<span style={{ fontSize: 12, color: 'var(--t2)' }}>mi</span></div>
                    <div className="run-num-unit">{r.pace}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
