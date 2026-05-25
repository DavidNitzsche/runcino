import { redirect } from 'next/navigation';
import { getCurrentUser } from '../lib/auth';

/**
 * Root entry point.
 *   - Signed out → /landing
 *   - Signed in but pending/denied → /pending (private-beta gate)
 *   - Signed in, active, not onboarded → /onboarding
 *   - Signed in, active, onboarded → /overview
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/landing');
  if (user.status !== 'active') redirect('/pending');
  redirect(user.onboarding_complete ? '/overview' : '/onboarding');
}
