/**
 * usage.ts — historical-read-only shim.
 *
 * 2026-05-28 · Cardinal Rule #1 (PROJECT.md): "Zero LLM · anywhere ·
 * ever." The LLM token-tracking machinery is retired. We KEEP
 * `dailyRollup` so /usage and /api/usage still render historical
 * spend rows (now frozen — the `coach_usage` table will never see a
 * new row from this app).
 *
 * Anthropic pricing constants and the per-call recording path are
 * deleted (they only made sense while the engine was firing). The
 * existing rows continue to read normally.
 */
import { pool } from '@/lib/db/pool';

/** Roll up daily totals from the historical `coach_usage` table. Used
 *  by /api/usage + /usage to render the spend chart. After the
 *  2026-05-28 LLM rip this only ever returns rows from BEFORE the
 *  rip — nothing new is being written. */
export async function dailyRollup(days: number = 14): Promise<{
  by_day: Array<{ date: string; briefings: number; rounds: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number }>;
  total_cost_usd: number;
}> {
  try {
    const r = (await pool.query(
      `SELECT generated_at::date::text AS date,
              COUNT(*)::int AS briefings,
              SUM(rounds)::int AS rounds,
              SUM(input_tokens)::int AS input_tokens,
              SUM(output_tokens)::int AS output_tokens,
              SUM(cache_read_tokens)::int AS cache_read_tokens,
              (SUM(cost_micro_usd) / 1000000.0)::float AS cost_usd
         FROM coach_usage
        WHERE generated_at >= NOW() - $1::int * interval '1 day'
        GROUP BY generated_at::date
        ORDER BY generated_at::date DESC`,
      [days],
    )).rows;
    const total = r.reduce((a, row: any) => a + Number(row.cost_usd ?? 0), 0);
    return { by_day: r as any, total_cost_usd: Math.round(total * 10000) / 10000 };
  } catch {
    // Table missing or query failed — return empty historical view.
    return { by_day: [], total_cost_usd: 0 };
  }
}
