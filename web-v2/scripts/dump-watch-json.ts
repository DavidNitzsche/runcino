/**
 * dump-watch-json.ts — prints the literal JSON payload /api/watch/today
 * would return, for a given user + optional date override. Use this to
 * round-trip the bytes through the Swift decoder.
 *
 * Usage:
 *   npx tsx scripts/dump-watch-json.ts                                # today
 *   npx tsx scripts/dump-watch-json.ts <user-uuid> 2026-05-26         # override
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const l of readFileSync(envPath, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const USER = process.argv[2] ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DATE = process.argv[3];

async function main() {
  const { buildWatchToday } = await import('../lib/watch/build-workout');
  const payload = await buildWatchToday(USER, DATE);
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); })
      .finally(() => setTimeout(() => process.exit(0), 100));
