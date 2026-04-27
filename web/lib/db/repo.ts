import { eq, desc } from 'drizzle-orm';
import { db } from './client';
import { races, racePlans, raceActuals, type Race, type RacePlanRow, type RaceActualRow } from './schema';
import type { RuncinoPlan } from '../types';
import type { ActualRace } from '../retrospective';

function id(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10)
  );
}

export type RaceStatus = 'planned' | 'completed' | 'archived';

export interface RaceWithLatest {
  race: Race;
  plan: RuncinoPlan | null;
  actual: ActualRace | null;
}

export async function listRaces(): Promise<Race[]> {
  return db.select().from(races).orderBy(desc(races.raceDate));
}

export async function getRaceBySlug(slug: string): Promise<Race | null> {
  const rows = await db.select().from(races).where(eq(races.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getRaceWithLatest(slug: string): Promise<RaceWithLatest | null> {
  const race = await getRaceBySlug(slug);
  if (!race) return null;
  const [planRow] = await db
    .select()
    .from(racePlans)
    .where(eq(racePlans.raceId, race.id))
    .orderBy(desc(racePlans.createdAt))
    .limit(1);
  const [actualRow] = await db
    .select()
    .from(raceActuals)
    .where(eq(raceActuals.raceId, race.id))
    .orderBy(desc(raceActuals.createdAt))
    .limit(1);
  return {
    race,
    plan: planRow?.plan ?? null,
    actual: actualRow?.actual ?? null,
  };
}

export interface UpsertRaceInput {
  slug: string;
  name: string;
  courseSlug: string;
  raceDate: string;
  status?: RaceStatus;
  goalFinishS?: number | null;
  notes?: string | null;
}

export async function upsertRace(input: UpsertRaceInput): Promise<Race> {
  const existing = await getRaceBySlug(input.slug);
  const now = new Date();
  if (existing) {
    const [updated] = await db
      .update(races)
      .set({
        name: input.name,
        courseSlug: input.courseSlug,
        raceDate: input.raceDate,
        status: input.status ?? existing.status,
        goalFinishS: input.goalFinishS ?? existing.goalFinishS,
        notes: input.notes ?? existing.notes,
        updatedAt: now,
      })
      .where(eq(races.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(races)
    .values({
      id: id(),
      slug: input.slug,
      name: input.name,
      courseSlug: input.courseSlug,
      raceDate: input.raceDate,
      status: input.status ?? 'planned',
      goalFinishS: input.goalFinishS ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created;
}

export async function setRaceStatus(slug: string, status: RaceStatus): Promise<Race | null> {
  const race = await getRaceBySlug(slug);
  if (!race) return null;
  const [updated] = await db
    .update(races)
    .set({ status, updatedAt: new Date() })
    .where(eq(races.id, race.id))
    .returning();
  return updated;
}

export async function savePlan(raceId: string, plan: RuncinoPlan): Promise<RacePlanRow> {
  const [row] = await db
    .insert(racePlans)
    .values({ id: id(), raceId, plan })
    .returning();
  return row;
}

export async function saveActual(
  raceId: string,
  actual: ActualRace,
  source: 'manual' | 'fixture' | 'healthkit' | 'strava',
): Promise<RaceActualRow> {
  const [row] = await db
    .insert(raceActuals)
    .values({ id: id(), raceId, source, actual })
    .returning();
  return row;
}
