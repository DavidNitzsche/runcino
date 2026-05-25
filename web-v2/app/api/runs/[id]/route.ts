/**
 * GET /api/runs/[id] — JSON view of a single run for the modal.
 *
 * Same shape as /runs/[id] server component, but client-fetchable so
 * the run detail can open as a modal on /today without route change.
 */
import { NextResponse } from 'next/server';
import { loadRunDetail } from '@/lib/coach/run-state';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id === 'null' || id === 'undefined') {
    return NextResponse.json({ error: 'no activity id' }, { status: 404 });
  }
  const detail = await loadRunDetail(DAVID_USER_ID, id);
  if (!detail) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  return NextResponse.json(detail);
}
