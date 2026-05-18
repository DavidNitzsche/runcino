/**
 * Layout guard for /onboarding. The form below is a client component
 * so the gate has to live in the layout (server) — otherwise a pending
 * user could see the form even though they can't submit it.
 *
 * Flow:
 *   - No session → /login
 *   - Pending/denied → /pending
 *   - Active, already onboarded → /overview (skip the form)
 *   - Active, not onboarded → render the form
 */

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.status !== 'active') redirect('/pending');
  if (user.onboarding_complete) redirect('/overview');
  return <>{children}</>;
}
