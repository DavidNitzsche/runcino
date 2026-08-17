'use client';

import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MESH, PHASE, type Mesh, type PhaseKey, type ViewKey } from './constants';
import type { FaffSeed } from './types';
import { Sidebar } from './Sidebar';
import { TodayView } from './views/TodayView';
import { TrainView } from './views/TrainView';
import { HealthView } from './views/HealthView';
import { TargetsView } from './views/TargetsView';
import { ActivityView } from './views/ActivityView';
import { ProfileView } from './views/ProfileView';
import { RaceView, type RaceDetailSeed } from './views/RaceView';
import { Drawer } from './overlays/Drawer';
import { WorkoutDetail } from './overlays/WorkoutDetail';
import { WeeklyCheckIn } from './overlays/WeeklyCheckIn';
import { Paywall } from './overlays/Paywall';
import { Pro } from './overlays/Pro';
import { RunDetailModal } from './overlays/RunDetailModal';

const ROUTE_TO_VIEW: Record<string, ViewKey> = {
  '/':           'today',
  '/today':      'today',
  '/training':   'train',
  '/plan':       'train',
  '/health':     'health',
  '/races':      'targets',
  '/log':        'activity',
  '/profile':    'profile',
  '/me':         'profile',
};
const VIEW_TO_ROUTE: Record<ViewKey,string> = {
  today: '/today', train: '/training', health: '/health', targets: '/races',
  race: '/races', activity: '/log', profile: '/me',
};

