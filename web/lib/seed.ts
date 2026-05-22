/**
 * Client-side seed shim.
 *
 * The real seed now lives server-side at lib/seed-server.ts and runs
 * inside /api/races (POST + GET hit it on first call). This module
 * stays as a no-op so existing page imports don't break, calling
 * seedIfNeeded() is now just a guarantee that the next /api/races
 * read will see the seeded rows, which is the whole-app default
 * already.
 */

export async function seedIfNeeded(): Promise<{ added: string[] }> {
  return { added: [] };
}
