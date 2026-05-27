/**
 * P43 — coach LLM usage tracking.
 *
 * One log row per generateBriefing() call. Accumulates token counts
 * across all rounds of the tool-use loop, computes USD cost from the
 * current model's pricing, writes to coach_usage.
 *
 * Pricing source: Anthropic public pricing for claude-sonnet-4-5.
 * Stored as micro-USD (1e-6) so SUM() doesn't suffer float drift.
 *
 * Updating pricing: edit MODEL_PRICING below when Anthropic posts new
 * numbers. Historic rows keep the cost computed at insert time.
 */
import { pool } from '@/lib/db/pool';

/** USD per million tokens. Update when Anthropic pricing changes. */
const MODEL_PRICING: Record<string, { input: number; output: number; cache_creation: number; cache_read: number }> = {
  'claude-sonnet-4-5-20250929': {
    input: 3.00,
    output: 15.00,
    cache_creation: 3.75,
    cache_read: 0.30,
  },
  'claude-3-5-sonnet-20241022': {
    input: 3.00,
    output: 15.00,
    cache_creation: 3.75,
    cache_read: 0.30,
  },
};
const FALLBACK = MODEL_PRICING['claude-sonnet-4-5-20250929'];

export interface UsageAccumulator {
  rounds: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export function emptyUsage(): UsageAccumulator {
  return {
    rounds: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
  };
}

/**
 * Add a single Anthropic response's usage block to the accumulator.
 * `respUsage` is the shape Anthropic.Messages.Message.usage returns.
 */
export function addRound(acc: UsageAccumulator, respUsage: any): void {
  acc.rounds += 1;
  acc.input_tokens          += Number(respUsage?.input_tokens          ?? 0);
  acc.output_tokens         += Number(respUsage?.output_tokens         ?? 0);
  acc.cache_creation_tokens += Number(respUsage?.cache_creation_input_tokens ?? 0);
  acc.cache_read_tokens     += Number(respUsage?.cache_read_input_tokens     ?? 0);
}

/** Compute USD cost in micro-cents (1e-6 USD) for the accumulated usage. */
export function computeCostMicroUsd(model: string, acc: UsageAccumulator): number {
  const p = MODEL_PRICING[model] ?? FALLBACK;
  // tokens × ($/Mtoken) × 1e6 micro-usd / 1e6 tokens = micro-usd per token
  // So: tokens × $rate = USD × 1e6 = micro-usd → tokens × rate (rate is per million)
  const inputUsd = (acc.input_tokens / 1_000_000) * p.input;
  const outputUsd = (acc.output_tokens / 1_000_000) * p.output;
  const ccUsd = (acc.cache_creation_tokens / 1_000_000) * p.cache_creation;
  const crUsd = (acc.cache_read_tokens / 1_000_000) * p.cache_read;
  return Math.round((inputUsd + outputUsd + ccUsd + crUsd) * 1_000_000);
}

/** Format a micro-usd amount as $X.XX or $X.XXXX for small values. */
export function formatUsd(microUsd: number): string {
  const usd = microUsd / 1_000_000;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export interface RecordUsageInput {
  userId: string;
  surface: string;
  mode: string;
  compact?: boolean;
  model: string;
  usage: UsageAccumulator;
  trigger_source?: string;
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const costMicroUsd = computeCostMicroUsd(input.model, input.usage);
  try {
    await pool.query(
      `INSERT INTO coach_usage
         (user_id, surface, mode, compact, model, rounds,
          input_tokens, output_tokens,
          cache_creation_tokens, cache_read_tokens,
          cost_micro_usd, trigger_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        input.userId,
        input.surface,
        input.mode,
        input.compact ?? false,
        input.model,
        input.usage.rounds,
        input.usage.input_tokens,
        input.usage.output_tokens,
        input.usage.cache_creation_tokens,
        input.usage.cache_read_tokens,
        costMicroUsd,
        input.trigger_source ?? null,
      ],
    );
  } catch (e: any) {
    // Usage logging shouldn't kill the briefing. Just warn.
    console.error('[coach/usage] insert failed:', e?.message);
  }
}

/** Roll up daily totals. Used by /api/usage. */
export async function dailyRollup(days: number = 14): Promise<{
  by_day: Array<{ date: string; briefings: number; rounds: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number }>;
  total_cost_usd: number;
}> {
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
  const total = r.reduce((a, row: any) => a + Number(row.cost_usd), 0);
  return { by_day: r as any, total_cost_usd: Math.round(total * 10000) / 10000 };
}