export function Shell({ seed, initial = 'today', raceSeed, autoOpenRunId }: { seed: FaffSeed; initial?: ViewKey; raceSeed?: RaceDetailSeed; autoOpenRunId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<ViewKey>(initial);
  const [meshOverride, setMeshOverride] = useState<Mesh | null>(null);
  const [curDay, setCurDay] = useState<number>(seed.todayIdx);
  const [sbCollapsed, setSbCollapsed] = useState(false);
  const [openOverlay, setOpenOverlay] = useState<null | 'drawer' | 'paywall' | 'pro' | 'weekci' | { type: 'wk'; i: number } | { type: 'run'; id: string }>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  // Reflect URL to view (for back/forward navigation).
  useEffect(() => {
    const v = (pathname && ROUTE_TO_VIEW[pathname]) || (pathname?.startsWith('/races/') ? 'race' : null);
    if (v && v !== view) setView(v);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore sidebar collapse state from local storage.
  useEffect(() => {
    try {
      if (localStorage.getItem('faffSb') === '1') setSbCollapsed(true);
    } catch { /* SSR safety */ }
  }, []);

  // 2026-06-05 · multi-tenant audit Pattern 3 fix · capture browser TZ on
  // every authed mount. The server's `captureTimezoneFromDevice` is silent
  // + idempotent · only writes when `profile.timezone IS NULL`, so this
  // is safe to fire on every page entry. The reason this exists at all:
  // a Strava-only web user never opens the iPhone app, never has a watch
  // sync, never hits HK ingest · so `profile.timezone` would stay NULL
  // forever and every server-side `runnerToday()` would fall back to
  // UTC · "today" off by up to 7 hours (Pacific). Gated on
  // sessionStorage so we don't spam the endpoint on every nav.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('faffTzPinged') === '1') return;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      fetch('/api/profile/timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tz }),
        // credentials default · same-origin · cookie auth flows through
      }).catch(() => { /* non-fatal · server treats null TZ as UTC */ });
      sessionStorage.setItem('faffTzPinged', '1');
    } catch { /* SSR + private-mode safety · skip silently */ }
  }, []);

  // Toast nudge ("Easy today · 4.9 mi @ 8:12") removed 2026-06-01 (David
  // call · "I dont want this little thing popping up for anything at all
  // anymore"). The same info already lives on TodayView; auto-popping it
  // as a toast read as noise. If a future surface wants a transient nudge,
  // it should be its own component with an opt-in pref, not a Shell-level
  // auto-shower.

  // /runs/[id] entry: auto-open the run detail modal on mount.
  useEffect(() => {
    if (autoOpenRunId) setOpenOverlay({ type: 'run', id: autoOpenRunId });
  }, [autoOpenRunId]);

  // 2026-05-31 (David call · "this is popping up automatically · disable"):
  // the Monday auto-open of the Weekly Check-in is removed. The recap is
  // still accessible manually via the WEEK N RECAP chip in the sidebar,
  // which mounts the same WeeklyCheckIn overlay. If a future product call
  // wants the auto-prompt back, it goes here · gate it on a real "weekly
  // recap notification" pref (profile.notification_prefs.weekly_checkin_enabled)
  // so the runner can opt in instead of getting the modal unconditionally.

  const navigate = useCallback((v: ViewKey) => {
    setView(v);
    setMeshOverride(null);
    mainRef.current?.scrollTo({ top: 0 });
    const route = VIEW_TO_ROUTE[v];
    if (route && pathname !== route) router.push(route);
  }, [router, pathname]);

  // 2026-06-04 · the per-phase Train mesh useMemo was retired here.
  // Train now uses MESH.targets (charcoal) for the page, and the
  // current-phase color lives on the .phgrid .phase cards as a gradient
  // (see TrainView.phaseMeshGradient).  Removes the yellow-flash on
  // /train load entirely · the page never starts colored.
  //
  // Compute the active mesh: per-view.
  // 2026-06-04 · David: extend the Targets neutral-charcoal mesh to the
  // Today page so the colored gradient lives on the hero card itself
  // (per workout type) rather than bathing the whole page in effort
  // color.  Keeps the page calm + reserves color for the data, same
  // pattern as the Targets rebuild.  The per-day workout color now
  // shows up as a CSS-variable-driven gradient on `.hmain` (see
  // TodayView meshGradient + globals.css).
  const mesh: Mesh = meshOverride
    ? meshOverride
    : view === 'today'
      ? MESH.targets        // shared charcoal · color lives on the hero card
      // 2026-08-17 · a PAST race joins the charcoal idiom. The race mesh is
      // anticipation — it belongs to a race that is still ahead. Once the
      // race is run, the page becomes a retrospective: a mile-by-mile
      // chart, a phase table and the WHAT IT MEANS tiles, all of which the
      // full-bleed red/maroon wash fought. The chart's gridlines and axis
      // labels are rgba-white at .04–.10 and simply vanished against it,
      // and a page-wide red reads as an alarm state for a race the runner
      // should be proud of. Same ruling the brief already applied to
      // Targets on 2026-06-04 (constants.ts MESH.targets): reserve
      // semantic colour for the data, keep the page calm. Race identity
      // survives in the hero result card, the race-red "Ran" trace, and
      // the PAST RACE eyebrow — colour on the data, not on the ground.
      // An UPCOMING race keeps the race mesh; that page is a countdown.
      : view === 'race'
        ? (raceSeed?.isPast ? MESH.targets : MESH.race)
        // 2026-06-04 · Train joins Today + Targets on charcoal · the
        // per-phase color now lives on the .phgrid .phase cards as a
        // gradient (TrainView's phaseMeshGradient helper).  Same idiom:
        // calm page, color reserved for the data.  trainPhaseMesh useMemo
        // kept above for any future use (e.g., a runner-toggleable
        // "themed background" mode) but no longer drives this view.
        : view === 'train'
          ? MESH.targets
          // 2026-06-04 · Activity also pulled to charcoal · the page's
          // colored elements (big peach→coral MI number, per-type PR
          // accents, effort-mix donut, recent-runs dots) all carry their
          // own identity already, no card-level gradient needed.  The
          // warm-tan view mesh was bathing the page in an effort color
          // for no narrative reason.
          : view === 'activity'
            ? MESH.targets
          // 2026-06-04 · Health joins the charcoal idiom · readiness
          // numbers, HRV/RHR/sleep tiles, fitness/fatigue chart all
          // carry their own semantic color (green ready / amber watch /
          // coral warn).  Bathing the whole page in teal didn't add
          // information; charcoal lets each tile's status read on its
          // own terms.
          : view === 'health'
            ? MESH.targets
            : MESH[view as Exclude<ViewKey,'today'|'race'|'train'>];

  return (
    <div
      className={`win${sbCollapsed ? ' sb-collapsed' : ''}`}
      // data-view feeds the offscreen-pause CSS rule (handoff spec §4):
      // animations only run while Today is the active view. The other
      // views still render the mesh as backdrop, but the blob loops
      // freeze so we're not burning GPU cycles on a surface no one is
      // looking at.
      data-view={view}
      // --mbase kept as an alias for back-compat with .gate-mesh (login)
      // and .win backgrounds defined in globals.css before the spec
      // moved to --base. Mesh component writes the canonical --base.
      style={{ ['--mbase' as string]: mesh[5] } as CSSProperties}
    >
      <Mesh mesh={mesh} />
      <Sidebar
        seed={seed}
        active={view}
        onNav={navigate}
        collapsed={sbCollapsed}
        onToggleCollapse={() => {
          const next = !sbCollapsed;
          setSbCollapsed(next);
          try { localStorage.setItem('faffSb', next ? '1' : '0'); } catch { /* swallow */ }
        }}
        onOpenUpsell={() => setOpenOverlay('paywall')}
      />
      <main className="main" ref={mainRef}>
        {/* 2026-05-31: auth contract change — when no faff_session cookie
            is present the SSR loaders return an emptySeed (Guest user,
            no plan, no race). Render a single sign-in panel for every
            view instead of letting each one render against the empty
            shape and produce garbage (TrainView "RACE DAY WEEK 1",
            ProfileView "Sign in renews Dec", etc.). */}
        {isGuestSeed(seed) ? (
          <GuestPanel view={view} />
        ) : <>
        {view === 'today'   && (
          <TodayView
            seed={seed}
            curDay={curDay}
            onPickDay={(i) => setCurDay(i)}
            onOpenDrawer={() => setOpenOverlay('drawer')}
            onOpenRace={() => {
              const slug = seed.goalRace?.slug;
              if (slug) router.push(`/races/${slug}`);
              else router.push('/races');
            }}
            onOpenRun={(id) => setOpenOverlay({ type: 'run', id })}
          />
        )}
        {view === 'train'    && (
          <TrainView
            seed={seed}
            onOpenDetail={(i) => {
              const day = seed.week[i];
              // Past days that have a Strava-matched run go straight to the
              // run detail modal so the user sees real splits/zones, not the
              // planned workout breakdown.
              if (day?.activityId) setOpenOverlay({ type: 'run', id: day.activityId });
              else setOpenOverlay({ type: 'wk', i });
            }}
            onOpenRun={(id) => setOpenOverlay({ type: 'run', id })}
            onMeshChange={setMeshOverride}
          />
        )}
        {view === 'health'   && <HealthView seed={seed} />}
        {view === 'targets'  && (
          <TargetsView
            seed={seed}
            onOpenRace={(slug) => router.push(`/races/${slug}`)}
          />
        )}
        {view === 'race'     && <RaceView seed={seed} race={raceSeed} onBack={() => navigate('targets')} />}
        {view === 'activity' && (
          <ActivityView
            seed={seed}
            onOpenRun={(runId) => setOpenOverlay({ type: 'run', id: runId })}
          />
        )}
        {view === 'profile'  && (
          <ProfileView
            seed={seed}
            onOpenPro={() => setOpenOverlay('pro')}
            onOpenPaywall={() => setOpenOverlay('paywall')}
          />
        )}
        </>}
      </main>

      <Drawer
        open={openOverlay === 'drawer'}
        onClose={() => setOpenOverlay(null)}
        brief={seed.readinessBrief}
        fallbackReadiness={seed.readiness}
        onViewFullHealth={() => { setOpenOverlay(null); navigate('health'); }}
      />
      {typeof openOverlay === 'object' && openOverlay?.type === 'wk' && (
        <WorkoutDetail
          open
          onClose={() => setOpenOverlay(null)}
          dayIdx={openOverlay.i}
          seed={seed}
        />
      )}
      <WeeklyCheckIn open={openOverlay === 'weekci'} onClose={() => setOpenOverlay(null)} seed={seed} />
      <Paywall open={openOverlay === 'paywall'} onClose={() => setOpenOverlay(null)} />
      <Pro open={openOverlay === 'pro'} onClose={() => setOpenOverlay(null)} />
      <RunDetailModal
        open={typeof openOverlay === 'object' && openOverlay?.type === 'run'}
        runId={typeof openOverlay === 'object' && openOverlay?.type === 'run' ? openOverlay.id : null}
        onClose={() => setOpenOverlay(null)}
      />
    </div>
  );
}

