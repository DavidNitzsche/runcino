import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Legacy alias — Plan lives under Training (Faff Train tab).
// 2026-08-18 · Live cutover — redirects to the canonical route rather
// than duplicating the redesigned Block render.
export default function PlanPage() {
  redirect('/training');
}
