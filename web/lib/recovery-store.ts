import { query } from './db';

// ── Service catalogue ────────────────────────────────────────────────────────

export type ServiceKey =
  | 'cryo'
  | 'led'
  | 'float'
  | 'sauna_30'
  | 'sauna_60'
  | 'contrast_30'
  | 'contrast_60'
  | 'massage_60'
  | 'iv_invigorate'
  | 'iv_balance'
  | 'iv_turbo'
  | 'iv_pause'
  | 'iv_defense'
  | 'iv_radiate'
  | 'iv_recover'
  | 'iv_hydrate';

export interface Service {
  key: ServiceKey;
  name: string;
  credits: number;
  /** Primary use cases — a service can serve multiple purposes */
  use: Array<'recovery' | 'performance' | 'maintenance'>;
  tags: string[];
  description: string;
}

export const SERVICES: Record<ServiceKey, Service> = {
  cryo:          { key: 'cryo',          name: 'Cryotherapy',          credits: 1, use: ['recovery', 'performance'],            tags: ['inflammation', 'quick'],         description: 'Whole-body cold — reduce inflammation, stimulate circulation' },
  led:           { key: 'led',           name: 'LED Light Bed',        credits: 1, use: ['maintenance', 'recovery'],            tags: ['cellular', 'atp'],               description: 'Full-body red/near-IR light — cellular repair + ATP production' },
  float:         { key: 'float',         name: 'Float Therapy',        credits: 3, use: ['recovery', 'maintenance'],            tags: ['mental', 'passive-recovery'],    description: 'Sensory deprivation + Epsom salt — nervous system reset, mental clarity' },
  sauna_30:      { key: 'sauna_30',      name: 'Infrared Sauna 30',    credits: 3, use: ['performance', 'maintenance', 'recovery'], tags: ['heat', 'circulation', 'hormonal'], description: '30-min infrared sauna — heat adaptation, blood flow, hormonal priming' },
  sauna_60:      { key: 'sauna_60',      name: 'Infrared Sauna 60',    credits: 4, use: ['performance', 'maintenance', 'recovery'], tags: ['heat', 'circulation', 'hormonal'], description: '60-min infrared sauna — deep heat exposure for adaptation and recovery' },
  contrast_30:   { key: 'contrast_30',   name: 'Contrast 30',          credits: 4, use: ['recovery', 'performance'],            tags: ['contrast', 'circulation'],       description: 'Sauna + cold plunge 30 min — vasodilation/constriction cycle, inflammation' },
  contrast_60:   { key: 'contrast_60',   name: 'Contrast 60',          credits: 6, use: ['recovery'],                           tags: ['contrast', 'deep-recovery'],     description: 'Sauna + cold plunge 60 min — deep tissue recovery after hard efforts' },
  massage_60:    { key: 'massage_60',    name: 'Aescape Massage 60',   credits: 6, use: ['recovery', 'maintenance'],            tags: ['massage', 'tissue', 'aescape'],  description: 'Robotic precision massage 60 min — tissue work, adhesion, circulation' },
  iv_invigorate: { key: 'iv_invigorate', name: 'IV · Invigorate',      credits: 9, use: ['performance'],                        tags: ['iv', 'energy', 'pre-race'],      description: 'B12 + B vitamins — energy, focus, mental clarity. Pre-race or pre-workout priming' },
  iv_balance:    { key: 'iv_balance',    name: 'IV · Balance',         credits: 9, use: ['maintenance'],                        tags: ['iv', 'nervous-system'],          description: 'Daily essentials — nervous system regulation, general wellness' },
  iv_turbo:      { key: 'iv_turbo',      name: 'IV · Turbo',           credits: 9, use: ['recovery', 'performance'],            tags: ['iv', 'repair', 'amino-acids'],   description: 'Amino acids + B vitamins + Mg — muscle repair, strength, tissue recovery' },
  iv_pause:      { key: 'iv_pause',      name: 'IV · Pause',           credits: 9, use: ['recovery', 'maintenance'],            tags: ['iv', 'sleep', 'cortisol'],       description: 'High Mg + zinc — cortisol regulation, deep sleep, nervous system calm' },
  iv_defense:    { key: 'iv_defense',    name: 'IV · Defense',         credits: 9, use: ['maintenance'],                        tags: ['iv', 'immunity'],                description: 'Vitamin C + zinc — immune system + oxidative stress management' },
  iv_radiate:    { key: 'iv_radiate',    name: 'IV · Radiate',         credits: 9, use: ['maintenance'],                        tags: ['iv', 'collagen', 'skin'],        description: 'Vitamins + minerals for collagen production and connective tissue' },
  iv_recover:    { key: 'iv_recover',    name: 'IV · Recover',         credits: 9, use: ['recovery'],                           tags: ['iv', 'antioxidants', 'post-race'], description: 'Antioxidants + vitamins — post-race aches, oxidative damage, rebound' },
  iv_hydrate:    { key: 'iv_hydrate',    name: 'IV · Hydrate',         credits: 9, use: ['recovery', 'performance'],            tags: ['iv', 'hydration'],               description: 'Pure IV hydration — race-day prep, post-race replenishment, travel' },
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface RecoverySession {
  id: number;
  date: string;        // ISO date YYYY-MM-DD
  service: ServiceKey;
  credits: number;
  done: boolean;
  done_at: string | null;
  note: string | null;
  source: 'suggested' | 'manual';
  tied_to_run: number | null;
  tied_to_race: string | null;
  created_at: string;
}

export interface RecoveryInput {
  date: string;
  service: ServiceKey;
  note?: string;
  source?: 'suggested' | 'manual';
  tied_to_run?: number;
  tied_to_race?: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listRecovery(from: string, to: string): Promise<RecoverySession[]> {
  return query<RecoverySession>(
    `SELECT id, date::text, service, credits, done, done_at, note, source,
            tied_to_run, tied_to_race, created_at
     FROM recovery_sessions
     WHERE date >= $1 AND date <= $2
     ORDER BY date ASC, id ASC`,
    [from, to],
  );
}

export async function createRecovery(input: RecoveryInput): Promise<RecoverySession> {
  const svc = SERVICES[input.service];
  const rows = await query<RecoverySession>(
    `INSERT INTO recovery_sessions
       (date, service, credits, note, source, tied_to_run, tied_to_race)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, date::text, service, credits, done, done_at, note, source,
               tied_to_run, tied_to_race, created_at`,
    [
      input.date,
      input.service,
      svc.credits,
      input.note ?? null,
      input.source ?? 'suggested',
      input.tied_to_run ?? null,
      input.tied_to_race ?? null,
    ],
  );
  return rows[0];
}

export async function markDone(id: number, done: boolean): Promise<RecoverySession | null> {
  const rows = await query<RecoverySession>(
    `UPDATE recovery_sessions
     SET done = $1, done_at = CASE WHEN $1 THEN NOW() ELSE NULL END
     WHERE id = $2
     RETURNING id, date::text, service, credits, done, done_at, note, source,
               tied_to_run, tied_to_race, created_at`,
    [done, id],
  );
  return rows[0] ?? null;
}

export async function updateRecovery(
  id: number,
  patch: { service?: ServiceKey; note?: string },
): Promise<RecoverySession | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (patch.service !== undefined) {
    fields.push(`service = $${idx++}`, `credits = $${idx++}`);
    values.push(patch.service, SERVICES[patch.service].credits);
  }
  if (patch.note !== undefined) {
    fields.push(`note = $${idx++}`);
    values.push(patch.note);
  }

  if (fields.length === 0) return null;
  values.push(id);

  const rows = await query<RecoverySession>(
    `UPDATE recovery_sessions SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING id, date::text, service, credits, done, done_at, note, source,
               tied_to_run, tied_to_race, created_at`,
    values,
  );
  return rows[0] ?? null;
}

export async function deleteRecovery(id: number): Promise<void> {
  await query(`DELETE FROM recovery_sessions WHERE id = $1`, [id]);
}

// ── Credit accounting ────────────────────────────────────────────────────────

export interface CreditSummary {
  total: number;
  used: number;        // credits on scheduled (done or not)
  spent: number;       // credits on done sessions only
  remaining: number;   // total - used
  resetDate: string;   // next reset ISO date
}

/** Monthly budget: 34 credits, resets on the 14th. */
export function creditPeriod(today: string): { from: string; to: string; resetDate: string } {
  const d = new Date(today);
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-based

  let from: Date, to: Date, resetDate: Date;

  if (d.getDate() < 14) {
    // We're in the period that started on 14th of previous month
    const prevMonth = m === 0 ? 11 : m - 1;
    const prevYear  = m === 0 ? y - 1 : y;
    from      = new Date(prevYear, prevMonth, 14);
    resetDate = new Date(y, m, 14);
    to        = new Date(resetDate.getTime() - 86400000); // day before reset
  } else {
    from      = new Date(y, m, 14);
    const nextMonth = m === 11 ? 0  : m + 1;
    const nextYear  = m === 11 ? y + 1 : y;
    resetDate = new Date(nextYear, nextMonth, 14);
    to        = new Date(resetDate.getTime() - 86400000);
  }

  return {
    from:      from.toISOString().slice(0, 10),
    to:        to.toISOString().slice(0, 10),
    resetDate: resetDate.toISOString().slice(0, 10),
  };
}

export async function creditSummary(today: string): Promise<CreditSummary> {
  const MONTHLY = 34;
  const period = creditPeriod(today);

  const sessions = await listRecovery(period.from, period.to);
  const used   = sessions.reduce((s, r) => s + r.credits, 0);
  const spent  = sessions.filter(r => r.done).reduce((s, r) => s + r.credits, 0);

  return {
    total:     MONTHLY,
    used,
    spent,
    remaining: MONTHLY - used,
    resetDate: period.resetDate,
  };
}

// ── Suggestion engine ────────────────────────────────────────────────────────

export type Context =
  | { type: 'post_race';      raceSlug: string; distanceMi: number; date: string }
  | { type: 'pre_race';       raceSlug: string; date: string }
  | { type: 'post_long';      distanceMi: number; date: string }
  | { type: 'post_quality';   date: string }   // tempo / intervals
  | { type: 'post_easy';      date: string }
  | { type: 'rest_day';       date: string }
  | { type: 'recovery_week';  date: string };

interface Suggestion {
  service: ServiceKey;
  reason: string;
  priority: number;  // 1 = highest
}

export function suggestRecovery(ctx: Context, budgetRemaining: number): Suggestion[] {
  const svc = (key: ServiceKey, reason: string, priority: number): Suggestion =>
    ({ service: key, reason, priority });

  const affordable = (key: ServiceKey) => SERVICES[key].credits <= budgetRemaining;

  switch (ctx.type) {
    case 'post_race': {
      const suggestions: Suggestion[] = [];
      // Marathon+ → contrast 60 + IV Turbo or Recover
      if (ctx.distanceMi >= 26) {
        if (affordable('contrast_60')) suggestions.push(svc('contrast_60', 'Deep recovery after marathon — full contrast session', 1));
        else if (affordable('contrast_30')) suggestions.push(svc('contrast_30', 'Contrast therapy post-race', 1));
        if (affordable('iv_recover')) suggestions.push(svc('iv_recover', 'IV · Recover — antioxidants + aches post-marathon', 2));
        else if (affordable('iv_turbo')) suggestions.push(svc('iv_turbo', 'IV · Turbo — tissue repair post-marathon', 2));
      } else {
        // Half / shorter
        if (affordable('contrast_30')) suggestions.push(svc('contrast_30', 'Contrast therapy post-race', 1));
        if (affordable('iv_turbo')) suggestions.push(svc('iv_turbo', 'IV · Turbo — repair after race effort', 2));
        else if (affordable('cryo')) suggestions.push(svc('cryo', 'Cryo — quick inflammation reset post-race', 2));
      }
      if (affordable('float')) suggestions.push(svc('float', 'Float 2–3 days post-race for mental reset', 3));
      return suggestions;
    }

    case 'pre_race': {
      const suggestions: Suggestion[] = [];
      if (affordable('sauna_30')) suggestions.push(svc('sauna_30', 'Infrared sauna day before — heat priming + circulation', 1));
      if (affordable('iv_invigorate')) suggestions.push(svc('iv_invigorate', 'IV · Invigorate 2 days before — energy + focus priming', 2));
      if (affordable('led')) suggestions.push(svc('led', 'LED light bed — cellular prep, low-cost, easy day before', 3));
      return suggestions;
    }

    case 'post_long': {
      const suggestions: Suggestion[] = [];
      if (ctx.distanceMi >= 18) {
        if (affordable('contrast_60')) suggestions.push(svc('contrast_60', 'Contrast 60 — earned after an 18+ mile long run', 1));
        else if (affordable('contrast_30')) suggestions.push(svc('contrast_30', 'Contrast 30 post-long run', 1));
      } else {
        if (affordable('contrast_30')) suggestions.push(svc('contrast_30', 'Contrast 30 post-long run — inflammation + circulation', 1));
        else if (affordable('sauna_30')) suggestions.push(svc('sauna_30', 'Sauna post-long run', 1));
      }
      if (affordable('cryo')) suggestions.push(svc('cryo', 'Cryo same day or next morning — quick legs', 2));
      return suggestions;
    }

    case 'post_quality': {
      const suggestions: Suggestion[] = [];
      if (affordable('contrast_30')) suggestions.push(svc('contrast_30', 'Contrast 30 after quality session — flush + recover', 1));
      else if (affordable('cryo')) suggestions.push(svc('cryo', 'Cryo after workout — 1-credit inflammation reset', 1));
      if (affordable('led')) suggestions.push(svc('led', 'LED light bed — cellular repair post-workout', 2));
      return suggestions;
    }

    case 'post_easy': {
      const suggestions: Suggestion[] = [];
      if (affordable('cryo')) suggestions.push(svc('cryo', 'Cryo — quick inflammation check on easy days', 1));
      else if (affordable('led')) suggestions.push(svc('led', 'LED light bed — maintenance on easy days', 1));
      return suggestions;
    }

    case 'rest_day': {
      const suggestions: Suggestion[] = [];
      if (affordable('float')) suggestions.push(svc('float', 'Float on rest day — mental reset + passive recovery', 1));
      else if (affordable('sauna_30')) suggestions.push(svc('sauna_30', 'Sauna on rest day — circulation without stress', 1));
      if (affordable('led')) suggestions.push(svc('led', 'LED light bed — 1 credit, easy maintenance', 2));
      if (affordable('iv_pause')) suggestions.push(svc('iv_pause', 'IV · Pause — cortisol reset + sleep support on rest day', 3));
      return suggestions;
    }

    case 'recovery_week': {
      const suggestions: Suggestion[] = [];
      if (affordable('float')) suggestions.push(svc('float', 'Float during recovery week — deep passive restoration', 1));
      if (affordable('iv_pause')) suggestions.push(svc('iv_pause', 'IV · Pause — nervous system downregulation in recovery week', 2));
      if (affordable('massage_60')) suggestions.push(svc('massage_60', 'Aescape massage — tissue work during lower-load week', 3));
      if (affordable('sauna_30')) suggestions.push(svc('sauna_30', 'Sauna — gentle circulation during recovery week', 4));
      return suggestions;
    }
  }
}
