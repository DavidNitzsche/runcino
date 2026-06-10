/**
 * /admin · David's approval backend (invite-only flow, 2026-06-10).
 *
 * Server-gated: session must resolve AND users.is_admin must be true —
 * non-admins get redirected to /today without learning the page exists.
 * The interactive list is a client island hitting
 * /api/admin/access-requests (requireAdmin again server-side — the page
 * gate is UX, the API gate is the security boundary).
 */
import { redirect } from 'next/navigation';
import { pool } from '@/lib/db/pool';
import { userIdFromCookies } from '@/lib/auth/session';
import { FaffLogo } from '@/components/FaffLogo';
import { AccessRequestList } from './AccessRequestList';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Faff · Admin' };

export default async function AdminPage() {
  const userId = await userIdFromCookies();
  if (!userId) redirect('/login?next=%2Fadmin');
  const admin = (await pool.query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id = $1 LIMIT 1`, [userId],
  ).catch(() => ({ rows: [] as Array<{ is_admin: boolean }> }))).rows[0];
  if (admin?.is_admin !== true) redirect('/today');

  return (
    <main className="admin-shell">
      <style>{styles}</style>
      <div className="wrap">
        <header className="head">
          <span className="logo"><FaffLogo height={20} /></span>
          <span className="hlabel">ADMIN · ACCESS REQUESTS</span>
        </header>
        <AccessRequestList />
      </div>
    </main>
  );
}

const styles = `
.admin-shell{
  min-height:100vh;background:#0C0D11;color:#F6F7F8;
  font-family:'Inter',sans-serif;padding:42px 20px;
}
.admin-shell .wrap{max-width:680px;margin:0 auto;}
.admin-shell .head{display:flex;align-items:center;gap:14px;margin-bottom:26px;}
.admin-shell .logo{color:#fff;display:flex;}
.admin-shell .hlabel{font-size:11px;font-weight:700;letter-spacing:2px;opacity:.6;}
.admin-shell .row{
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  background:rgba(17,20,26,.92);border:1px solid rgba(255,255,255,.08);
  border-radius:14px;padding:14px 16px;margin-bottom:10px;
}
.admin-shell .who{flex:1;min-width:200px;}
.admin-shell .nm{font-size:14.5px;font-weight:700;}
.admin-shell .em{font-size:12px;opacity:.65;margin-top:2px;}
.admin-shell .meta{font-size:10px;letter-spacing:1.2px;opacity:.45;text-transform:uppercase;}
.admin-shell .btn{
  border:none;border-radius:10px;padding:9px 14px;font-family:inherit;
  font-size:12px;font-weight:700;cursor:pointer;
}
.admin-shell .approve{background:#fff;color:#0b0b0b;}
.admin-shell .deny{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.18);}
.admin-shell .empty{opacity:.55;font-size:13.5px;padding:30px 4px;}
.admin-shell .temp{
  width:100%;margin-top:10px;padding:10px 12px;border-radius:10px;
  background:rgba(20,192,140,.12);border:1px solid rgba(20,192,140,.4);
  font-size:12.5px;line-height:1.5;
}
.admin-shell .temp code{font-size:14px;font-weight:700;letter-spacing:.5px;}
.admin-shell .err{
  width:100%;margin-top:10px;padding:10px 12px;border-radius:10px;
  background:rgba(252,77,100,0.16);border:1px solid rgba(252,77,100,0.4);
  color:#ffd6dd;font-size:12px;
}
.admin-shell .denied .nm,.admin-shell .denied .em{opacity:.4;text-decoration:line-through;}
`;
