/**
 * Outbound email · invite-only access flow (2026-06-10).
 *
 * Provider: Resend via plain fetch when RESEND_API_KEY is set (no SDK
 * dependency). FROM defaults to onboarding@resend.dev (Resend's
 * sandbox sender — fine for notifying David; set RESEND_FROM to a
 * verified domain sender before emailing runners at large).
 *
 * No key configured → { ok:false, error:'email not configured' } and
 * the caller decides the fallback. The access flow is designed to be
 * FULLY functional without email: requests land on /admin + ops_alerts,
 * and approvals surface the temp password to David for manual sharing.
 */

const RESEND_URL = 'https://api.resend.com/emails';

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
  const from = process.env.RESEND_FROM ?? 'Faff <onboarding@resend.dev>';
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
