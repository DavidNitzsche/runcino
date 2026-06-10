/**
 * /set-password · first sign-in for approved runners (invite-only flow,
 * 2026-06-10). They arrive here from /login when their credentials are
 * the temp password David's approval generated (users.email_verified_at
 * IS NULL on a non-admin). Choosing a password stamps it and routes on
 * to onboarding (or /today for accounts that already finished).
 *
 * Auth-gated server-side: no session → /login.
 */
import { redirect } from 'next/navigation';
import { userIdFromCookies } from '@/lib/auth/session';
import { FaffLogo } from '@/components/FaffLogo';
import { SetPasswordForm } from './SetPasswordForm';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Faff · Set your password' };

export default async function SetPasswordPage() {
  const userId = await userIdFromCookies();
  if (!userId) redirect('/login');

  return (
    <main className="setpw-shell">
      <style>{styles}</style>
      <div className="panel">
        <div className="logo"><FaffLogo height={26} /></div>
        <div className="head">Make it yours.</div>
        <div className="sub">
          That password was a loaner. Set your own and it&rsquo;s the last
          time you&rsquo;ll think about it.
        </div>
        <SetPasswordForm />
      </div>
    </main>
  );
}

const styles = `
.setpw-shell{
  position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
  background:#0C0D11;color:#F6F7F8;font-family:'Inter',sans-serif;padding:24px;
}
.setpw-shell .panel{
  width:100%;max-width:400px;background:rgba(17,20,26,.92);
  border:1px solid rgba(255,255,255,.08);border-radius:22px;padding:34px 30px 28px;
  box-shadow:0 34px 80px -34px rgba(0,0,0,.66);
}
.setpw-shell .logo{color:#fff;margin-bottom:24px;display:flex;justify-content:center;}
.setpw-shell .head{font-size:21px;font-weight:700;}
.setpw-shell .sub{font-size:13px;line-height:1.55;color:rgba(255,255,255,.72);margin:8px 0 20px;}
.setpw-shell .email-input{
  width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,.08);border-radius:12px;
  padding:13px 14px;color:#F6F7F8;font-family:inherit;font-size:14.5px;font-weight:500;outline:none;
}
.setpw-shell .email-input:focus{border-color:rgba(255,255,255,0.36);background:rgba(255,255,255,0.10);}
.setpw-shell form{display:flex;flex-direction:column;gap:11px;}
.setpw-shell .submit{
  display:flex;align-items:center;justify-content:center;border-radius:14px;padding:15px 0;
  font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;border:none;
  background:#fff;color:#0b0b0b;margin-top:3px;
}
.setpw-shell .submit[disabled]{cursor:wait;opacity:.7;}
.setpw-shell .err{
  margin-top:8px;padding:10px 12px;border-radius:10px;
  background:rgba(252,77,100,0.16);border:1px solid rgba(252,77,100,0.4);
  color:#ffd6dd;font-size:12px;line-height:1.45;
}
`;
