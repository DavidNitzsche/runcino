// Calls the actual buildWatchToday() that the production API uses.
// Loads env, sets up the user, and prints the full WatchWorkout JSON
// the watch will receive tomorrow.

import { readFileSync } from 'fs';
const env = readFileSync('/Volumes/WP/06 Claude Code/Runcino/web-v2/.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const { buildWatchToday } = await import('/Volumes/WP/06 Claude Code/Runcino/web-v2/lib/watch/build-workout.ts');
const userId = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const tomorrow = '2026-06-02';

const payload = await buildWatchToday(userId, tomorrow);
console.log(JSON.stringify(payload, null, 2));
process.exit(0);
