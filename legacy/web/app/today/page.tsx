/**
 * /today · v4 TODAY page.
 *
 * Server component that loads state + runs the coach briefing, then
 * renders the page in the v4 design (see docs/coach/mockups/today-v4-2026-05-24.html).
 *
 * Layered as a NEW route — does NOT replace /overview. Once verified
 * stable in production, /overview can redirect here.
 *
 * Renderer is "dumb": maps each topic kind to a card component. All
 * decisions (what cards to show, what the coach says) live in the
 * upstream LLM call.
 */

import { requireActiveUser } from '@/lib/auth';
import { loadTodayState, type TodayState, type TodayActualRun } from '@/lib/coach/today-state';
import { generateTodayBriefing, type TodayBriefing, type TopicCard } from '@/coach/today-briefing';
import { query } from '@/lib/db';
import { Topbar } from '@/app/components';
import TodayInteractions from './TodayInteractions';
import './today-v4.css';

// Cache helpers (mirror /api/today)
interface CachePayload { briefing: TodayBriefing; computedISO: string }

async function loadOrComputeBriefing(state: TodayState): Promise<{ briefing: TodayBriefing; cached: boolean }> {
  const latestActivityIdNum = state.actualToday?.id ? Number(state.actualToday.id) : 0;
  const hit = await query<{ payload: CachePayload }>(
    `SELECT payload FROM coach_today_cache
      WHERE cache_date = $1::date AND latest_activity_id = $2::bigint
      ORDER BY computed_at DESC LIMIT 1`,
    [state.today, latestActivityIdNum],
  ).catch(() => [] as { payload: CachePayload }[]);
  if (hit[0]?.payload?.briefing) {
    return { briefing: hit[0].payload.briefing, cached: true };
  }
  const briefing = await generateTodayBriefing(state);
  await query(
    `INSERT INTO coach_today_cache (cache_date, latest_activity_id, payload, computed_at)
     VALUES ($1::date, $2::bigint, $3::jsonb, NOW())`,
    [state.today, latestActivityIdNum, JSON.stringify({ briefing, computedISO: new Date().toISOString() })],
  ).catch(() => { /* swallow */ });
  return { briefing, cached: false };
}

