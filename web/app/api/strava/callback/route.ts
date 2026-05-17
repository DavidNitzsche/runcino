/**
 * /api/strava/callback — receives ?code=... from Strava authorize,
 * exchanges it for tokens, displays the refresh_token + athlete_id
 * for the user to paste into env (web/.env.local + Railway).
 *
 * Strava's refresh tokens don't expire unless deauthorized, so this
 * runs once. The HTML response uses inline styles since this isn't
 * part of the React app shell.
 */

import { exchangeCode } from '../../../../lib/strava';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(errorHtml(`Strava denied authorization: ${error}`), {
      status: 400, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  if (!code) {
    return new Response(errorHtml('No code in callback URL — start at /api/strava/connect'), {
      status: 400, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (e) {
    return new Response(errorHtml(`Token exchange failed: ${e instanceof Error ? e.message : String(e)}`), {
      status: 502, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  return new Response(successHtml(tokens.refresh_token, tokens.athlete?.id ?? null, tokens.athlete?.firstname ?? null), {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function shellCss(): string {
  return `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;700&family=Jost:wght@400;500;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #10131A; color: #F6F7F8; font-family: 'Jost', sans-serif; padding: 60px 32px; min-height: 100vh; line-height: 1.55; }
      .stage { max-width: 720px; margin: 0 auto; }
      h1 { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 48px; letter-spacing: -.01em; text-transform: uppercase; line-height: .95; margin-bottom: 12px; }
      p { color: rgba(246,247,248,.72); margin-bottom: 16px; }
      p b { color: #F6F7F8; }
      .eye { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #3EBD41; font-weight: 700; margin-bottom: 8px; }
      .eye.err { color: #FC4D54; }
      pre { background: #1A212D; border: 1px solid #21303F; border-radius: 10px; padding: 14px 16px; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #F6F7F8; overflow-x: auto; margin: 14px 0; user-select: all; }
      .step { background: #141820; border: 1px solid #21303F; border-radius: 14px; padding: 20px 22px; margin-top: 14px; }
      .step-num { display: inline-block; width: 28px; height: 28px; border-radius: 50%; background: #1A212D; border: 1px solid #21303F; text-align: center; line-height: 28px; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; margin-right: 8px; vertical-align: middle; }
      .step h3 { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 18px; text-transform: uppercase; letter-spacing: -.005em; display: inline-block; vertical-align: middle; }
      a.cta { display: inline-block; padding: 12px 22px; background: #F3AD3B; color: #10131A; border-radius: 10px; text-decoration: none; font-weight: 700; margin-top: 20px; }
    </style>
  `;
}

function successHtml(refreshToken: string, athleteId: number | null, firstname: string | null): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Strava connected</title>${shellCss()}</head><body><div class="stage">
    <div class="eye">● Strava connected</div>
    <h1>You're in${firstname ? ', ' + firstname : ''}.</h1>
    <p>Refresh token captured. Drop these into <b>web/.env.local</b> for local dev <b>and</b> Railway → Project → Variables for production. After that, /api/strava/sync will pull your activities on demand.</p>

    <div class="step">
      <span class="step-num">1</span><h3>Add to web/.env.local</h3>
      <pre>STRAVA_REFRESH_TOKEN=${refreshToken}${athleteId ? `\nSTRAVA_ATHLETE_ID=${athleteId}` : ''}</pre>
    </div>

    <div class="step">
      <span class="step-num">2</span><h3>Add the same vars to Railway</h3>
      <p style="margin-top:10px;">Open the faff.run service in Railway → <b>Variables</b> tab → <b>+ New Variable</b>. Add <code style="font-family:JetBrains Mono,monospace; background:#1A212D; padding:1px 6px; border-radius:3px;">STRAVA_REFRESH_TOKEN</code> with the value above. Same for the other Strava vars if not already there. Redeploy is automatic.</p>
    </div>

    <div class="step">
      <span class="step-num">3</span><h3>Test it</h3>
      <p style="margin-top:10px;">After the env update lands, hit <code style="font-family:JetBrains Mono,monospace; background:#1A212D; padding:1px 6px; border-radius:3px;">/api/strava/sync</code> in your browser to confirm it pulls activities. Then go to a race-detail page and click "Pull from Strava" on the result form.</p>
    </div>

    <a class="cta" href="/api/strava/sync">Try /api/strava/sync now →</a>
  </div></body></html>`;
}

function errorHtml(msg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Strava error</title>${shellCss()}</head><body><div class="stage">
    <div class="eye err">✗ Strava error</div>
    <h1>Something went wrong.</h1>
    <p style="color:#FC4D54;">${msg.replace(/</g, '&lt;')}</p>
    <p>Try again from <a href="/api/strava/connect" style="color:#F3AD3B;">/api/strava/connect</a> or check the env vars in web/.env.local.</p>
  </div></body></html>`;
}
