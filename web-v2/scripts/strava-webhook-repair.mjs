#!/usr/bin/env node
/**
 * Strava webhook repair · PREPARED, NOT RUN.
 *
 * ── What is broken ───────────────────────────────────────────────────
 * Real-time Strava sync has been dead since 2026-05-29. Strava is fine:
 * it holds subscription 347351, callback
 * https://www.faff.run/api/strava/webhook, created 2026-05-18, and it
 * has been delivering activity events the whole time. Our mirror table
 * `strava_webhook_subscriptions` is EMPTY, so the Layer-1 check in
 * app/api/strava/webhook/route.ts ("subscription_id must match a stored
 * row", shipped 2026-06-05 as the P0-3 anti-forgery fix) rejects every
 * delivery with a 200 and no processing. 68 webhook_failure rows in
 * ops_alerts, most recent today. Only the daily cron saves the data, so
 * every run lands hours late.
 *
 * ── What this script does ────────────────────────────────────────────
 * Default (no flags) · DIAGNOSE ONLY. Reads Strava's subscription list
 *   (GET /push_subscriptions — read-only, registers nothing) and the
 *   local mirror row, prints both and the plan. Changes nothing.
 *
 * --apply · ADOPT. Runs the safe repair for the state prod is actually
 *   in: a single INSERT into strava_webhook_subscriptions mirroring the
 *   subscription Strava already has (subscription_id, callback_url,
 *   verify_token). This is a LOCAL DB WRITE ONLY — it does not touch
 *   Strava, does not create anything external, and is reversible with
 *   one DELETE. Delivery resumes on the next activity, with no
 *   re-handshake (Strava runs the GET handshake once, at creation).
 *
 * --create · REGISTER A NEW SUBSCRIPTION WITH STRAVA. Only needed if
 *   Strava reports NO subscription, or one pointing at the wrong
 *   callback. This is the externally-consequential path: it POSTs to
 *   Strava's /push_subscriptions, and Strava immediately GETs our
 *   callback with hub.mode/hub.verify_token/hub.challenge. If a live
 *   subscription exists it is deleted first (Strava allows one per app
 *   and cannot update a callback in place). Refuses to run unless
 *   --create is passed explicitly; will not fire on --apply.
 *
 * ── Verified before writing this ─────────────────────────────────────
 *   GET https://www.faff.run/api/strava/webhook?hub.mode=subscribe&...
 *     → 200-path reached; returns 403 {"error":"unknown verify_token"}
 *       for a bogus token, which is the correct spec behaviour. The
 *       handshake handler is implemented correctly.
 *   GET https://faff.run/api/strava/webhook (apex) → 404 "Not Found".
 *     The apex does NOT serve deep links. It is NOT the cause here —
 *     the registered callback is the www host — but any re-create MUST
 *     use www.faff.run or the handshake will 404 and Strava will refuse
 *     the subscription.
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *   node scripts/strava-webhook-repair.mjs             # diagnose
 *   node scripts/strava-webhook-repair.mjs --apply     # adopt (local write)
 *   node scripts/strava-webhook-repair.mjs --create    # register with Strava
 *
 * Env (read from web-v2/.env.local, or the process env in prod):
 *   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, DATABASE_URL
 *   STRAVA_WEBHOOK_CALLBACK       (optional; default https://www.faff.run/api/strava/webhook)
 *   STRAVA_WEBHOOK_VERIFY_TOKEN   (optional; a fresh token is minted when unset)
 *   STRAVA_WEBHOOK_SECRET_PATH    (optional; appended as ?key=… on --create)
 *
 * The decision matrix implemented here is the same one in
 * lib/strava/webhook.ts `planSubscriptionReconcile`, which is unit-tested
 * in lib/strava/webhook-reconcile.test.ts. The admin route exposes it as
 * POST /api/admin/strava-webhook { action: 'reconcile' } — that endpoint
 * is the preferred repair path in prod; this script is the offline
 * equivalent for when you have DB access but no admin session.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CALLBACK = 'https://www.faff.run/api/strava/webhook';
const STRAVA_PUSH_URL = 'https://www.strava.com/api/v3/push_subscriptions';

// ── env ──────────────────────────────────────────────────────────────
function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = readFileSync(path.join(HERE, '..', '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim();
    }
  } catch { /* prod: process env only */ }
  return env;
}

const env = loadEnv();
const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const CREATE = args.has('--create');
const callbackUrl = env.STRAVA_WEBHOOK_CALLBACK || DEFAULT_CALLBACK;

