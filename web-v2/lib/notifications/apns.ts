/**
 * APNs sender — token-based auth (.p8) over HTTP/2.
 *
 * Source spec: docs/2026-05-28-notifications.html §6 (Apple Developer
 * setup) + §3 (payload shape) + §5 (dedup + quiet hours).
 *
 * Reads APNs credentials from env:
 *   APNS_KEY_ID         — 10-char Apple Key ID (visible in developer portal)
 *   APNS_TEAM_ID        — 10-char Apple Team ID (membership page)
 *   APNS_BUNDLE_ID      — run.faff.app (matches native-v2/project.yml:73)
 *   APNS_KEY_PEM        — inline PEM (preferred; safe in Railway env)
 *   APNS_KEY_PATH       — fallback file path (local dev)
 *   APNS_PRODUCTION     — '1' to hit api.push.apple.com; else sandbox
 *
 * JWT cached for 50 min (Apple permits up to 60; we expire early so the
 * sender never sends with a stale JWT).
 *
 * Quiet hours: respected for every category EXCEPT race_day (deck §A).
 * The sender DOES NOT make the schedule decision — the scheduler decides
 * when to fire and passes bypass_quiet_hours. The sender's quiet-hours
 * check is a belt-and-braces gate on top.
 *
 * Logs every attempt to notifications_log via the caller — this module
 * is the wire-level send. The caller writes the row, calls sendPush,
 * then updates the row with the apns-id + delivered flag.
 *
 * Graceful degradation: if APNS_KEY_PEM / APNS_KEY_PATH are unset, every
 * sendPush returns { ok: false, reason: 'apns_not_configured' } without
 * throwing. The /api/cron route logs + drops, no crash. The user has to
 * set up the cert before any push actually fires — that's an operations
 * step documented in OPERATIONS.md §5.
 */

import crypto from 'crypto';
import fs from 'fs';
import http2 from 'http2';

// ──────────────────────────────────────────────────────────────
// 1. Categories — matches docs/2026-05-28-notifications.html
// ──────────────────────────────────────────────────────────────

export type NotificationCategory =
  | 'race_day'
  | 'race_eve'
  | 'skip_recovery'
  | 'weekly_checkin'
  | 'niggle_sick'
  | 'streak'
  | 'strava_reconnect';

/** UNNotificationCategory identifier the iOS app registers — must match the
 *  string the iOS NotificationCategories.swift uses in setNotificationCategories. */
export function apnsCategoryId(c: NotificationCategory): string {
  switch (c) {
    case 'race_day':         return 'FAFF_RACE_DAY';
    case 'race_eve':         return 'FAFF_RACE_EVE';
    case 'skip_recovery':    return 'FAFF_SKIP_RECOV';
    case 'weekly_checkin':   return 'FAFF_WEEKLY';
    case 'niggle_sick':      return 'FAFF_NIGGLE';
    case 'streak':           return 'FAFF_MILESTONE';
    case 'strava_reconnect': return 'FAFF_STRAVA_RECON';
  }
}

// ──────────────────────────────────────────────────────────────
// 2. JWT — ES256 signed with the .p8 key, cached for 50 min
// ──────────────────────────────────────────────────────────────

interface JwtCache {
  token: string;
  expires_at: number;
}
let jwtCache: JwtCache | null = null;
const JWT_TTL_MS = 50 * 60 * 1000;