function Mesh({ mesh }: { mesh: Mesh }) {
  // Per "Effort Mesh Background" handoff spec (locked 2026-05-31): write
  // every stop as a CSS variable on the mesh container so the
  // reduced-motion fallback gradient (defined in globals.css) can read
  // the same active palette. Each blob also gets its inline background
  // so React triggers the .7s transition on per-day re-theme, but the
  // class-level `background: var(--cN)` rule stays as a no-anim
  // baseline for the prefers-reduced-motion branch.
  const meshVars = {
    ['--c1' as string]: mesh[0],
    ['--c2' as string]: mesh[1],
    ['--c3' as string]: mesh[2],
    ['--c4' as string]: mesh[3],
    ['--c5' as string]: mesh[4],
    ['--base' as string]: mesh[5],
    background: mesh[5],
  } as CSSProperties;
  return (
    <>
      <div className="mesh" style={meshVars}>
        <div className="blobs">
          <div className="blob b1" style={{ background: mesh[0] }} />
          <div className="blob b2" style={{ background: mesh[1] }} />
          <div className="blob b3" style={{ background: mesh[4] }} />
          <div className="blob b4" style={{ background: mesh[3] }} />
          <div className="blob b5" style={{ background: mesh[2] }} />
        </div>
      </div>
      <div className="grain" />
      <div className="fade" />
    </>
  );
}

