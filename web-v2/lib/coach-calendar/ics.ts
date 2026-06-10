/**
 * Coach calendar (Final Surge et al) · minimal ICS feed parser + guarded
 * fetcher. Coached-mode v2 (2026-06-10, David's go: "wire up final surge").
 *
 * Final Surge exposes a per-athlete Calendar Sync URL — a standard ICS
 * web-calendar feed of planned workouts ("use that URL to sync with any
 * third party site or application that accepts web calendar links",
 * support.finalsurge.com §360050607053). TrainingPeaks and most coaching
 * platforms ship the same mechanism, so one importer covers "a coach
 * through something like Final Surge" generically.
 *
 * Scope: READ-ONLY display. Events carry title + description text — no
 * structured workout_spec is invented from them (that's v3, via
 * parsePrescription). No new dependency: the subset of RFC 5545 a
 * workout feed uses (VEVENT / DTSTART / SUMMARY / DESCRIPTION / UID)
 * parses in ~60 lines.
 */

export interface CoachCalendarEvent {
  uid: string;
  /** YYYY-MM-DD · the workout's calendar day. All-day events (VALUE=DATE,
   *  what Final Surge emits for workouts) map exactly; timestamped events
   *  use their date component as-is (a UTC stamp near midnight can land a
   *  day off for far-west timezones — acceptable display imprecision for
   *  a read-only feed, noted rather than solved). */
  dateISO: string;
  title: string;
  description: string | null;
}

const MAX_EVENTS = 1000;
const MAX_FEED_BYTES = 2 * 1024 * 1024; // 2MB · a season of workouts is ~100KB
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

/** Unescape RFC 5545 TEXT values (\\n, \\, \; \,). */
function unescapeIcsText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** Parse an ICS document into coach calendar events. Defensive: skips
 *  malformed VEVENTs rather than throwing; caps at MAX_EVENTS. */
export function parseIcs(text: string): CoachCalendarEvent[] {
  // RFC 5545 line unfolding: CRLF (or LF) followed by space/tab continues
  // the previous line.
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const events: CoachCalendarEvent[] = [];
  let cur: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur) {
        const ev = eventFrom(cur, events.length);
        if (ev) events.push(ev);
        if (events.length >= MAX_EVENTS) break;
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    // NAME;PARAM=...;PARAM=...:VALUE — keep the first occurrence.
    const m = line.match(/^([A-Za-z0-9-]+)(?:;[^:]*)?:(.*)$/);
    if (!m) continue;
    const key = m[1].toUpperCase();
    if (!(key in cur)) cur[key] = m[2];
  }
  return events;
}

function eventFrom(props: Record<string, string>, idx: number): CoachCalendarEvent | null {
  const dt = props['DTSTART'];
  if (!dt) return null;
  const dm = dt.match(/(\d{4})(\d{2})(\d{2})/);
  if (!dm) return null;
  const dateISO = `${dm[1]}-${dm[2]}-${dm[3]}`;
  const title = unescapeIcsText(props['SUMMARY'] ?? '').trim() || 'Workout';
  const rawDesc = unescapeIcsText(props['DESCRIPTION'] ?? '').trim();
  return {
    uid: (props['UID'] ?? '').trim() || `${dateISO}-${idx}`,
    dateISO,
    title: title.slice(0, 200),
    description: rawDesc ? rawDesc.slice(0, 4000) : null,
  };
}

/** Validate + normalize a runner-supplied feed URL.
 *  Returns the https URL string or an error. webcal:// (the scheme
 *  calendar apps hand out) normalizes to https://. */
export function normalizeFeedUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let s = (raw ?? '').trim();
  if (!s) return { ok: false, error: 'paste your calendar link' };
  if (s.length > 2048) return { ok: false, error: 'link too long' };
  if (/^webcal:\/\//i.test(s)) s = 'https://' + s.slice('webcal://'.length);
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, error: 'that does not look like a link' }; }
  const devLocal = process.env.NODE_ENV !== 'production'
    && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (u.protocol !== 'https:' && !(devLocal && u.protocol === 'http:')) {
    return { ok: false, error: 'calendar link must be https' };
  }
  if (!devLocal && isPrivateHost(u.hostname)) {
    return { ok: false, error: 'that host is not reachable from Faff' };
  }
  return { ok: true, url: u.toString() };
}

/** Basic SSRF guard · server-side fetch of a user-supplied URL must not
 *  reach internal services. Hostname-level checks (literal private IPs +
 *  internal-looking names). Proportionate for a read-only ICS fetch. */
function isPrivateHost(hostRaw: string): boolean {
  const host = hostRaw.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

/** Fetch + parse a feed URL. Manual redirect loop (each hop re-guarded),
 *  timeout, size cap, VCALENDAR sanity check. Never throws. */
export async function fetchIcsFeed(rawUrl: string): Promise<
  { ok: true; events: CoachCalendarEvent[] } | { ok: false; error: string }
> {
  const norm = normalizeFeedUrl(rawUrl);
  if (!norm.ok) return norm;
  let url = norm.url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'text/calendar, text/plain, */*' },
      });
    } catch (e: any) {
      return { ok: false, error: `could not reach the calendar (${e?.name === 'TimeoutError' ? 'timed out' : 'network error'})` };
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { ok: false, error: 'calendar host sent a broken redirect' };
      const next = normalizeFeedUrl(new URL(loc, url).toString());
      if (!next.ok) return { ok: false, error: 'calendar redirected somewhere Faff will not follow' };
      url = next.url;
      continue;
    }
    if (!res.ok) {
      return { ok: false, error: `calendar host answered ${res.status} — check the link is the Sync URL, not the page URL` };
    }

    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > MAX_FEED_BYTES) return { ok: false, error: 'calendar feed too large' };
    const text = await res.text();
    if (text.length > MAX_FEED_BYTES) return { ok: false, error: 'calendar feed too large' };
    if (!text.includes('BEGIN:VCALENDAR')) {
      return { ok: false, error: 'that link is not a calendar feed — in Final Surge, copy the Calendar Sync URL' };
    }
    return { ok: true, events: parseIcs(text) };
  }
  return { ok: false, error: 'too many redirects' };
}
