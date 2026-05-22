/**
 * POST /api/connectors/:provider/disconnect, soft-delete a connector.
 *
 * Sets disconnected_at = NOW() on the connector_tokens row for the
 * current user + provider. The row stays for audit/history; reconnecting
 * just clears disconnected_at via the OAuth callback.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../../lib/auth';
import { query } from '../../../../../lib/db';

const ALLOWED_PROVIDERS = new Set([
  'strava', 'garmin', 'apple_health', 'coros', 'polar', 'suunto',
  'wahoo', 'google_fit', 'final_surge', 'training_peaks', 'whoop', 'oura',
]);

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { provider } = await ctx.params;
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }

  await query(
    `UPDATE connector_tokens
     SET disconnected_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND provider = $2 AND disconnected_at IS NULL;`,
    [user.id, provider],
  );

  return NextResponse.json({ ok: true });
}