function need(k) {
  if (!env[k]) {
    console.error(`missing env ${k}`);
    process.exit(1);
  }
  return env[k];
}

// ── read Strava's truth (read-only) ──────────────────────────────────
async function listStravaSubscriptions() {
  const url = new URL(STRAVA_PUSH_URL);
  url.searchParams.set('client_id', need('STRAVA_CLIENT_ID'));
  url.searchParams.set('client_secret', need('STRAVA_CLIENT_SECRET'));
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`STRAVA_LIST_FAILED ${resp.status} ${(await resp.text()).slice(0, 300)}`);
  const json = await resp.json();
  return Array.isArray(json) ? json : [];
}

function sameCallback(a, b) {
  const norm = (u) => {
    try {
      const x = new URL(u);
      return `${x.origin}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
    } catch { return String(u).trim().replace(/\/+$/, '').toLowerCase(); }
  };
  return norm(a) === norm(b);
}

// Mirrors planSubscriptionReconcile in lib/strava/webhook.ts.
function plan(strava, local, expected) {
  const live = strava[0] ?? null;
  if (!live) {
    return local
      ? { action: 'drop_stale_local', reason: `local row names ${local.subscription_id}, Strava reports none` }
      : { action: 'create', reason: 'no subscription on either side' };
  }
  if (expected && !sameCallback(live.callback_url, expected)) {
    return {
      action: 'recreate_callback_drift',
      id: live.id,
      reason: `Strava points at ${live.callback_url}, expected ${expected}`,
    };
  }
  if (!local) {
    return { action: 'adopt', id: live.id, callback: live.callback_url, reason: 'Strava is delivering; local mirror is empty' };
  }
  if (local.subscription_id !== live.id) {
    return { action: 'adopt', id: live.id, callback: live.callback_url, reason: `local names ${local.subscription_id}, Strava delivers ${live.id}` };
  }
  return { action: 'in_sync', id: live.id, reason: 'both sides agree' };
}

// ── main ─────────────────────────────────────────────────────────────
const client = new pg.Client({
  connectionString: need('DATABASE_URL'),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  const strava = await listStravaSubscriptions();
  const local = (await client.query(
    `SELECT subscription_id, callback_url, created_at::text, events_received
       FROM strava_webhook_subscriptions ORDER BY created_at DESC LIMIT 1`
  )).rows[0] ?? null;

  console.log('\n── Strava side (GET /push_subscriptions) ──');
  console.log(strava.length ? strava : '(none)');
  console.log('\n── local mirror (strava_webhook_subscriptions) ──');
  console.log(local ?? '(empty — this is the outage state)');

  const rejected = (await client.query(
    `SELECT count(*)::int AS n, max(created_at)::text AS last
       FROM ops_alerts WHERE kind = 'webhook_failure'`
  )).rows[0];
  console.log(`\nrejected deliveries logged: ${rejected.n} (most recent ${rejected.last})`);

  const p = plan(strava, local, callbackUrl);
  console.log(`\n── plan: ${p.action} ──\n${p.reason}\n`);

  if (p.action === 'in_sync') {
    console.log('Nothing to do. If events are still being rejected, check STRAVA_WEBHOOK_SECRET_PATH');
    console.log('matches the ?key= on the registered callback URL.');
    return;
  }

  if (p.action === 'adopt') {
    const token = env.STRAVA_WEBHOOK_VERIFY_TOKEN || randomBytes(32).toString('hex');
    const sql = `INSERT INTO strava_webhook_subscriptions (subscription_id, callback_url, verify_token)
     VALUES (${p.id}, '${p.callback}', '<verify_token>')
     ON CONFLICT (subscription_id) DO UPDATE
       SET callback_url = EXCLUDED.callback_url, verify_token = EXCLUDED.verify_token;`;
    if (!APPLY) {
      console.log('DRY RUN. Re-run with --apply to execute this local write:\n');
      console.log(sql);
      console.log('\nNo Strava call is made. Reverse with:');
      console.log(`  DELETE FROM strava_webhook_subscriptions WHERE subscription_id = ${p.id};`);
      return;
    }
    await client.query(
      `INSERT INTO strava_webhook_subscriptions (subscription_id, callback_url, verify_token)
       VALUES ($1, $2, $3)
       ON CONFLICT (subscription_id) DO UPDATE
         SET callback_url = EXCLUDED.callback_url, verify_token = EXCLUDED.verify_token`,
      [p.id, p.callback, token]
    );
    console.log(`adopted subscription ${p.id} → local mirror written.`);
    console.log('Next Strava activity should ingest within seconds. Verify with:');
    console.log("  SELECT * FROM strava_webhook_events ORDER BY received_at DESC LIMIT 5;");
    return;
  }

  if (p.action === 'drop_stale_local') {
    if (!APPLY) {
      console.log('DRY RUN. Re-run with --apply to delete the stale mirror row, then --create.');
      return;
    }
    await client.query(`DELETE FROM strava_webhook_subscriptions WHERE subscription_id = $1`, [local.subscription_id]);
    console.log('stale row dropped. Re-run with --create to register a new subscription.');
    return;
  }

  // create / recreate_callback_drift — the externally-consequential path.
  if (!CREATE) {
    console.log('This plan REGISTERS A WEBHOOK WITH STRAVA. Re-run with --create to proceed.');
    console.log(`It will: ${p.action === 'recreate_callback_drift' ? `DELETE Strava subscription ${p.id}, then ` : ''}` +
      `POST ${STRAVA_PUSH_URL} with callback_url=${callbackUrl}${env.STRAVA_WEBHOOK_SECRET_PATH ? '?key=<secret>' : ''}.`);
    console.log('Strava will immediately GET that URL with a hub.challenge; the route echoes it back.');
    return;
  }

  if (p.action === 'recreate_callback_drift') {
    const del = new URL(`${STRAVA_PUSH_URL}/${p.id}`);
    del.searchParams.set('client_id', env.STRAVA_CLIENT_ID);
    del.searchParams.set('client_secret', env.STRAVA_CLIENT_SECRET);
    const r = await fetch(del, { method: 'DELETE', signal: AbortSignal.timeout(10000) });
    if (!r.ok && r.status !== 404) throw new Error(`DELETE failed ${r.status} ${(await r.text()).slice(0, 200)}`);
    await client.query(`DELETE FROM strava_webhook_subscriptions WHERE subscription_id = $1`, [p.id]);
    console.log(`deleted subscription ${p.id}`);
  }

  const verifyToken = env.STRAVA_WEBHOOK_VERIFY_TOKEN || randomBytes(32).toString('hex');
  const cb = env.STRAVA_WEBHOOK_SECRET_PATH
    ? `${callbackUrl}?key=${env.STRAVA_WEBHOOK_SECRET_PATH}`
    : callbackUrl;

  // The verify_token row goes in FIRST, under the -1 pending sentinel.
  // Strava validates SYNCHRONOUSLY: it GETs the callback with a
  // hub.challenge while holding this POST open, and our GET handler 403s
  // unless a row already carries that token. Writing the row from the
  // POST response is a handshake that can only fail — that was the bug in
  // lib/strava/webhook.ts subscribeWebhook, fixed 2026-08-17.
  const PENDING = -1;
  await client.query(
    `INSERT INTO strava_webhook_subscriptions (subscription_id, callback_url, verify_token)
     VALUES ($1, $2, $3) ON CONFLICT (subscription_id) DO UPDATE
       SET callback_url = EXCLUDED.callback_url, verify_token = EXCLUDED.verify_token`,
    [PENDING, cb, verifyToken]
  );

  const body = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    client_secret: env.STRAVA_CLIENT_SECRET,
    callback_url: cb,
    verify_token: verifyToken,
  });
  const resp = await fetch(STRAVA_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const txt = await resp.text();
  await client.query(`DELETE FROM strava_webhook_subscriptions WHERE subscription_id < 0`);
  if (!resp.ok) throw new Error(`SUBSCRIBE FAILED ${resp.status} ${txt.slice(0, 400)}`);
  const subId = Number(JSON.parse(txt)?.id);
  await client.query(
    `INSERT INTO strava_webhook_subscriptions (subscription_id, callback_url, verify_token)
     VALUES ($1, $2, $3) ON CONFLICT (subscription_id) DO UPDATE
       SET callback_url = EXCLUDED.callback_url, verify_token = EXCLUDED.verify_token`,
    [subId, cb, verifyToken]
  );
  console.log(`subscribed. subscription_id=${subId} callback=${callbackUrl}`);
}

main()
  .catch((e) => { console.error('\nFAILED:', e.message); process.exitCode = 1; })
  .finally(() => client.end().catch(() => {}));
