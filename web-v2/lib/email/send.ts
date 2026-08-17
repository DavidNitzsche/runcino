/**
 * Outbound email · invite-only access flow (2026-06-10).
 *
 * Provider: Resend via plain fetch when RESEND_API_KEY is set (no SDK
 * dependency).
 *
 * FROM (2026-08-17 · invite-funnel fix): RESEND_FROM env, defaulting to
 * 'Faff <coach@faff.run>'. The old default was Resend's resend.dev
 * sandbox sender, which is capped/spam-foldered for real recipients —
 * both real invitees got their approval email from a sandbox address
 * and neither ever signed in. NOTE for David: setting RESEND_FROM on
 * Railway (and verifying the faff.run domain in Resend) is yours to do;
 * until the domain is verified, Resend rejects faff.run senders and the
 * send result surfaces that error to the caller.
 *
 * No key configured → { ok:false, error:'email not configured' } and
 * the caller decides the fallback. The access flow is designed to be
 * FULLY functional without email: requests land on /admin + ops_alerts,
 * and approvals surface the temp password to David for manual sharing.
 */

const RESEND_URL = 'https://api.resend.com/emails';

const DEFAULT_FROM = 'Faff <coach@faff.run>';

// Startup nudge, once per process: the env var is David's to set on
// Railway. The default is sensible but only works once the faff.run
// domain is verified in Resend.
if (!process.env.RESEND_FROM) {
  console.warn(
    `[email] RESEND_FROM not set — defaulting to '${DEFAULT_FROM}'. ` +
    `Set RESEND_FROM on Railway (verified Resend domain sender) for deliverable invite email.`,
  );
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'email not configured (set RESEND_API_KEY)' };
  const from = process.env.RESEND_FROM || DEFAULT_FROM;
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `resend ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'email send failed' };
  }
}
