import { pgTable, text, timestamp, integer, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import type { RuncinoPlan } from '../types';
import type { ActualRace } from '../retrospective';

export const races = pgTable(
  'races',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    courseSlug: text('course_slug').notNull(),
    raceDate: text('race_date').notNull(),
    status: text('status', { enum: ['planned', 'completed', 'archived'] }).notNull().default('planned'),
    goalFinishS: integer('goal_finish_s'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('races_slug_uq').on(t.slug)],
);

export const racePlans = pgTable('race_plans', {
  id: text('id').primaryKey(),
  raceId: text('race_id')
    .notNull()
    .references(() => races.id, { onDelete: 'cascade' }),
  plan: jsonb('plan').$type<RuncinoPlan>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const raceActuals = pgTable('race_actuals', {
  id: text('id').primaryKey(),
  raceId: text('race_id')
    .notNull()
    .references(() => races.id, { onDelete: 'cascade' }),
  source: text('source', { enum: ['manual', 'fixture', 'healthkit', 'strava'] }).notNull(),
  actual: jsonb('actual').$type<ActualRace>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Race = typeof races.$inferSelect;
export type RacePlanRow = typeof racePlans.$inferSelect;
export type RaceActualRow = typeof raceActuals.$inferSelect;
