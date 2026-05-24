/**
 * /api/coach/note — runner free-text "talk to the coach" journal.
 *
 * GET                              → { ok, recent: RunnerNote[] }
 * POST { text, kind? }             → { ok, note }
 *
 * Coach reads recent notes (≤30d window) as context for the next read
 * cycle. May surface in REFLECTION, may trigger injury/illness/re-plan
 * flow on keyword detection (handled in the coach engine).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createNote, listRecentNotes, type NoteKind } from '@/lib/note-store';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });
  const recent = await listRecentNotes(user.id, 30, 30);
  return NextResponse.json({ ok: true, recent });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });

  let body: { text?: string; kind?: NoteKind };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
    return NextResponse.json({ ok: false, error: 'text is required' }, { status: 400 });
  }

  const note = await createNote(user.id, body.text.trim(), body.kind ?? 'general');
  return NextResponse.json({ ok: true, note });
}
