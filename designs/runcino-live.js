/**
 * runcino-live.js — best-effort live data refresh for the local v4 build.
 *
 * Each page that includes this script gets a low-risk attempt to pull
 * fresh values from the production API on load. If the request succeeds
 * (CORS allows or page is same-origin), specific fields update in place.
 * If it fails (CORS, network, server), the embedded mockup values stay —
 * those values were pulled from production earlier and are real.
 *
 * Add this script to a page with:
 *   <script src="runcino-live.js" defer></script>
 */
(function () {
  const API_BASE = 'https://runcino-production.up.railway.app';
  const TIMEOUT_MS = 4000;

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ]);
  }

  function fetchJSON(path) {
    return withTimeout(
      fetch(API_BASE + path).then((r) => r.ok ? r.json() : Promise.reject(new Error('http ' + r.status))),
      TIMEOUT_MS
    );
  }

  function setText(sel, value) {
    document.querySelectorAll(sel).forEach((el) => { el.textContent = value; });
  }

  function fmtDate(iso) {
    if (!iso) return null;
    const [_, m, d] = iso.split('-');
    const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m,10)-1];
    return `${month} ${parseInt(d,10)}`;
  }

  fetchJSON('/api/overview')
    .then((d) => {
      const today = d.today;
      const nextA = d?.state?.races?.nextA;
      // Common surfaces we can update with high confidence
      if (nextA) {
        setText('[data-live="next-a-days-away"]', String(nextA.daysAway));
        setText('[data-live="next-a-date"]', fmtDate(nextA.date) || '');
      }
      window.RUNCINO_LIVE = { ok: true, fetchedAt: new Date().toISOString(), data: d };
      console.log('[runcino] live data loaded', { today, nextA });
    })
    .catch((err) => {
      window.RUNCINO_LIVE = { ok: false, reason: err.message };
      console.log('[runcino] live data unavailable, using embedded snapshot:', err.message);
    });
})();
