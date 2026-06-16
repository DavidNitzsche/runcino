#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env.local') });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const sql = readFileSync(
  join(__dirname, '../db/migrations/146_profile_goal_constraint_fix.sql'),
  'utf8'
);

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✓ Migration 146 applied');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('✗ Migration 146 failed:', e.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
