import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Legacy alias — Profile now mounted as Faff Me (profile view).
// 2026-08-18 · Live cutover — redirects to the canonical route rather
// than duplicating the redesigned Settings render.
export default function ProfilePage() {
  redirect('/me');
}
