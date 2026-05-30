/**
 * Seed system-doctrine rows into learn_articles.
 *
 * Each rule from docs/SYSTEM_DOCTRINE.md becomes one row with
 * eyebrow='SYSTEM DOCTRINE'. Citation paths in the body link back to the
 * source-of-truth file (CLAUDE.md section, code path, or Research file).
 *
 * Every client (web, iOS) reads these via GET /api/learn/[slug] and
 * surfaces them in the in-app reader. Coach engine continues to read
 * doctrine from /Research/*.md directly — these rows are the
 * runner-facing summary, not the engine's retrieval source.
 *
 * Idempotent via ON CONFLICT (slug) DO UPDATE.
 */
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const articles = [
  // ── 1 · Data-handling rules ──
  {
    slug: 'doctrine-race-data-source-of-truth',
    title: 'Race data source of truth',
    body: `Race finish times are read from three sources, in order: (1) <code>races.actual_result.finishS</code> — the curated chip time, which is canonical; (2) <code>races.meta.finishTime</code> — legacy stored time; (3) Strava activity match by date ± 1 day and distance ± 2 mi, as a provisional fallback. Strava elapsed time must never display as authoritative race performance.\n\nLocked 2026-05-19 after three bugs landed where the system pulled race times from Strava-derived sources instead of the curated chip time — the phantom 5K bug (auto-detected splits leaked into VDOT), the missing Sombrero Half (dedup-by-canonical-distance dropped the slower of two HMs), and the empty Personal Records card (read only from \`strava_activities.canonicalLabel\`).\n\nWhy this matters: chip times are official. Strava's elapsed clock includes aid stations, paused GPS, and segment-detector noise. Treating them as equivalent eroded trust in the system's own reports.`,
    citations: [
      { kind: 'doctrine', path: 'CLAUDE.md', section: 'Race-data source-of-truth (locked 2026-05-19)' },
      { kind: 'code', path: 'web-v2/lib/coach/race-header.ts', function: 'loadCurrentVdot' },
      { kind: 'code', path: 'web-v2/lib/coach/profile-state.ts', function: 'loadProfileState (VDOT block)' },
    ],
  },
  {
    slug: 'doctrine-multi-writer-jsonb',
    title: 'Multi-writer JSONB requires field-level updates',
    body: `When two or more code paths write to the same JSONB column with different field coverage, naive full-replace upserts silently erase fields the active writer doesn't know about. The pattern: \`SET column = EXCLUDED.column\` can't distinguish "writer didn't include this field" from "writer intentionally cleared this field."\n\nThe fix: <code>jsonb_set</code> (for field-level updates) or <code>CASE WHEN ... ELSE</code> (for whole-column JSONB) with a guard that preserves the existing field when the new payload doesn't carry it. Always symmetric across all writers.\n\nKnown instances at lock time: \`strava_activities.data\` splits, \`races.actual_result\` whole-column. Rule 6 of the project memory.`,
    citations: [
      { kind: 'doctrine', path: 'CLAUDE.md', section: 'Rule 6 · Multi-writer jsonb columns (locked 2026-05-19 round 5)' },
    ],
  },
  {
    slug: 'doctrine-per-finding-context-filters',
    title: 'Per-finding context filters',
    body: `When a surface aggregates N findings into a unified story, run N filter applications — one per finding. Inheritance is semantic, not automatic. The parent surface's filters describe what context distorts the whole story; each child finding asks what context distorts ITS specific observation.\n\nExample: the V5 Z2 stimulus check has a race-week suppression at the surface level. But the threshold under-reach sub-finding walks workouts independently — it has to apply its OWN race-recency filter to skip a taper workout from 3 days pre-race that looked like the symptom we surface.\n\nWhere this applies going forward: readiness scores aggregating sleep + RHR + load; weekly summaries pulling daily executions; plan adherence reports; season retrospectives.`,
    citations: [
      { kind: 'doctrine', path: 'CLAUDE.md', section: 'Per-finding context filters (locked 2026-05-19 round 4)' },
    ],
  },

  // ── 2 · Coaching rules ──
  {
    slug: 'doctrine-race-priority-system',
    title: 'Race priority system · A / B / C / training-run / hilly-excluded',
    body: `Each race carries a <code>meta.priority</code> that determines its role in the plan and its weight in fitness calculations.\n\n- <strong>A</strong> · Goal race. Trained for, tapered for, planned around. Drives the active training plan.\n- <strong>B</strong> · Supporting race. Treated as a hard tune-up. Plan adjusts for taper-lite + recovery; doesn't reset the arc.\n- <strong>C</strong> · Low-priority race. Run as training. Coach narrates as a training-effort day. Excluded from VDOT.\n- <strong>training-run</strong> · Listed but run for fun (anniversary, club run, celebration). Lower VDOT-aggregate weight (0.2× per <code>EFFORT_WEIGHTS</code> in <code>compute-vdot.ts</code>).\n- <strong>hilly-excluded</strong> · Real race result, but elevation-distorted. Excluded from VDOT aggregate so the course doesn't drag the fitness number down.\n\nThe training-run and hilly-excluded tags exist because the system's first runner surfaced these specific cases — they are now first-class for every user.`,
    citations: [
      { kind: 'code', path: 'legacy/web/lib/db.ts', section: 'data migration 2026-05-19 + 2026-05-23' },
      { kind: 'code', path: 'web-v2/lib/training/vdot.ts', function: 'bestRecentVdot priority filter' },
    ],
  },
  {
    slug: 'doctrine-vdot-computation',
    title: 'VDOT computation — sources, cap, tiebreak',
    body: `VDOT (Daniels' fitness index) is computed from real performance data, never inferred from soft signals.\n\n<strong>Cap:</strong> [30, 85] per Daniels Running Formula 4th ed. (extended through 85 by project memory). Values outside this range return null.\n\n<strong>Sources combined:</strong>\n- Race candidates: A/B-priority races in the last 180 days, with \`priority='C'\` excluded and \`hilly-excluded\` skipped.\n- Training-run candidates: runs from the last 60 days, distance ≥ 4 mi, gated on workout-type in {threshold, tempo, cruise, intervals, vo2, marathon_pace, race, time_trial, tune_up} OR average HR ≥ 80% of MaxHR. Runs on race dates are excluded so a hilly race effort doesn't sneak in as training.\n\n<strong>Tiebreak:</strong> race VDOT at face value; training VDOT - 1 point. A single real race always wins ties against a training estimate.\n\n<strong>Prediction:</strong> invert Daniels formula via binary search; predicted finish times clamp to the [30, 85] VDOT window.`,
    citations: [
      { kind: 'code', path: 'web-v2/lib/training/vdot.ts', function: 'vdotFromRace, vdotFromRun, bestRecentVdot, predictRaceTime' },
      { kind: 'doctrine', path: 'Research/01-pace-zones-vdot.md', section: 'VDOT table' },
      { kind: 'memory', path: 'project_daniels_vdot_cap.md' },
    ],
  },
  {
    slug: 'doctrine-readiness-algorithm',
    title: 'Readiness scoring algorithm',
    body: `Daily readiness is a weighted composite, 0-100, banded into four states:\n\n- Sleep · 25% · 7-night avg vs 7.5h target\n- HRV · 25% · today vs 28-day baseline\n- RHR · 20% · today vs baseline\n- Check-in · 15% · last 1-2 reply-chip ratings\n- Load (ACWR) · 15% · acute7 / chronic28 ratio (Gabbett)\n\nBands: ≥70 READY · 50-69 MODERATE · 30-49 BACK-OFF · <30 REST.\n\nEach input contributes a signed weight. The breakdown is preserved in <code>briefings.payload._state.readiness.inputs</code> so the UI can show WHY the score is what it is (e.g., "SLEEP -8 because -0.8h vs 7.5h target").\n\nPer-finding context filters apply: race-week suppression, illness/injury override, and weather distortion are applied independently to each input, not to the parent score.`,
    citations: [
      { kind: 'code', path: 'web-v2/lib/coach/readiness.ts' },
      { kind: 'doctrine', path: 'Research/15-wearable-data.md', section: 'Training load metrics + Recovery scores' },
    ],
  },
  {
    slug: 'doctrine-acwr-injury-risk',
    title: 'ACWR injury-risk threshold (Gabbett 1.5)',
    body: `The Acute-to-Chronic Workload Ratio is acute7 divided by chronic28 (mi/day averages). Values ≥ 1.5 are the elevated-injury-risk band per Gabbett's 2016 research.\n\nThe Load pillar of readiness penalizes scores in this band. Coach voice acknowledges the spike explicitly when prescribing today's session.\n\nValues < 0.8 also flag a "watch" tone (detraining / unexpected drop).`,
    citations: [
      { kind: 'doctrine', path: 'Research/00a-distance-running-training.md', section: 'ACWR' },
      { kind: 'doctrine', path: 'Research/15-wearable-data.md', section: 'Training Load Metrics' },
    ],
  },
  {
    slug: 'doctrine-plan-phases',
    title: 'Plan-builder phase structure',
    body: `Race-prep plans follow a 5-phase structure with explicit research citations:\n\n- <strong>BASE</strong> — Phase 1: Base / speed support. Establish aerobic foundation + introduce strides.\n- <strong>BUILD</strong> — Phase 2: Threshold build. Cruise intervals, tempo, marathon-pace work.\n- <strong>PEAK</strong> — Phase 3: Race-specific. Long efforts at race pace; final sharpening.\n- <strong>TAPER</strong> — Phase 4: Tapering. Volume drops, intensity preserved, freshness regained.\n- <strong>RACE_WEEK</strong> — Phase 5: Race execution. Final logistics, micro-volume, race-morning protocol.\n\nCutback weeks: every 4th week within build/peak (volume drops ~20%). Race week: final 7 days, volume drops ~50%.`,
    citations: [
      { kind: 'code', path: 'web-v2/lib/plan/generate.ts' },
      { kind: 'doctrine', path: 'Research/22-plan-templates.md' },
      { kind: 'doctrine', path: 'Research/00a-distance-running-training.md', section: '§13 Phase structure' },
    ],
  },
  {
    slug: 'doctrine-race-week-thresholds',
    title: 'Race-week mode thresholds',
    body: `Coach surface modes for the /races and /race-detail surfaces are computed from proximity to the next A-race:\n\n- <strong>building</strong> · > 60 days out · plan emphasizes consistency + long-arc volume\n- <strong>sharpening</strong> · 30-60 days out · plan adds race-specific quality\n- <strong>race-week</strong> · ≤ 7 days · volume drops, race-day machinery surfaces\n- <strong>post-race</strong> · ≤ 14 days after · recovery hero, reverse-periodization framing\n\nThe page is alive — race-week renders a different layout than building, not the same layout with new numbers.`,
    citations: [
      { kind: 'code', path: 'web-v2/lib/coach/router.ts', function: 'resolveRaces, resolveRaceDetail' },
      { kind: 'doctrine', path: 'Research/08-pacing-and-race-week.md' },
    ],
  },
  {
    slug: 'doctrine-health-watch-thresholds',
    title: 'Health watch-mode thresholds',
    body: `The /health surface flags signals via three states:\n\n- <strong>steady / green</strong> — no signals\n- <strong>watch-amber</strong> — RHR baseline + 5 bpm, OR persistent sleep deficit\n- <strong>watch-red</strong> — RHR baseline + 8 bpm AND sleep deficit ≥ 5h (illness or overtraining suspected)\n\nWhen red fires, the coach hedges hard on prescriptions and prompts the runner to assess symptoms.`,
    citations: [
      { kind: 'code', path: 'web-v2/lib/coach/router.ts', function: 'resolveHealth' },
      { kind: 'doctrine', path: 'Research/15-wearable-data.md', section: 'Spotting Illness Early' },
    ],
  },
  {
    slug: 'doctrine-notification-taxonomy',
    title: 'Notification taxonomy is closed at 7 categories',
    body: `Push categories are a closed set: <code>race_day</code>, <code>race_eve</code>, <code>weekly_checkin</code>, <code>streak</code>, <code>niggle_sick</code>, <code>skip_recovery</code>, <code>strava_reconnect</code>. Plus <code>master_enabled</code> (kill switch) + <code>quiet_hours_start</code>/<code>end</code> window.\n\nAdding a new category requires both a new pref flag AND a new APNs payload kind — never coach-decided at runtime. This keeps the runner in full control of what fires their phone.`,
    citations: [
      { kind: 'code', path: 'web-v2/lib/notifications/prefs.ts', function: 'DEFAULT_PREFS, categoryEnabled' },
      { kind: 'migration', path: 'web-v2/db/migrations/121_notifications.sql' },
    ],
  },

  // ── 3 · Engine rules ──
  {
    slug: 'doctrine-briefing-driven',
    title: 'The coach is briefing-driven, not chat-driven',
    body: `Faff produces structured briefings per (surface, mode) — never a chat thread. The runner replies via typed chips on briefing cards. There is no chat surface, no conversation history, no tool catalog, no RAG/embeddings, no pgvector.\n\nDoctrine lives as markdown files under <code>/Research/</code> and is read by the engine at runtime; the runner-facing <code>learn_articles</code> table surfaces summaries back to the in-app reader. <code>check_ins.rating + extras</code> and <code>coach_intents</code> capture runner replies for the closed loop.`,
    citations: [
      { kind: 'doctrine', path: 'docs/2026-05-30.html', section: 'READ THIS FIRST · The four layers' },
      { kind: 'doctrine', path: 'docs/coach/PHILOSOPHY.md' },
    ],
  },
  {
    slug: 'doctrine-truth-contract-prereqs',
    title: 'Truth contract — prereqs gate topics',
    body: `Every typed topic kind has a <code>prereqs(state)</code> function. Topics whose prereqs fail are filtered before the LLM ever sees them. This is what makes the coach incapable of hallucinating "your cadence is 168" when no cadence samples exist.\n\nExamples:\n- <code>cadence_experiment</code> requires <code>profile.height_cm</code> set\n- <code>race_horizon</code> requires <code>nextARace</code> not null\n- <code>run_recap</code> requires <code>latest_activity.date === today</code>\n- <code>sleep_deficit</code> requires recent <code>sleep_hours</code> samples\n\nTopics that pass prereqs are CANDIDATES; the LLM picks which actually render based on what's worth saying that morning. Topics rejected by prereqs never reach the LLM.`,
    citations: [
      { kind: 'code', path: 'web-v2/lib/topics/types.ts' },
      { kind: 'code', path: 'web-v2/lib/coach/router.ts' },
    ],
  },
  {
    slug: 'doctrine-one-voice',
    title: 'One voice — "direct" — locked',
    body: `The brand voice is honest, direct, time-aware. No hype, no exclamation marks, no emoji, no em dashes, no clichés ("you got this", "trust the process"). Voice variants (encouraging / technical) are NOT supported and not planned.\n\nThe coach addresses the runner with specificity warm ("Solid tempo this morning") and "we" / "us" framing. Names the goal by name (AFC, CIM). States intent without announcing phases ("we're going to start pushing", not "this is the build phase"). Reads meta-patterns, not just numbers.\n\nThis voice extends across every surface and every client. Watch is the exception — no coach prose on watch (numbers + prescription only).`,
    citations: [
      { kind: 'doctrine', path: 'docs/coach/PHILOSOPHY.md', section: 'Voice' },
      { kind: 'doctrine', path: 'Design/running-app-design-brief.md', section: 'Tone of voice' },
    ],
  },

  // ── 4 · Voice + UX rules ──
  {
    slug: 'doctrine-page-is-alive',
    title: 'The page is alive — state-driven composition',
    body: `The dashboard is not a fixed template with slots to fill. Composition is a function of where the runner is right now: in the season, in the week, in the day. A page rendered at race week and a page rendered 4 months out should look like cousins, not the same page with new numbers.\n\nBeats and elements promote, demote, appear, and disappear based on training state (off-season / base / build / peak / taper / race-week / race-day / post-race / injury). A countdown beat doesn't exist 4 months out. A taper beat doesn't exist in build phase. A recovery readout makes sense after a hard session, not after a rest day.\n\nThe hero is contextual, not positional. Whatever answers the most pressing question right now.`,
    citations: [
      { kind: 'doctrine', path: 'Design/running-app-design-brief.md', section: 'The page is alive' },
      { kind: 'doctrine', path: 'BuildResearch/C1-overview-and-today.md', section: 'Conditional layouts' },
    ],
  },
  {
    slug: 'doctrine-three-questions',
    title: 'The three questions, in order',
    body: `Every surface answers, in this order, glanceable in seconds:\n\n1. <strong>What should I do today?</strong> The prescription.\n2. <strong>How am I doing it?</strong> The body state — recovery, readiness, conditions for execution.\n3. <strong>How am I doing overall?</strong> The trajectory — where in the arc, on track or off.\n\nEverything else is depth available below. If a stranger looks at the page for 2 seconds and can't say what the runner is doing today + how they are doing right now + how they are doing overall, the hierarchy is wrong.`,
    citations: [
      { kind: 'doctrine', path: 'Design/running-app-design-brief.md', section: 'The three questions' },
    ],
  },
  {
    slug: 'doctrine-coach-philosophy',
    title: 'Coach philosophy — three locked principles',
    body: `<strong>1. Let the coach decide.</strong> The page is what the coach decided to show. NOT a template the coach fills in. No pre-pick rankers, no hardcoded card priority lists, no if-then-else page layouts. The coach receives rich data + relevant research excerpts + the runner's plan and history, then picks what's worth saying in voice AND which cards to surface.\n\n<strong>2. The truth contract.</strong> Never invent. If the plan says X tomorrow, the coach says X. If the coach doesn't know, the coach doesn't say. Speak qualitatively about unreliable numbers. Defer prescriptions when data-limited. Confidence calibration — hedge when guessing, state plainly when certain.\n\n<strong>3. Cards coach too.</strong> Every card except <code>fun_fact</code> and <code>profile_gap</code> carries a <code>coach_note</code> — a short coaching line. Cards extend the coach's voice; they don't replace it with widgets.\n\nThese principles hold the whole system together. Every other decision flows from them.`,
    citations: [
      { kind: 'doctrine', path: 'docs/coach/PHILOSOPHY.md', section: 'Three locked principles' },
    ],
  },
];

async function main() {
  for (const a of articles) {
    await pool.query(
      `INSERT INTO learn_articles (slug, title, eyebrow, body_md, citations_json, related_slugs, updated_ts)
       VALUES ($1, $2, 'SYSTEM DOCTRINE', $3, $4::jsonb, $5, NOW())
       ON CONFLICT (slug) DO UPDATE
       SET title = EXCLUDED.title,
           eyebrow = 'SYSTEM DOCTRINE',
           body_md = EXCLUDED.body_md,
           citations_json = EXCLUDED.citations_json,
           updated_ts = NOW()`,
      [a.slug, a.title, a.body, JSON.stringify(a.citations), []]
    );
    console.log(`✓ ${a.slug.padEnd(46)} ${a.title}`);
  }

  const total = (await pool.query(
    `SELECT eyebrow, COUNT(*)::int AS n FROM learn_articles GROUP BY eyebrow ORDER BY n DESC`
  )).rows;
  console.log('\nlearn_articles by eyebrow:');
  for (const r of total) console.log(`  ${(r.eyebrow ?? '(none)').padEnd(48)} ${r.n}`);
}

try { await main(); } catch (e) { console.error(e); process.exit(1); }
finally { await pool.end(); }
