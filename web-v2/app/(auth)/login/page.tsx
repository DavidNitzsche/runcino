/**
 * /login · Faff web sign-in surface.
 *
 * Pixel spec: designs/faff-web-signin.html (CANONICAL).
 *  - Two-column layout · left rail 44% · right glass panel 56%.
 *  - Teal effort mesh background (welcoming · cool entry-point).
 *  - Anton brand wordmark, Oswald display, Inter body.
 *  - Apple = working button. Google + email = visual fidelity only
 *    (toast "Coming soon · use Continue with Apple for now").
 *
 * Server Component: handles the already-signed-in redirect to /today
 * before rendering, then defers the click handlers to the AuthButtons
 * client island. No auth state is read at render time.
 *
 * Tokens · pulled inline (subset of colors_and_type.css) so the screen
 * is fully self-contained · the global stylesheet already loads Anton +
 * Oswald + Inter via app/layout.tsx, no extra <link> needed.
 */
import { redirect } from 'next/navigation';
import { userIdFromCookies } from '@/lib/auth/session';
import { AuthButtons } from './AuthButtons';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Faff · Sign in',
  description: 'Run with intent. A plan that adapts every day, built from your own training.',
};

export default async function LoginPage() {
  const userId = await userIdFromCookies();
  if (userId) redirect('/today');

  const appleClientId = process.env.APPLE_SERVICES_ID || process.env.APPLE_AUDIENCE || null;
  const redirectUri = (process.env.APPLE_REDIRECT_URI || process.env.NEXT_PUBLIC_BASE_URL || 'https://www.faff.run') + '/login';

  return (
    <main className="login-shell">
      <style>{styles}</style>

      <div className="mesh" aria-hidden="true">
        <div className="blobs">
          <div className="blob b1" />
          <div className="blob b2" />
          <div className="blob b3" />
          <div className="blob b4" />
          <div className="blob b5" />
        </div>
      </div>
      <div className="grain" aria-hidden="true" />
      <div className="fade" aria-hidden="true" />

      <div className="gate">
        <div className="gate-rail">
          <div className="gate-brand">
            <div className="gate-mark">Faff<span className="bdot" />Run</div>
          </div>
          <div className="gate-railbody">
            <div className="gate-eyebrow">RUN WITH INTENT</div>
            <div className="gate-h">
              Your running,
              <br />
              <span className="accent">coached.</span>
            </div>
            <div className="gate-sub">
              A plan that adapts every day, built from your own training. Let&rsquo;s find your starting line.
            </div>
            <div className="gate-tempbar" aria-hidden="true" />
          </div>
          <div className="gate-railfoot">Faff for web &middot; <u>What&rsquo;s new</u> &middot; <u>Help</u></div>
        </div>

        <div className="gate-panelwrap">
          <div className="gate-panel">
            <div className="gate-phead">
              <div className="gate-plabel">SIGN IN</div>
            </div>

            <AuthButtons appleClientId={appleClientId} redirectUri={redirectUri} />
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Scoped styles · ported 1:1 from designs/faff-web-signin.html minus the
 * `.win` mockup wrapper (gate fills the viewport per the brief). Kept
 * inline so /login is a single self-contained file and doesn't perturb
 * the existing globals.css surface area.
 */
const styles = `
.login-shell {
  --c1:#7FE6D6; --c2:#3FB6B0; --c3:#27B4E0; --c4:#1F8F76; --c5:#11605E; --mbase:#06302E;
  --txt:#F6F7F8; --mute:#8A90A0; --line:rgba(255,255,255,.08);
  --glass-strong:rgba(17,20,26,.92);
  --font-brand:'Anton', sans-serif;
  --font-display:'Oswald', sans-serif;
  --font-body:'Inter', sans-serif;
  position:fixed; inset:0; min-height:100vh; width:100%;
  background:var(--mbase); color:var(--txt);
  font-family:var(--font-body);
  overflow:hidden;
}
.login-shell .mesh{position:absolute;inset:0;z-index:0;background:var(--mbase);transition:background .7s ease;}
.login-shell .blobs{position:absolute;inset:-12%;filter:blur(46px);animation:loginBreathe 17s ease-in-out infinite;}
@keyframes loginBreathe{
  0%,100%{filter:blur(46px) saturate(1) brightness(1) hue-rotate(0deg)}
  50%{filter:blur(52px) saturate(1.16) brightness(1.07) hue-rotate(8deg)}
}
.login-shell .blob{position:absolute;border-radius:50%;opacity:.9;transition:background .7s ease;}
.login-shell .b1{left:-12%;top:-14%;width:74%;height:74%;background:var(--c1);animation:loginD1 22s ease-in-out infinite alternate;}
.login-shell .b2{left:34%;top:-10%;width:70%;height:72%;background:var(--c2);animation:loginD2 26s ease-in-out infinite alternate;}
.login-shell .b3{left:4%;top:18%;width:96%;height:88%;background:var(--c5);animation:loginD3 30s ease-in-out infinite alternate;}
.login-shell .b4{left:-16%;top:42%;width:78%;height:78%;background:var(--c4);animation:loginD4 24s ease-in-out infinite alternate;}
.login-shell .b5{left:30%;top:40%;width:80%;height:80%;background:var(--c3);animation:loginD5 28s ease-in-out infinite alternate;}
@keyframes loginD1{from{transform:translate(0,0) scale(1)}to{transform:translate(7%,6%) scale(1.13)}}
@keyframes loginD2{from{transform:translate(0,0) scale(1.04)}to{transform:translate(-8%,9%) scale(.95)}}
@keyframes loginD3{from{transform:translate(0,0) scale(1)}to{transform:translate(6%,-7%) scale(1.12)}}
@keyframes loginD4{from{transform:translate(0,0) scale(1.05)}to{transform:translate(9%,-6%) scale(.95)}}
@keyframes loginD5{from{transform:translate(0,0) scale(.97)}to{transform:translate(-8%,-8%) scale(1.12)}}

.login-shell .grain{
  position:absolute;inset:0;z-index:1;opacity:.045;mix-blend-mode:overlay;pointer-events:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.login-shell .fade{
  position:absolute;inset:0;z-index:1;pointer-events:none;
  background:linear-gradient(180deg,rgba(0,0,0,.36) 0%,rgba(0,0,0,0) 26%,rgba(0,0,0,0) 56%,rgba(0,0,0,.46) 100%);
}

.login-shell .gate{position:absolute;inset:0;z-index:60;display:flex;color:var(--txt);}
.login-shell .gate-rail{position:relative;z-index:2;width:44%;flex:0 0 auto;display:flex;flex-direction:column;padding:52px 12px 46px 56px;}
.login-shell .gate-panelwrap{position:relative;z-index:2;flex:1;display:flex;align-items:center;justify-content:center;padding:44px 56px 44px 28px;}
.login-shell .gate-panel{
  width:100%;max-width:468px;background:var(--glass-strong);border:1px solid var(--line);border-radius:22px;
  padding:32px 30px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 34px 80px -34px rgba(0,0,0,.66);
}

.login-shell .gate-brand{display:flex;align-items:center;gap:11px;}
.login-shell .gate-mark{
  font-family:var(--font-brand);font-size:30px;line-height:1;letter-spacing:-1px;text-transform:uppercase;
  white-space:nowrap;transform:skewX(-9deg);
  background:linear-gradient(95deg,#F43F5E 0%,#FF5722 17%,#F5C518 35%,#14C08C 55%,#4F8FF7 75%,#F43F5E 100%);
  background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:loginFaffSweep 6s linear infinite;
}
.login-shell .gate-mark .bdot{
  display:inline-block;width:.16em;height:.16em;background:#F5C518;border-radius:50%;
  vertical-align:baseline;margin:0 .03em;-webkit-text-fill-color:#F5C518;
}
@keyframes loginFaffSweep{0%{background-position:0% 50%}100%{background-position:200% 50%}}

.login-shell .gate-railbody{flex:1;display:flex;flex-direction:column;justify-content:center;max-width:460px;}
.login-shell .gate-eyebrow{font-size:12px;font-weight:700;letter-spacing:3px;opacity:.72;}
.login-shell .gate-h{
  font-family:var(--font-display);font-weight:600;text-transform:uppercase;line-height:.9;letter-spacing:-.5px;
  font-size:74px;margin-top:14px;text-shadow:0 3px 28px rgba(0,0,0,.28);
}
.login-shell .gate-h .accent{
  background:linear-gradient(120deg,#FFE7C2,#FF5722);
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
.login-shell .gate-sub{font-size:17px;font-weight:500;line-height:1.5;opacity:.86;margin-top:18px;max-width:420px;}
.login-shell .gate-tempbar{
  height:10px;border-radius:6px;margin-top:26px;max-width:420px;
  background:linear-gradient(90deg,#27B4E0,#14C08C,#F3AD38,#FF5722,#F43F5E);
  box-shadow:0 6px 22px -8px rgba(0,0,0,.4);
}
.login-shell .gate-railfoot{font-size:12px;font-weight:600;opacity:.66;line-height:1.6;}
.login-shell .gate-railfoot u{cursor:pointer;text-underline-offset:2px;}

.login-shell .gate-phead{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;min-height:30px;}
.login-shell .gate-plabel{font-size:11px;font-weight:700;letter-spacing:2px;opacity:.5;margin-left:auto;}

.login-shell .auth{display:flex;flex-direction:column;gap:11px;}
.login-shell .gbtn{
  display:flex;align-items:center;justify-content:center;gap:11px;border-radius:14px;padding:15px 0;
  font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;border:none;
  transition:transform .12s, background .15s, opacity .15s;
}
.login-shell .gbtn:active{transform:scale(.985);}
.login-shell .gbtn[disabled]{cursor:wait;opacity:.7;}
.login-shell .gbtn svg{width:18px;height:18px;}
.login-shell .gbtn.apple{background:#fff;color:#0b0b0b;}
.login-shell .gbtn.google{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.22);color:#fff;}
.login-shell .gbtn.google:hover{background:rgba(255,255,255,.16);}
.login-shell .gbtn.email{background:none;color:#fff;opacity:.66;font-weight:600;}
.login-shell .gbtn.email:hover{opacity:.9;}
.login-shell .auth-or{
  display:flex;align-items:center;gap:14px;margin:16px 0;
  color:var(--mute);font-size:11px;font-weight:700;letter-spacing:1.5px;
}
.login-shell .auth-or::before,.login-shell .auth-or::after{content:"";flex:1;height:1px;background:var(--line);}
.login-shell .gfine{font-size:11px;font-weight:500;opacity:.5;line-height:1.6;text-align:center;margin-top:18px;}
.login-shell .gfine u{cursor:pointer;}

.login-shell .auth-error{
  margin-top:14px;padding:10px 12px;border-radius:10px;
  background:rgba(252,77,100,0.16);border:1px solid rgba(252,77,100,0.4);
  color:#ffd6dd;font-size:12px;line-height:1.45;
}
.login-shell .email-form{display:flex;flex-direction:column;gap:10px;margin-top:0;}
.login-shell .email-input{
  width:100%;background:rgba(255,255,255,0.06);border:1px solid var(--line);border-radius:12px;
  padding:13px 14px;color:var(--txt);font-family:inherit;font-size:14.5px;font-weight:500;outline:none;
  transition:border-color .15s, background .15s;
}
.login-shell .email-input::placeholder{color:rgba(255,255,255,0.42);font-weight:400;}
.login-shell .email-input:focus{border-color:rgba(255,255,255,0.36);background:rgba(255,255,255,0.10);}
.login-shell .email-submit{margin-top:4px;background:#fff;color:#0b0b0b;}
.login-shell .email-cancel{
  background:none;border:none;color:rgba(255,255,255,0.55);font-family:inherit;font-size:12px;
  font-weight:600;cursor:pointer;padding:6px;margin-top:2px;
}
.login-shell .email-cancel:hover{color:rgba(255,255,255,0.85);}
.login-shell .auth-toast{
  position:fixed;left:50%;bottom:38px;transform:translateX(-50%);z-index:80;
  padding:11px 18px;border-radius:999px;
  background:rgba(17,20,26,.96);border:1px solid var(--line);
  color:var(--txt);font-size:12.5px;font-weight:600;letter-spacing:.3px;
  box-shadow:0 18px 40px -18px rgba(0,0,0,.6);
  pointer-events:none;
}

/* Mobile · stack the rail above the panel, dial the headline down. */
@media (max-width: 880px) {
  .login-shell .gate{flex-direction:column;overflow:auto;}
  .login-shell .gate-rail{width:100%;padding:34px 24px 18px;}
  .login-shell .gate-panelwrap{padding:18px 20px 32px;}
  .login-shell .gate-h{font-size:48px;}
  .login-shell .gate-sub{font-size:15px;}
}
`;
