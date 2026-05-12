/**
 * /profile · data wiring layer.
 *
 * Mirrors /log/data.ts and /health/data.ts. The page calls
 * loadProfileData() and renders directly against the returned shape.
 * All real wiring + stubs live in /api/profile/route.ts. This file
 * only re-exports wire shapes, calls the API, and provides shared
 * formatters used by the page.
 */

import type { CoachState } from '@/lib/coach-state';
import type {
  ProfileApiIdentity,
  ProfileApiKpi,
  ProfileApiLifetimePr,
  ProfileApiGoal,
  ProfileApiPref,
  ProfileApiShoeRow,
  ProfileApiConnection,
  ProfileApiVdot,
  ProfileApiHrBlock,
  ProfileApiHrZone,
  ProfileApiTier,
  ProfileApiEngineBlock,
  ProfileApiEngineDetail,
} from '../api/profile/route';

// Re-export wire shapes so /profile/page.tsx has a single module to import from.
export type {
  ProfileApiIdentity as Identity,
  ProfileApiKpi as IdentityKpi,
  ProfileApiLifetimePr as LifetimePr,
  ProfileApiGoal as Goal,
  ProfileApiPref as Pref,
  ProfileApiShoeRow as ShoeRow,
  ProfileApiConnection as Connection,
  ProfileApiVdot as Vdot,
  ProfileApiHrBlock as HrBlock,
  ProfileApiHrZone as HrZone,
  ProfileApiTier as Tier,
  ProfileApiEngineBlock as EngineBlock,
  ProfileApiEngineDetail as EngineDetail,
} from '../api/profile/route';

// ─────────────────────────────────────────────────────────────────────
// Public type — page renders against this shape
// ─────────────────────────────────────────────────────────────────────

export interface ProfileData {
  today: string;
  state: CoachState;
  identity: ProfileApiIdentity;
  lifetimePrs: ProfileApiLifetimePr[];
  newPrCount: number;
  hasPrThisYear: boolean;
  goals: ProfileApiGoal[];
  goalsActive: number;
  vdot: ProfileApiVdot;
  hrBlock: ProfileApiHrBlock;
  tier: ProfileApiTier;
  prefs: ProfileApiPref[];
  connections: ProfileApiConnection[];
  shoes: ProfileApiShoeRow[];
  shoeWarnLabel: string | null;
  engine: ProfileApiEngineBlock;
}

interface ProfileApiOk {
  ok: true;
  today: string;
  state: CoachState;
  identity: ProfileApiIdentity;
  lifetimePrs: ProfileApiLifetimePr[];
  newPrCount: number;
  hasPrThisYear: boolean;
  goals: ProfileApiGoal[];
  goalsActive: number;
  vdot: ProfileApiVdot;
  hrBlock: ProfileApiHrBlock;
  tier: ProfileApiTier;
  prefs: ProfileApiPref[];
  connections: ProfileApiConnection[];
  shoes: ProfileApiShoeRow[];
  shoeWarnLabel: string | null;
  engine: ProfileApiEngineBlock;
}

interface ProfileApiErr {
  ok: false;
  error: string;
}

type ProfileApiPayload = ProfileApiOk | ProfileApiErr;

// ─────────────────────────────────────────────────────────────────────
// Single load entry point
// ─────────────────────────────────────────────────────────────────────

export async function loadProfileData(): Promise<ProfileData> {
  const api = await fetchProfileApi();
  if (!api.ok) throw new Error(api.error || 'profile api not ok');
  return {
    today: api.today,
    state: api.state,
    identity: api.identity,
    lifetimePrs: api.lifetimePrs,
    newPrCount: api.newPrCount,
    hasPrThisYear: api.hasPrThisYear,
    goals: api.goals,
    goalsActive: api.goalsActive,
    vdot: api.vdot,
    hrBlock: api.hrBlock,
    tier: api.tier,
    prefs: api.prefs,
    connections: api.connections,
    shoes: api.shoes,
    shoeWarnLabel: api.shoeWarnLabel,
    engine: api.engine,
  };
}

async function fetchProfileApi(): Promise<ProfileApiPayload> {
  const res = await fetch('/api/profile', { cache: 'no-store' });
  if (!res.ok) throw new Error(`/api/profile ${res.status}`);
  return (await res.json()) as ProfileApiPayload;
}

// ─────────────────────────────────────────────────────────────────────
// Topbar clock formatter (shared with log/health pattern)
// ─────────────────────────────────────────────────────────────────────

export function formatTopbarClock(d: Date): string {
  const dows = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const hh = d.getHours();
  const mm = d.getMinutes();
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  return `${dows[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()} · ${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
}

// ─────────────────────────────────────────────────────────────────────
// Accent color resolver — maps wire accent names to var(--...) strings
// ─────────────────────────────────────────────────────────────────────

export function accentVar(name: string): string {
  switch (name) {
    case 'good':      return 'var(--good)';
    case 'corp':      return 'var(--corp)';
    case 'race':      return 'var(--race)';
    case 'coach':     return 'var(--coach)';
    case 'milestone': return 'var(--milestone)';
    case 'warn':      return 'var(--warn)';
    case 'xp':        return 'var(--xp)';
    case 'amber':     return 'var(--att)';
    case 'muted':     return 'var(--t3)';
    default:          return 'var(--t2)';
  }
}