/** Detect the empty/guest seed shape returned by buildSeed() when there's
 *  no faff_session cookie. emptySeed() (seed.ts) stamps user.name='Guest'
 *  AND zeroes season.weekDays — either signal alone would do, both
 *  together is unambiguous. */
function isGuestSeed(seed: FaffSeed): boolean {
  return seed.user?.name === 'Guest' && (!seed.season?.weekDays || seed.season.weekDays.length === 0);
}

/** Shown for every view when the visitor isn't signed in. Replaces the
 *  silent "default to David" fallback that the auth contract removed
 *  on 2026-05-30, and prevents each view from rendering against the
 *  empty seed shape and producing surface-specific garbage. */
function GuestPanel({ view }: { view: ViewKey }) {
  // 2026-08-17 · stale-copy fix. Web sign-in exists at /login — the old
  // "WEB SIGN-IN COMING SOON · sign in on the iPhone app" claim was false.
  const blurbs: Partial<Record<ViewKey, { title: string; body: string }>> = {
    today:     { title: 'Sign in to see today',
                 body: 'Your plan, runs, and readiness light up here once you sign in.' },
    train:     { title: 'Sign in to see your plan',
                 body: 'The training dashboard is per-runner. Sign in and your block, weeks, and key workouts populate here.' },
    health:    { title: 'Sign in to see your health',
                 body: 'Readiness, HRV, RHR, sleep, VO2 and form metrics stream in from the iPhone HealthKit pipeline once you sign in.' },
    targets:   { title: 'Sign in to see your races',
                 body: 'Goal race, projection vs goal, calendar and PRs unlock after sign-in.' },
    activity:  { title: 'Sign in to see your log',
                 body: 'Activity heatmap, recent runs and aggregates follow your runner-id.' },
    profile:   { title: 'Sign in to see your profile',
                 body: 'Shoe garage, connections, units and preferences are per-runner.' },
    race:      { title: 'Sign in to see this race',
                 body: 'Race detail is keyed to your account.' },
  };
  const copy = blurbs[view] ?? blurbs.today!;
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center',
    }}>
      <div style={{
        fontFamily: 'Oswald,sans-serif', fontSize: 48, fontWeight: 600, letterSpacing: '-0.5px',
        textTransform: 'uppercase', lineHeight: 1, marginBottom: 14,
      }}>
        {copy.title}
      </div>
      <div style={{
        maxWidth: 480, fontSize: 15, fontWeight: 500, lineHeight: 1.55,
        color: 'rgba(255,255,255,0.78)', marginBottom: 26,
      }}>
        {copy.body}
      </div>
      <a
        href="/login"
        style={{
          fontSize: 12, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase',
          color: '#10131A', background: 'rgba(255,206,138,0.92)', textDecoration: 'none',
          borderRadius: 10, padding: '10px 22px', marginBottom: 12,
        }}
      >
        Sign in
      </a>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
        Same account as the iPhone app.
      </div>
    </div>
  );
}

/** ISO week number (1-53). Used as a per-week dismissal key for the
 *  Monday weekly check-in pop-up. */
function isoWeekNumber(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Set to Thursday of the same ISO week (Mon = 1 ... Sun = 7).
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
