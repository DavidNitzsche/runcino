/**
 * GET /api/overview — LEGACY iPhone compatibility shim.
 *
 * The legacy app (pre-cutover, see legacy/native/Faff/Faff/OverviewModels.swift:952)
 * fetches this URL on launch to build its TodayView. web-v2 replaced
 * it with /api/briefing + /api/plan/week + /api/watch/today. The legacy
 * app is the one shipped pre-cutover; its bundle id collides with the
 * v2 build so only one can be installed at a time.
 *
 * Old behavior: 404 → legacy app surfaces the Next.js 404 HTML body to
 * the user as raw text inside a "Couldn't load" view. Looks like the app
 * is on fire.
 *
 * New behavior: 410 GONE with a clear message telling the user to update
 * TestFlight. App still shows an error, but a meaningful one.
 *
 * Once we're confident all legacy installs are gone, delete this route.
 */
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    error: 'legacy_app_deprecated',
    message:
      'This version of Faff is out of date. Open TestFlight and update to ' +
      'the latest build (70+). The /api/overview endpoint has been replaced ' +
      'by the new tool-use coach pipeline.',
    upgradeUrl: 'https://testflight.apple.com/v1/app/run.faff.app',
  }, { status: 410 });
}