export default async function TodayPage() {
  const user = await requireActiveUser();
  const state = await loadTodayState(user.id);
  const { briefing } = await loadOrComputeBriefing(state);

  const stateKind = briefing.state;
  const dateLabel = formatDateLabel(state.today);

  // Readiness chip — derived from sleep, HRV, RHR; simple 0-100 scale for now.
  // (Full readiness computation lives in lib/readiness-score; this is a
  // visual chip, not a coach prescription.)
  const readinessScore = computeQuickReadiness(state);

  return (
    <div className="today-v4-page">
      <Topbar activeTab="overview" showAdmin={user.is_admin} />
      <div className="page">

        {/* App bar */}
        <div className="appbar">
          <div className="brand-left">
            <div className="brand">faff</div>
            <div className="date">{dateLabel}</div>
          </div>
          {readinessScore != null && <ReadinessChip score={readinessScore} />}
        </div>

        {/* Week strip */}
        {state.currentWeek && (
          <WeekStrip
            week={state.currentWeek}
            today={state.today}
            bankedMi={state.bankedMi}
          />
        )}

        {/* Run recap (POST-RUN only — appears above coach) */}
        {state.actualToday && (stateKind === 'post-run' || stateKind === 'partial') && (
          <RunRecap run={state.actualToday} workoutLabel={state.todayDay?.label} />
        )}

        {/* Coach voice */}
        <CoachVoice voice={briefing.voice} state={stateKind} />

        {/* Cards lane */}
        {briefing.topics.length > 0 && (
          <div className="cards-lane">
            {briefing.topics.map((t, i) => <CardRenderer key={i} topic={t} state={state} />)}
          </div>
        )}

      </div>
      {/* Client island for interactive button handlers */}
      <TodayInteractions />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────

function ReadinessChip({ score }: { score: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;
  return (
    <div className="readiness-chip" title={`Readiness ${score}`}>
      <svg viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <circle cx="22" cy="22" r={radius} fill="none" stroke="#3EBD41" strokeWidth="3"
          strokeDasharray={`${filled} ${circumference}`} strokeLinecap="round" />
      </svg>
      <div className="v">{score}</div>
    </div>
  );
}

function WeekStrip({ week, today, bankedMi }: { week: import('@/lib/coach/today-state').TodayPlanWeek; today: string; bankedMi: number }) {
  const dows = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <div className="weekstrip">
      <div className="label">
        <span>THIS WEEK · {week.phase} {(week.idx + 1)}</span>
        <span className="total">{bankedMi.toFixed(1)} / {week.plannedMi} MI</span>
      </div>
      <div className="days">
        {week.days.map((d, i) => {
          const isToday = d.date === today;
          const isRest = d.isRest || d.distanceMi === 0;
          const cls = ['d', isToday && 'today', isRest && 'rest'].filter(Boolean).join(' ');
          return (
            <div key={d.date} className={cls}>
              <div className="dow">{dows[i] ?? '?'}</div>
              <div className="mi">{isRest ? '—' : d.distanceMi.toFixed(1).replace(/\.0$/, '')}</div>
              <div className="dot" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RunRecap({ run, workoutLabel }: { run: TodayActualRun; workoutLabel?: string }) {
  const fmtTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.round(s % 60);
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
  };
  const fmtPace = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.round(s % 60)).padStart(2,'0')}`;
  };
  return (
    <div className="recap-top">
      <div className="eyebrow">
        <span>YOUR RUN</span>
        <span className="badge">COMPLETED</span>
      </div>
      {workoutLabel && <div className="label-row">{workoutLabel.toUpperCase()} · {run.distanceMi.toFixed(1)} MI</div>}
      <div className="stats">
        <div className="s dist"><div className="v">{run.distanceMi.toFixed(1)}</div><div className="u">miles</div></div>
        <div className="s pace"><div className="v">{fmtPace(run.paceSPerMi)}</div><div className="u">avg pace</div></div>
        <div className="s time"><div className="v">{fmtTime(run.movingTimeS)}</div><div className="u">moving</div></div>
      </div>
      <div className="chips">
        {run.avgHr != null && <span className="c"><span className="k">HR</span><span className="v">{Math.round(run.avgHr)}</span></span>}
        {run.avgCadence != null && <span className="c"><span className="k">CAD</span><span className="v">{Math.round(run.avgCadence)}</span></span>}
      </div>
      <a className="recap-link" href={`/runs/${run.id}`}>Splits · route · form data →</a>
    </div>
  );
}

function CoachVoice({ voice, state }: { voice: string; state: TodayBriefing['state'] }) {
  const paragraphs = voice.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return null;
  const [lead, ...rest] = paragraphs;
  // First paragraph rendered as the lead (large display); rest as body
  return (
    <div className="coach">
      <div className="eyebrow">COACH{state ? ' · ' + state.replace('-', ' ').toUpperCase() : ''}</div>
      <h2 className="lead">{lead}</h2>
      {rest.map((p, i) => <p key={i} dangerouslySetInnerHTML={{ __html: renderInline(p) }} />)}
      {state === 'post-run' || state === 'partial' ? (
        <>
          <div className="ask">How are the legs?</div>
          <div className="reply">
            <button className="reply-chip solid"   data-action="reply" data-feel="solid">SOLID</button>
            <button className="reply-chip tired"   data-action="reply" data-feel="tired">TIRED</button>
            <button className="reply-chip wrecked" data-action="reply" data-feel="wrecked">WRECKED</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// Render **bold** inline within a paragraph
function renderInline(text: string): string {
  // very light markdown — only **strong**
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c] ?? c);
}

// ─────────────────────────────────────────────────────────────────────
// Card renderers (one per kind)
// ─────────────────────────────────────────────────────────────────────

function CardRenderer({ topic, state }: { topic: TopicCard; state: TodayState }) {
  switch (topic.kind) {
    case 'cadence_experiment': return <CadenceCard t={topic} />;
    case 'sleep_deficit':      return <SleepCard t={topic} state={state} />;
    case 'next_workout':       return <NextWorkoutCard t={topic} />;
    case 'profile_gap':        return <ProfileGapCard t={topic} />;
    case 'fun_fact':           return <FunFactCard t={topic} />;
    case 'weight_trend':       return <WeightTrendCard t={topic} />;
    case 'race_horizon':       return <RaceHorizonCard t={topic} />;
    case 'recovery_amber':     return <RecoveryAmberCard t={topic} />;
    default: return null;
  }
}

function CadenceCard({ t }: { t: Extract<TopicCard, { kind: 'cadence_experiment' }> }) {
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: 'var(--dist)' }}>TRY · CADENCE BUMP</div>
      <div className="cadence-numbers">
        <span className="cur">{t.current_spm}</span>
        <span className="arrow">→</span>
        <span className="tgt">{t.target_spm}</span>
        <span className="unit">SPM</span>
      </div>
      <div className="card-reason">{t.reason}</div>
      <button className="card-cta" data-action="lock-in-cadence" data-target-spm={t.target_spm}>{t.action_label || 'Lock in for tomorrow'}</button>
      {t.coach_note && <div className="coach-note">{t.coach_note}</div>}
    </div>
  );
}

function SleepCard({ t, state }: { t: Extract<TopicCard, { kind: 'sleep_deficit' }>; state: TodayState }) {
  const nights = state.sleepNights.slice(0, 7).reverse(); // chronological MON→SUN
  const max = 9; // scale bars to 9h cap
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: 'var(--goal)' }}>SLEEP · LAST 7 NIGHTS</div>
      <div className="sleep-row">
        <span className="big">{t.avg7n_h.toFixed(1)}h</span>
        <span className="sub">7-NIGHT AVG · last night <span className="v">{t.last_night_h.toFixed(1)}h</span></span>
      </div>
      <div className="sleep-bars">
        {nights.map((n, i) => (
          <div key={i} className="bar" style={{ height: `${Math.min(100, (n.hours / max) * 100)}%` }}>
            <span className="h">{n.hours.toFixed(1)}</span>
          </div>
        ))}
      </div>
      <div className="sleep-dows"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span></div>
      <div className="sleep-summary"><span className="deficit">About {t.deficit_7n_h.toFixed(0)}h of sleep debt this week.</span></div>
      {t.coach_note && <div className="coach-note">{t.coach_note}</div>}
    </div>
  );
}

function NextWorkoutCard({ t }: { t: Extract<TopicCard, { kind: 'next_workout' }> }) {
  const isTomorrow = t.date === isoAddDays(todayISO(), 1);
  const whenLabel = isTomorrow ? `UP NEXT · TOMORROW` : `UP NEXT · ${t.dow}`;
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: 'var(--rest)' }}>{whenLabel}</div>
      <div className="next-grid">
        <div className="next-left">
          <div className="typ">{t.type.toUpperCase()}</div>
          <div className="when">{t.dow}</div>
        </div>
        <div className="next-right">
          <span className="v">{t.distance_mi.toFixed(1).replace(/\.0$/, '')}</span>
          <span className="u">MI</span>
        </div>
      </div>
      {t.coach_note && <div className="coach-note">{t.coach_note}</div>}
    </div>
  );
}

function ProfileGapCard({ t }: { t: Extract<TopicCard, { kind: 'profile_gap' }> }) {
  // Friendly field name
  const friendly: Record<string, string> = {
    height: 'Your height',
    hrmax: 'Max heart rate',
    rhr: 'Resting heart rate',
    sex: 'Your sex',
    weight: 'Your weight',
    running_history: 'Running history',
  };
  return (
    <div className="card gap">
      <div className="left">
        <div className="label">COACH NEEDS</div>
        <div className="field">{friendly[t.field] ?? t.field}</div>
        <div className="why">{t.why}</div>
      </div>
      <button className="add" data-action="add-profile-field" data-field={t.field}>+ ADD</button>
    </div>
  );
}

function FunFactCard({ t }: { t: Extract<TopicCard, { kind: 'fun_fact' }> }) {
  return (
    <div className="card fun">
      <div className="fun-head">
        <div className="fun-icon">ⓘ</div>
        <div className="fun-title">{t.title}</div>
      </div>
      <div className="fun-body">{t.explanation}</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
        {t.research_doc && <a className="fun-link" href={`/research/${t.research_doc}`}>Read the research →</a>}
        <button className="fun-link" data-action="dismiss-fun-fact" data-term={t.term} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}>Got it</button>
      </div>
    </div>
  );
}

function WeightTrendCard({ t }: { t: Extract<TopicCard, { kind: 'weight_trend' }> }) {
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: 'var(--ink)' }}>WEIGHT TREND · 30 DAYS</div>
      <div className="weight-row">
        <span className="big">{t.current_lb.toFixed(1)}<span style={{ fontSize: 14, color: 'var(--mute)', marginLeft: 4 }}>lb</span></span>
        <span className={`delta ${t.direction}`}>{t.delta_lb_30d >= 0 ? '+' : ''}{t.delta_lb_30d.toFixed(1)} lb</span>
      </div>
      {t.coach_note && <div className="coach-note">{t.coach_note}</div>}
    </div>
  );
}

function RaceHorizonCard({ t }: { t: Extract<TopicCard, { kind: 'race_horizon' }> }) {
  const toneLabel: Record<string, string> = {
    comfortable: 'COMFORTABLE',
    building:    'BUILDING',
    tightening:  'TIGHTENING',
    race_week:   'RACE WEEK',
  };
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: 'var(--race)' }}>RACE · {toneLabel[t.tone] || t.tone.toUpperCase()}</div>
      <div className="race-grid">
        <div className="race-left">
          <div className="name">{t.name}</div>
        </div>
        <div className="race-right">
          <span className="v">{t.days_away}</span>
          <span className="u">{t.days_away === 1 ? 'DAY' : 'DAYS'}</span>
        </div>
      </div>
      {t.coach_note && <div className="coach-note">{t.coach_note}</div>}
    </div>
  );
}

function RecoveryAmberCard({ t }: { t: Extract<TopicCard, { kind: 'recovery_amber' }> }) {
  return (
    <div className="card">
      <div className="card-eyebrow" style={{ color: 'var(--goal)' }}>RECOVERY · WATCH LIST</div>
      <div className="recovery-row">
        {t.hrv_ms != null && <div className="metric"><span className="v">{Math.round(t.hrv_ms)}</span><span className="label">HRV ms</span></div>}
        {t.rhr != null && <div className="metric"><span className="v">{Math.round(t.rhr)}</span><span className="label">RESTING HR</span></div>}
      </div>
      <div className="card-reason">{t.concern}</div>
      {t.coach_note && <div className="coach-note">{t.coach_note}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getUTCDay()];
  const month = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getUTCMonth()];
  return `${dow} · ${month} ${d.getUTCDate()}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoAddDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function computeQuickReadiness(state: TodayState): number | null {
  // Coarse 0-100 from sleep avg + HRV baseline drift + check-in
  // Not the full readiness-score.ts engine; this is the chip indicator.
  const parts: number[] = [];
  const avg = state.sleepSummary.avg7nH;
  if (avg != null) parts.push(Math.max(0, Math.min(100, (avg / 8) * 100)));
  const hrv = state.recovery.hrvMs;
  if (hrv != null) parts.push(Math.max(0, Math.min(100, (hrv / 80) * 100)));
  if (state.checkIn?.energy != null) parts.push(state.checkIn.energy * 20);
  if (parts.length === 0) return null;
  return Math.round(parts.reduce((s, x) => s + x, 0) / parts.length);
}
