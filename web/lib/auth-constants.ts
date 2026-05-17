/**
 * Edge-safe auth constants. Middleware can't import from `lib/auth.ts`
 * because that pulls in `pg` (Node-only). This file has zero side-effect
 * imports so it's safe in the Edge runtime where middleware runs.
 */

export const SESSION_COOKIE = 'faff_session';
