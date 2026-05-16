/**
 * runcino-bind.js — auto-render bindings from RuncinoStore on load.
 *
 * Pages that want date/plan-aware surfaces can mark up elements with
 * data-* attributes and this script will fill them on DOMContentLoaded
 * (and re-fill them when the store changes via subscribe).
 *
 * Supported bindings:
 *
 *   [data-today-label]            → 'FRI MAY 15' (uppercase day + month + date)
 *   [data-today-date]             → ISO date  (2026-05-16)
 *   [data-plan-week]              → 'Week 1 of 14'
 *   [data-plan-phase]             → 'BASE'
 *   [data-plan-phase-week]        → 'Base Week 1' (mixed-case)
 *   [data-plan-race-days-away]    → '93' (days)
 *   [data-plan-race-name]         → 'Americas Finest City Half'
 *   [data-vdot-anchor]            → '48.1'
 *
 * Add the script with: <script src="runcino-bind.js" defer></script>
 */
(function () {
  'use strict';

  function format(state) {
    const today = state.today;
    const todayLabel = RuncinoStore.fmtDayLabel(today).toUpperCase();
    const plan = state.plan;
    const nextRace = state.races?.upcoming?.[0];
    const vdot = state.vdot;

    return {
      'data-today-label': todayLabel,
      'data-today-date': today,
      'data-plan-week': `Week ${plan.currentWeek} of ${plan.totalWeeks}`,
      'data-plan-phase': plan.currentPhase,
      'data-plan-phase-week': `${capitalize(plan.currentPhase)} Week ${plan.currentPhaseWeek}`,
      'data-plan-race-days-away': nextRace ? String(nextRace.daysAway) : '—',
      'data-plan-race-name': nextRace?.name || '',
      'data-vdot-anchor': vdot ? vdot.anchor.toFixed(1) : '—',
    };
  }

  function capitalize(s) {
    if (!s) return '';
    return s[0].toUpperCase() + s.slice(1).toLowerCase();
  }

  function render() {
    if (!window.RuncinoStore) return;
    const map = format(RuncinoStore.getState());
    Object.entries(map).forEach(([attr, value]) => {
      document.querySelectorAll(`[${attr}]`).forEach((el) => {
        el.textContent = value;
      });
    });
  }

  // Render now (if DOM is ready) and on DOMContentLoaded otherwise
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  // Re-render on store changes (so a check-in or any other action that
  // changes state propagates to bound surfaces)
  if (window.RuncinoStore && typeof RuncinoStore.subscribe === 'function') {
    RuncinoStore.subscribe(render);
  }
})();
