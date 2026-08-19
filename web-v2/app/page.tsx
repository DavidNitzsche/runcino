import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * app/page.tsx
 *
 * 2026-08-18 · Live cutover — `/` and `/today` were always functionally
 * identical (both mounted Shell with initial="today"). Rather than
 * duplicate the redesigned Today page's layout/styles wiring for a route
 * segment that can't itself hold a layout.tsx (no app/[segment] folder to
 * attach one to — `/` renders straight under the root app/layout.tsx),
 * redirect to the canonical route.
 */
export default function RootPage() {
  redirect('/today');
}