function loadKeyPem(): string | null {
  const inline = process.env.APNS_KEY_PEM;
  if (inline && inline.includes('BEGIN PRIVATE KEY')) return inline;
  const path = process.env.APNS_KEY_PATH;
  if (path) {
    try {
      return fs.readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }
  return null;
}

/** Sign an ES256 JWT with the loaded .p8 key. Returns null when creds are
 *  missing; the sender treats that as "APNs not configured" and degrades. */
function signJwt(): string | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const pem = loadKeyPem();
  if (!keyId || !teamId || !pem) return null;

  // Cache hit — return existing JWT if still valid.
  if (jwtCache && jwtCache.expires_at > Date.now()) return jwtCache.token;

  const header = { alg: 'ES256', kid: keyId };
  const claims = { iss: teamId, iat: Math.floor(Date.now() / 1000) };
  const b64u = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${b64u(header)}.${b64u(claims)}`;

  let signature: string;
  try {
    const sign = crypto.createSign('SHA256');
    sign.update(signingInput);
    sign.end();
    // ec keys from Apple emit DER; convert to JOSE (R||S concat).
    const der = sign.sign({ key: pem });
    signature = derToJose(der).toString('base64url');
  } catch (err) {
    console.error('[apns] JWT sign failed:', (err as Error).message);
    return null;
  }

  const token = `${signingInput}.${signature}`;
  jwtCache = { token, expires_at: Date.now() + JWT_TTL_MS };
  return token;
}

/** Convert an EC DER signature to the IEEE-P1363 / JOSE flat format APNs
 *  expects. DER is { r-length, r-bytes, s-length, s-bytes }; JOSE is R||S
 *  with each padded to 32 bytes for ES256. */
function derToJose(der: Buffer): Buffer {
  // DER: 0x30 <total-len> 0x02 <r-len> <r> 0x02 <s-len> <s>
  let offset = 2; // skip 0x30 + total len byte (or 0x81 + 2nd byte; handled below)
  if (der[1] & 0x80) {
    // Long-form length — total-len = next (der[1] & 0x7f) bytes
    offset += der[1] & 0x7f;
  }
  if (der[offset] !== 0x02) throw new Error('DER: expected 0x02 for r');
  const rLen = der[offset + 1];
  let r: Buffer = Buffer.from(der.slice(offset + 2, offset + 2 + rLen));
  offset = offset + 2 + rLen;
  if (der[offset] !== 0x02) throw new Error('DER: expected 0x02 for s');
  const sLen = der[offset + 1];
  let s: Buffer = Buffer.from(der.slice(offset + 2, offset + 2 + sLen));

  // Strip leading 0x00 if present (DER positivity guard); left-pad to 32.
  const trim = (b: Buffer): Buffer => {
    while (b.length > 32 && b[0] === 0x00) b = Buffer.from(b.slice(1));
    if (b.length < 32) {
      const pad = Buffer.alloc(32 - b.length, 0);
      b = Buffer.concat([pad, b]);
    }
    return b;
  };
  r = trim(r);
  s = trim(s);
  return Buffer.concat([r, s]);
}

// ──────────────────────────────────────────────────────────────
// 3. HTTP/2 session — reused across pushes within the same call
// ──────────────────────────────────────────────────────────────

/** Exported for the cron health probe (RK-6) — the GET handler reports
 *  which host a send WOULD hit so a 400 BadDeviceToken is diagnosable as
 *  a host mismatch from the DB + probe alone. TestFlight + App Store both
 *  register PRODUCTION tokens (production provisioning profile); only
 *  Xcode-debug installs register sandbox tokens. */
export function apnsHost(): string {
  return process.env.APNS_PRODUCTION === '1'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
}

// ──────────────────────────────────────────────────────────────
// 4. Quiet hours gate — runner's local prefs
// ──────────────────────────────────────────────────────────────

/** Returns true if `now` (in the runner's tz) falls within
 *  [quiet_hours_start, quiet_hours_end). Handles cross-midnight ranges
 *  (e.g. 22:00 → 06:00). Templates that must wake the runner (race_day)
 *  set bypass_quiet_hours=true and the dispatcher skips this gate.
 *
 *  Takes an IANA timezone name ('America/Los_Angeles'), resolved the
 *  same way the cron route resolves it (profile.timezone via
 *  lib/runtime/runner-tz). Was offset-minutes based; rewritten when the
 *  gate got its first caller (dispatchNotification, RK-5/M-21) since
 *  the rest of the system already standardized on Intl + IANA names
 *  (backend audit P0-10). */
export function isInQuietHours(
  now: Date,
  tz: string,
  startHm: string,
  endHm: string,
): boolean {
  let minutes: number;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
    });
    const parts = fmt.formatToParts(now);
    const get = (t: string): number =>
      Number(parts.find((p) => p.type === t)?.value ?? '0') || 0;
    minutes = (get('hour') % 24) * 60 + get('minute');
  } catch {
    // Bad tz name: fall back to UTC rather than throwing mid-dispatch.
    minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  }
  const [sh, sm] = startHm.split(':').map(Number);
  const [eh, em] = endHm.split(':').map(Number);
  const start = (sh || 0) * 60 + (sm || 0);
  const end = (eh || 0) * 60 + (em || 0);
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  // Cross-midnight (22:00 → 06:00) — inside if minutes >= start OR minutes < end.
  return minutes >= start || minutes < end;
}

// ──────────────────────────────────────────────────────────────
// 5. The send call
// ──────────────────────────────────────────────────────────────

export interface ApnsActionButton {
  /** Matches the UNNotificationAction identifier the iOS app registered. */
  identifier: string;
  /** Display title on the lock-screen action. */
  title: string;
  /** When true, iOS will require unlock before invoking the handler.
   *  Default false (background ack — see deck §C HIG NOTE). */
  authentication_required?: boolean;
  /** When true, marks the action as destructive — iOS paints it red.
   *  Used for WRECKED, WORSE. */
  destructive?: boolean;
}

export interface SendPushArgs {
  device_token: string;
  category: NotificationCategory;
  title: string;
  body: string;
  /** APNs `interruption-level`. race_day uses 'time-sensitive' (deck §A);
   *  everything else uses 'active' (default). */
  interruption_level?: 'passive' | 'active' | 'time-sensitive' | 'critical';
  /** Override the OS sound. null → silent; default 'default'. */
  sound?: string | null;
  /** APNs collapse identifier — same id replaces any earlier unread push. */
  collapse_id?: string;
  /** Thread identifier for OS grouping in Notification Center. */
  thread_id?: string;
  /** Free-form metadata under the `faff` key. The iOS app handles
   *  routing on tap based on `faff.deeplink`. */
  data?: Record<string, unknown>;
  /** Rich-action buttons (deck §4). When present, ALSO sets `aps.category`
   *  so iOS picks the registered UNNotificationCategory at render. */
  action_buttons?: ApnsActionButton[];
  /** 2026-07-06 · audit P1-25 · explicit UNNotificationCategory id override.
   *  When set, wins over apnsCategoryId(category). Lets a template that
   *  shares a prefs bucket emit its OWN iOS category — renderSickCheck
   *  ('niggle_sick' bucket) emits FAFF_SICK so the RECOVERED action can
   *  be registered separately from FAFF_NIGGLE's GONE. */
  apns_category_id?: string;
  /** 2026-07-06 · audit P1-25 · the template's dedup_key, echoed into the
   *  faff dict. NotificationsAppDelegate.swift reads faff.dedup_key and
   *  /api/notifications/ack routes sick vs niggle on its prefix
   *  ('sick-check:' vs 'niggle-check:') + stamps ack_action on the log
   *  row by it. Was never sent → every sick tap misrouted to the niggle
   *  path and ack auditing was dead. */
  dedup_key?: string;
  /** 2026-07-06 · audit P1-25 · notifications_log row id for this send,
   *  echoed into the faff dict so the ack POST can stamp ack_action/ack_at
   *  by primary key instead of the newest-row-for-dedup_key heuristic.
   *  The dispatcher sets it after the pre-log insert. */
  notification_id?: number;
  /** Deck §A. When true the sender does not enforce quiet hours; the
   *  scheduler is the only one allowed to set this. */
  bypass_quiet_hours?: boolean;
  /** When provided, the sender adds `?_apns_id=...` echoed in the response
   *  for tracing. Not load-bearing. */
  request_id?: string;
}

export type SendPushResult =
  | { ok: true; apns_id: string }
  /** `host` rides on every failure (RK-6) so notifications_log captures
   *  which APNs host the send hit — a 400 BadDeviceToken against the
   *  sandbox host with a production token is otherwise indistinguishable
   *  from a genuinely bad token. */
  | { ok: false; reason: 'apns_not_configured' | 'jwt_failed' | 'http2_error' | 'apns_rejected'; status?: number; detail?: string; host?: string };

/**
 * POST a single push to APNs.
 *
 * This is the wire-level send. Quiet-hours gating is done by the caller
 * (scheduler) — when an event-bus writer enqueues a row at fire_at, it
 * sets fire_at to the next allowed minute. The sender's only obligation
 * is to deliver to APNs reliably + return a structured result for the
 * caller to record on notifications_log.
 */
/**
 * Build the APNs JSON body per the 2026-05-28 notifications deck §3.
 * (The deck is a session artifact, never committed to the repo — the
 * in-repo wire contract is this function + notifications-wire.test.ts.)
 * Exported (pure, no I/O) so tests can assert the wire shape without a
 * network — 2026-07-06 audit P1-25 landed dedup_key/notification_id in
 * the faff dict and this is where they materialize.
 */
export function buildApnsBody(args: SendPushArgs): { aps: Record<string, unknown>; faff: Record<string, unknown> } {
  const aps: Record<string, unknown> = {
    alert: { title: args.title, body: args.body },
    sound: args.sound === undefined ? 'default' : (args.sound ?? undefined),
    'thread-id': args.thread_id ?? undefined,
    'interruption-level': args.interruption_level ?? 'active',
    'mutable-content': 1,
  };
  // Rich actions → set aps.category so iOS resolves the registered category.
  // apns_category_id override first (P1-25 · FAFF_SICK split), else the
  // canonical per-bucket mapping.
  if (args.action_buttons && args.action_buttons.length > 0) {
    aps.category = args.apns_category_id ?? apnsCategoryId(args.category);
  }
  const faff: Record<string, unknown> = {
    kind: args.category,
    ...(args.data ?? {}),
  };
  // P1-25 · routing + ack keys. Set AFTER the data spread so a template's
  // free-form data can never shadow them with a stale value.
  if (args.dedup_key) faff.dedup_key = args.dedup_key;
  if (args.notification_id != null) faff.notification_id = args.notification_id;
  return { aps, faff };
}

export async function sendPush(args: SendPushArgs): Promise<SendPushResult> {
  const host = apnsHost();
  const token = signJwt();
  if (!token) {
    return { ok: false, reason: 'apns_not_configured', host };
  }
  const bundleId = process.env.APNS_BUNDLE_ID ?? 'run.faff.app';

  const body = JSON.stringify(buildApnsBody(args));

  let client: http2.ClientHttp2Session;
  try {
    client = http2.connect(host);
  } catch (err) {
    return { ok: false, reason: 'http2_error', detail: (err as Error).message, host };
  }

  return await new Promise<SendPushResult>((resolve) => {
    let settled = false;
    const settle = (r: SendPushResult) => {
      if (settled) return;
      settled = true;
      try { client.close(); } catch { /* swallow */ }
      resolve(r);
    };

    client.on('error', (err) => {
      settle({ ok: false, reason: 'http2_error', detail: err.message, host });
    });

    const headers: Record<string, string | number> = {
      ':method': 'POST',
      ':path': `/3/device/${args.device_token}`,
      authorization: `bearer ${token}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    };
    if (args.collapse_id) headers['apns-collapse-id'] = args.collapse_id;
    if (args.interruption_level === 'time-sensitive') {
      // APNs v3 requires apns-priority=10 for time-sensitive.
      headers['apns-priority'] = 10;
    }

    let req: http2.ClientHttp2Stream;
    try {
      req = client.request(headers);
    } catch (err) {
      settle({ ok: false, reason: 'http2_error', detail: (err as Error).message, host });
      return;
    }

    let respStatus = 0;
    let respApnsId = '';
    let respBody = '';

    req.on('response', (h) => {
      respStatus = Number(h[':status']);
      respApnsId = String(h['apns-id'] ?? '');
    });
    req.setEncoding('utf8');
    req.on('data', (chunk) => { respBody += chunk; });
    req.on('end', () => {
      if (respStatus >= 200 && respStatus < 300) {
        settle({ ok: true, apns_id: respApnsId });
      } else {
        settle({
          ok: false,
          reason: 'apns_rejected',
          status: respStatus,
          detail: respBody || `HTTP ${respStatus}`,
          host,
        });
      }
    });
    req.on('error', (err) => {
      settle({ ok: false, reason: 'http2_error', detail: err.message, host });
    });

    req.end(body);

    // Belt-and-braces timeout. Apple's docs say up to 60s but we cap at
    // 10s for the cron path — if APNs is sad, log + retry on next poll.
    setTimeout(() => {
      settle({ ok: false, reason: 'http2_error', detail: 'timeout 10s', host });
    }, 10_000);
  });
}

/** True iff env contains the minimum cert/key triple. The scheduler uses
 *  this to short-circuit gracefully on first-run before the user has done
 *  the Apple Developer setup. */
export function apnsIsConfigured(): boolean {
  return Boolean(
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID &&
    (process.env.APNS_KEY_PEM || process.env.APNS_KEY_PATH),
  );
}
