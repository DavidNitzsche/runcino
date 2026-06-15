import { redirect } from 'next/navigation';
import { pool } from '@/lib/db/pool';
import { userIdFromCookies } from '@/lib/auth/session';
import { FaffLogo } from '@/components/FaffLogo';
import { TesterList } from './TesterList';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Faff · Testers' };

export default async function TestersPage() {
  const userId = await userIdFromCookies();
  if (!userId) redirect('/login?next=%2Fadmin%2Ftesters');
  const admin = (await pool.query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id = $1 LIMIT 1`, [userId],
  ).catch(() => ({ rows: [] as Array<{ is_admin: boolean }> }))).rows[0];
  if (admin?.is_admin !== true) redirect('/today');

  return (
    <main className="tw-shell">
      <style>{styles}</style>
      <div className="wrap">
        <header className="head">
          <span className="logo"><FaffLogo height={20} /></span>
          <span className="hlabel">ADMIN · TESTER WATCH</span>
        </header>
        <TesterList />
      </div>
    </main>
  );
}

const styles = `
.tw-shell {
  min-height: 100vh;
  background: #0a0a0a;
  color: #f0f0f0;
  font-family: 'Inter', -apple-system, sans-serif;
  padding: 36px 20px;
}
.tw-shell .wrap { max-width: 1080px; margin: 0 auto; }
.tw-shell .head { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
.tw-shell .logo { color: #fff; display: flex; }
.tw-shell .hlabel { font-size: 11px; font-weight: 700; letter-spacing: 2px; opacity: .55; }
`;
