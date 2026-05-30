import { redirect } from 'next/navigation';

// Onboarding gate is deferred until the Faff sign-in flow lands.
// Single-user beta: bounce straight to Today.
export default function OnboardingPage() {
  redirect('/today');
}
