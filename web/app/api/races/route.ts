/**
 * /api/races
 *   GET  — list every race
 *   POST — save (or overwrite) a race + its plan
 *
 * The plan body is the full RuncinoPlan JSON returned by /api/build-plan.
 * Saving the same slug appends a new plan version; the race row is
 * upserted so name/date/status stay current.
 */

import { listRaces, upsertRace, savePlan, getRaceBySlug } from '../../../lib/db/repo';
import type { RuncinoPlan } from '../../../lib/types';

type SaveBody = {
  slug: string;
  name: string;
  courseSlug: string;
  raceDate: string;
  status?: 'planned' | 'completed' | 'archived';
  notes?: string | null;
  plan: RuncinoPlan;
};

function isValidSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(s);
}

export async function GET() {
  const races = await listRaces();
  return Response.json({ races });
}

export async function POST(req: Request) {
  let body: SaveBody;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!body.slug || !isValidSlug(body.slug)) {
    return new Response('Invalid slug — use lowercase letters, digits, and hyphens (e.g. cim-2026)', { status: 400 });
  }
  if (!body.name || !body.courseSlug || !body.raceDate || !body.plan) {
    return new Response('Missing required fields: name, courseSlug, raceDate, plan', { status: 400 });
  }
  if (typeof body.plan !== 'object' || !body.plan.schema_version) {
    return new Response('plan must be a RuncinoPlan JSON object', { status: 400 });
  }

  const race = await upsertRace({
    slug: body.slug,
    name: body.name,
    courseSlug: body.courseSlug,
    raceDate: body.raceDate,
    status: body.status ?? 'planned',
    goalFinishS: body.plan.goal.finish_time_s,
    notes: body.notes ?? null,
  });
  const planRow = await savePlan(race.id, body.plan);

  return Response.json({ race, planId: planRow.id });
}

export async function HEAD(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  if (!slug) return new Response(null, { status: 400 });
  const existing = await getRaceBySlug(slug);
  return new Response(null, { status: existing ? 200 : 404 });
}
