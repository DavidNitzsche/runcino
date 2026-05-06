/**
 * Writes data/courses/{slug}.overrides.json to disk.
 * Dev/migration use only — not called at runtime by the app.
 * Returns 403 in production (NODE_ENV !== 'development').
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return new Response('Only available in development', { status: 403 });
  }

  let body: { slug: string; overrides: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    return new Response('Missing slug', { status: 400 });
  }
  if (!/^[a-z0-9-]+$/.test(body.slug)) {
    return new Response('Invalid slug', { status: 400 });
  }

  const dir = join(process.cwd(), 'data', 'courses');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${body.slug}.overrides.json`);
  writeFileSync(path, JSON.stringify(body.overrides, null, 2) + '\n', 'utf-8');

  return Response.json({ ok: true, path: `data/courses/${body.slug}.overrides.json` });
}
