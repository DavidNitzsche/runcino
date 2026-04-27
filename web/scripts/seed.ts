/**
 * Seed the database with the Big Sur 2026 race the user has already finished.
 * Idempotent: safe to run on every deploy.
 *
 * Race row is upserted by slug; plan/actual rows are only inserted if absent
 * so re-running doesn't duplicate history.
 */

import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../lib/db/client';
import { racePlans, raceActuals } from '../lib/db/schema';
import { upsertRace, savePlan, saveActual } from '../lib/db/repo';
import type { RuncinoPlan } from '../lib/types';
import type { ActualRace } from '../lib/retrospective';

async function main() {
  const root = process.cwd();
  const planJson = JSON.parse(
    fs.readFileSync(path.join(root, 'public/big-sur-3-50.runcino.json'), 'utf-8'),
  ) as RuncinoPlan;
  const actualJson = JSON.parse(
    fs.readFileSync(path.join(root, 'fixtures/bigsur-actual.json'), 'utf-8'),
  ) as ActualRace;

  const slug = 'big-sur-2026';
  const race = await upsertRace({
    slug,
    name: planJson.race.name,
    courseSlug: 'big-sur-marathon',
    raceDate: planJson.race.date,
    status: 'completed',
    goalFinishS: planJson.goal.finish_time_s,
    notes: 'First race wired through Runcino. Real Garmin data + retrospective.',
  });
  console.log(`[seed] race ${race.slug} (${race.id}) upserted`);

  const existingPlans = await db.select().from(racePlans).where(eq(racePlans.raceId, race.id)).limit(1);
  if (existingPlans.length === 0) {
    await savePlan(race.id, planJson);
    console.log('[seed] inserted plan');
  } else {
    console.log('[seed] plan already present, skipping');
  }

  const existingActuals = await db.select().from(raceActuals).where(eq(raceActuals.raceId, race.id)).limit(1);
  if (existingActuals.length === 0) {
    await saveActual(race.id, actualJson, 'fixture');
    console.log('[seed] inserted actual');
  } else {
    console.log('[seed] actual already present, skipping');
  }

  console.log('[seed] done');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  });
