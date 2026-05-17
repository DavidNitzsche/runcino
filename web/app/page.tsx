import { redirect } from 'next/navigation';
import { getCurrentUser } from '../lib/auth';

/**
 * Root entry point.
 *   - Signed in & onboarded → /overview
 *   - Signed in & not yet onboarded → /onboarding
 *   - Signed out → /landing
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(user.onboarding_complete ? '/overview' : '/onboarding');
  }
  redirect('/landing');
}
