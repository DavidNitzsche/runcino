'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/redesign/core/Button';

/**
 * components/redesign/race-week/BackToTodayButton.tsx
 *
 * The one interactive bit the "not race week right now" EmptyState needs
 * (app/redesign/race-week/page.tsx) — a real navigation action, not an
 * inert button. Split into its own tiny client component because the page
 * itself is a server component (it needs to await buildSeed()) and Button
 * takes a plain onClick callback, which can't cross the server→client
 * prop boundary — same reason RunDetailClient / BlockClient keep their
 * own small 'use client' islands rather than making the whole route
 * client-rendered.
 */
export function BackToTodayButton() {
  const router = useRouter();
  return (
    <Button variant="secondary" size="md" onClick={() => router.push('/redesign/today')}>
      Back to today
    </Button>
  );
}
