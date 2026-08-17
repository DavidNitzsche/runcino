/**
 * lib/email/send-from.test.ts
 *
 * 2026-08-17 · invite-funnel fix. Both real invitees got their approval
 * email from Resend's resend.dev sandbox sender. FROM now reads
 * RESEND_FROM with a faff.run default. (Setting RESEND_FROM on Railway
 * and verifying the domain in Resend remain David's.)
 *
 *   F1  RESEND_FROM unset → 'Faff <coach@faff.run>' (and never resend.dev)
 *   F2  RESEND_FROM set → wins verbatim
 *   F3  RESEND_FROM set-but-empty → falls back to the default ('' must
 *       not become the from header, hence || not ??)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendEmail } from './send';

const ORIG_FROM = process.env.RESEND_FROM;
const ORIG_KEY = process.env.RESEND_API_KEY;

function mockFetchOk(): ReturnType<typeof vi.fn> {
  const f = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
  vi.stubGlobal('fetch', f);
  return f;
}

function sentFrom(f: ReturnType<typeof vi.fn>): string {
  const body = JSON.parse((f.mock.calls[0][1] as { body: string }).body);
  return body.from;
}

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIG_FROM === undefined) delete process.env.RESEND_FROM;
  else process.env.RESEND_FROM = ORIG_FROM;
  if (ORIG_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIG_KEY;
});

describe('sendEmail · FROM resolution', () => {
  it('F1 · defaults to the faff.run sender, never the resend.dev sandbox', async () => {
    delete process.env.RESEND_FROM;
    const f = mockFetchOk();
    const r = await sendEmail({ to: 'x@y.z', subject: 's', text: 't' });
    expect(r.ok).toBe(true);
    expect(sentFrom(f)).toBe('Faff <coach@faff.run>');
    expect(sentFrom(f)).not.toContain('resend.dev');
  });

  it('F2 · RESEND_FROM env wins verbatim', async () => {
    process.env.RESEND_FROM = 'Faff <invites@faff.run>';
    const f = mockFetchOk();
    await sendEmail({ to: 'x@y.z', subject: 's', text: 't' });
    expect(sentFrom(f)).toBe('Faff <invites@faff.run>');
  });

  it('F3 · empty-string RESEND_FROM falls back to the default', async () => {
    process.env.RESEND_FROM = '';
    const f = mockFetchOk();
    await sendEmail({ to: 'x@y.z', subject: 's', text: 't' });
    expect(sentFrom(f)).toBe('Faff <coach@faff.run>');
  });

  it('no API key → honest not-configured error, no network call', async () => {
    delete process.env.RESEND_API_KEY;
    const f = mockFetchOk();
    const r = await sendEmail({ to: 'x@y.z', subject: 's', text: 't' });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
