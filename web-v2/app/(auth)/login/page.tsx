/**
 * /login · Faff sign-in.
 *
 * 2026-06-10 invite-only rebuild (David): "make faff.run just a log in
 * page instead of the full welcome to faff bullshit page. just a log
 * in. either you have one or you dont. You can request access."
 *
 * Gone: the two-column marketing rail ("YOUR RUNNING, COACHED"), the
 * Apple/Google buttons, open signup. Left: the FAFF logomark, email +
 * password, REQUEST ACCESS. The teal effort mesh stays — it's the
 * locked entry skin, not marketing.
 *
 * Server Component: already-signed-in visitors redirect before render.
 * `?next=` (same-site relative only) survives sign-in — the onboarding
 * deck round-trips through here.
 */
import { redirect } from 'next/navigation';
import { userIdFromCookies } from '@/lib/auth/session';
import { FaffLogo } from '@/components/FaffLogo';
import { LoginPanel } from './LoginPanel';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Faff · Sign in',
  description: 'Run with intent.',
};

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // Same-site relative paths only ('/x', not '//x' or absolute URLs) so
  // /login can't be an open redirector.
  const rawNext = typeof sp.next === 'string' ? sp.next : null;
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null;

  const userId = await userIdFromCookies();
  if (userId) redirect(next ?? '/today');

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
        <div className="gate-panel">
          <div className="gate-logo"><FaffLogo height={30} /></div>
          <LoginPanel next={next} openSignup={process.env.ALLOW_OPEN_SIGNUP === 'true'} />
          <div className="gfine">Run with intent.</div>
        </div>
      </div>
    </main>
  );
}

/** Scoped styles · the mesh/grain/panel idiom carried over from the
 *  prior /login (designs/faff-web-signin.html lineage), minus the
 *  two-column rail. One centered panel. */
const styles = `
.login-shell {
  --c1:#7FE6D6; --c2:#3FB6B0; --c3:#27B4E0; --c4:#1F8F76; --c5:#11605E; --mbase:#06302E;
  --txt:#F6F7F8; --mute:#8A90A0; --line:rgba(255,255,255,.08);
  --glass-strong:rgba(17,20,26,.92);
  --font-body:'Inter', sans-serif;
  position:fixed; inset:0; min-height:100vh; width:100%;
  background:var(--mbase); color:var(--txt);
  font-family:var(--font-body);
  overflow:hidden;
}
.login-shell .mesh{position:absolute;inset:0;z-index:0;background:var(--mbase);}
.login-shell .blobs{position:absolute;inset:-12%;filter:blur(46px);animation:loginBreathe 17s ease-in-out infinite;}
@keyframes loginBreathe{
  0%,100%{filter:blur(46px) saturate(1) brightness(1)}
  50%{filter:blur(52px) saturate(1.16) brightness(1.07)}
}
.login-shell .blob{position:absolute;border-radius:50%;opacity:.9;}
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

.login-shell .gate{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;}
.login-shell .gate-panel{
  width:100%;max-width:400px;background:var(--glass-strong);border:1px solid var(--line);border-radius:22px;
  padding:34px 30px 26px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  box-shadow:0 34px 80px -34px rgba(0,0,0,.66);
}
.login-shell .gate-logo{color:#fff;margin:2px 0 26px;display:flex;justify-content:center;}

.login-shell .email-form{display:flex;flex-direction:column;gap:11px;}
.login-shell .auth{display:flex;flex-direction:column;gap:11px;}
.login-shell .email-input{
  width:100%;background:rgba(255,255,255,0.06);border:1px solid var(--line);border-radius:12px;
  padding:13px 14px;color:var(--txt);font-family:inherit;font-size:14.5px;font-weight:500;outline:none;
  transition:border-color .15s, background .15s;
}
.login-shell .email-input::placeholder{color:rgba(255,255,255,0.42);font-weight:400;}
.login-shell .email-input:focus{border-color:rgba(255,255,255,0.36);background:rgba(255,255,255,0.10);}
.login-shell .gbtn{
  display:flex;align-items:center;justify-content:center;gap:11px;border-radius:14px;padding:15px 0;
  font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;border:none;
  transition:transform .12s, background .15s, opacity .15s;
}
.login-shell .gbtn:active{transform:scale(.985);}
.login-shell .gbtn[disabled]{cursor:wait;opacity:.7;}
.login-shell .email-submit{background:#fff;color:#0b0b0b;margin-top:3px;}
.login-shell .gbtn.request{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.22);color:#fff;}
.login-shell .gbtn.request:hover{background:rgba(255,255,255,.16);}
.login-shell .auth-or{
  display:flex;align-items:center;gap:14px;margin:7px 0 2px;
  color:var(--mute);font-size:11px;font-weight:700;letter-spacing:1.5px;
}
.login-shell .auth-or::before,.login-shell .auth-or::after{content:"";flex:1;height:1px;background:var(--line);}
.login-shell .email-cancel{
  background:none;border:none;color:rgba(255,255,255,0.55);font-family:inherit;font-size:12px;
  font-weight:600;cursor:pointer;padding:6px;margin-top:2px;
}
.login-shell .email-cancel:hover{color:rgba(255,255,255,0.85);}
.login-shell .auth-error{
  margin-top:8px;padding:10px 12px;border-radius:10px;
  background:rgba(252,77,100,0.16);border:1px solid rgba(252,77,100,0.4);
  color:#ffd6dd;font-size:12px;line-height:1.45;
}
.login-shell .sent-head{font-size:19px;font-weight:700;}
.login-shell .sent-sub{font-size:13px;line-height:1.55;color:rgba(255,255,255,.75);}
.login-shell .gfine{font-size:11px;font-weight:500;opacity:.5;line-height:1.6;text-align:center;margin-top:20px;}
`;
