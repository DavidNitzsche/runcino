'use client';

import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { EFF, MESH, type Mesh, type ViewKey } from './constants';
import type { FaffSeed } from './types';
import { Sidebar } from './Sidebar';
import { TodayView } from './views/TodayView';
import { TrainView } from './views/TrainView';
import { HealthView } from './views/HealthView';
import { TargetsView } from './views/TargetsView';
import { ActivityView } from './views/ActivityView';
import { ProfileView } from './views/ProfileView';
import { SpectatorView } from './views/SpectatorView';
import { RaceView, type RaceDetailSeed } from './views/RaceView';
import { Drawer } from './overlays/Drawer';
import { WorkoutDetail } from './overlays/WorkoutDetail';
import { WeeklyCheckIn } from './overlays/WeeklyCheckIn';
import { Paywall } from './overlays/Paywall';
import { Reach } from './overlays/Reach';
import { Pro } from './overlays/Pro';
import { Toast } from './Toast';
import { TweaksPanel } from './TweaksPanel';
import { RunDetailModal } from './overlays/RunDetailModal';

const ROUTE_TO_VIEW: Record<string, ViewKey> = {
  '/':           'today',
  '/today':      'today',
  '/train':      'train',
  '/training':   'train',
  '/plan':       'train',
  '/health':     'health',
  '/targets':    'targets',
  '/races':      'targets',
  '/activity':   'activity',
  '/log':        'activity',
  '/profile':    'profile',
  '/me':         'profile',
  '/spectator':  'spectator',
};
const VIEW_TO_ROUTE: Record<ViewKey,string> = {
  today: '/today', train: '/training', health: '/health', targets: '/races',
  race: '/races', activity: '/log', profile: '/me', spectator: '/spectator',
};

export function Shell({ seed, initial = 'today', raceSeed, autoOpenRunId }: { seed: FaffSeed; initial?: ViewKey; raceSeed?: RaceDetailSeed; autoOpenRunId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<ViewKey>(initial);
  const [meshOverride, setMeshOverride] = useState<Mesh | null>(null);
  const [curDay, setCurDay] = useState<number>(seed.todayIdx);
  const [sbCollapsed, setSbCollapsed] = useState(false);
  const [openOverlay, setOpenOverlay] = useState<null | 'drawer' | 'paywall' | 'reach' | 'pro' | 'weekci' | { type: 'wk'; i: number } | { type: 'run'; id: string }>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [toastVisible, setToastVisible] = useState(false);

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

  // Show the nudge toast once on first paint, hide after a few seconds.
  useEffect(() => {
    const a = setTimeout(() => setToastVisible(true), 1200);
    const b = setTimeout(() => setToastVisible(false), 6500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);

  // /runs/[id] entry: auto-open the run detail modal on mount.
  useEffect(() => {
    if (autoOpenRunId) setOpenOverlay({ type: 'run', id: autoOpenRunId });
  }, [autoOpenRunId]);

  const navigate = useCallback((v: ViewKey) => {
    setView(v);
    setMeshOverride(null);
    mainRef.current?.scrollTo({ top: 0 });
    const route = VIEW_TO_ROUTE[v];
    if (route && pathname !== route) router.push(route);
  }, [router, pathname]);

  // Compute the active mesh: per-day on Today, per-view elsewhere.
  const mesh: Mesh = meshOverride
    ? meshOverride
    : view === 'today'
      ? EFF[seed.week[curDay]?.type ?? seed.week[seed.todayIdx].type].mesh
      : view === 'race'
        ? MESH.race
        : MESH[view as Exclude<ViewKey,'today'|'race'>];

  return (
    <div
      className={`win${sbCollapsed ? ' sb-collapsed' : ''}`}
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
        onOpenRecap={() => setOpenOverlay('weekci')}
      />
      <main className="main" ref={mainRef}>
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
            onMeshChange={setMeshOverride}
          />
        )}
        {view === 'health'   && <HealthView seed={seed} />}
        {view === 'targets'  && (
          <TargetsView
            seed={seed}
            onOpenRace={(slug) => router.push(`/races/${slug}`)}
            onOpenReach={() => setOpenOverlay('reach')}
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
        {view === 'spectator'&& <SpectatorView seed={seed} onExit={() => navigate('today')} />}
      </main>

      <Drawer
        open={openOverlay === 'drawer'}
        onClose={() => setOpenOverlay(null)}
        readiness={seed.readiness}
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
      <Reach open={openOverlay === 'reach'} onClose={() => setOpenOverlay(null)} onAdd={() => setOpenOverlay(null)} />
      <Pro open={openOverlay === 'pro'} onClose={() => setOpenOverlay(null)} />
      <RunDetailModal
        open={typeof openOverlay === 'object' && openOverlay?.type === 'run'}
        runId={typeof openOverlay === 'object' && openOverlay?.type === 'run' ? openOverlay.id : null}
        onClose={() => setOpenOverlay(null)}
      />
      <Toast visible={toastVisible} onClose={() => setToastVisible(false)} title="Tempo Run today" subtitle="67° & calm. Good window around 5 pm." />
      <TweaksPanel />
    </div>
  );
}

function Mesh({ mesh }: { mesh: Mesh }) {
  return (
    <>
      <div className="mesh" style={{ background: mesh[5] }}>
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
