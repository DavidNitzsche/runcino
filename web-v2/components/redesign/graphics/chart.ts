/**
 * components/redesign/graphics/chart.ts
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/graphics/chart.js), 2026-08-18.
 * Faithful port of the <faff-chart> custom element — three families
 * (ring / bars / line), one mark type each, filled with the metric's own
 * gradient. Plain vanilla JS/DOM, no JSX, ported near-verbatim (typed).
 *
 * Registration: call registerFaffChart() once, client-side, before any
 * <faff-chart> tag renders. See useRegisterFaffChart() below — a client
 * hook other components call once per mount; it no-ops on repeat calls
 * (checks customElements.get first) so React fast-refresh / multiple
 * mounts never throw the "already defined" DOMException.
 */

let FAFF_CHART_ID = 0;

// `class ... extends HTMLElement` evaluates its base-class reference at
// MODULE LOAD time, not at instantiation time. This module is imported by
// a 'use client' component (FaffChartRegistrar), but Next.js still
// server-renders client components for the initial HTML — so this file
// gets evaluated once in Node's SSR environment, where `HTMLElement` is
// undefined, and the bare class declaration threw "HTMLElement is not
// defined" before any component ever mounted. Falling back to a plain
// stand-in base class on the server (never instantiated there — the
// custom element only ever gets registered/used client-side, gated by
// registerFaffChart()'s `typeof window === 'undefined'` check below)
// keeps the real behavior in the browser while making the module safe to
// import from server-rendered code paths.
const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement);

class FaffChart extends HTMLElementBase {
  private _io: IntersectionObserver | null = null;

  static get observedAttributes() {
    return ['type', 'values', 'domain', 'labels', 'hue'];
  }

  /* A chart names its state, not a colour: the element sets the hue AND the direction its
     gradient turns. Warm hues turn toward red — turning amber the cool way lands in olive. */
  static get warm() {
    return ['quality', 'alarm', 'race'];
  }

  private _hue() {
    const h = this.getAttribute('hue');
    if (!h) return;
    this.style.setProperty('--c', `var(--state-${h})`);
    this.classList.toggle('warm', FaffChart.warm.includes(h));
  }

  private _axis(n: number, ends: boolean): string {
    let labels: string[] = [];
    try {
      labels = JSON.parse(this.getAttribute('labels') || '[]');
    } catch {
      /* ignore malformed labels attribute */
    }
    if (!labels.length) return '';
    /* Too many slots to label legibly: keep the ends and the middle, leave the rest as space. */
    if (!ends && labels.length > 8) {
      const keep = new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1]);
      labels = labels.map((l, i) => (keep.has(i) ? l : ''));
    }
    return `<div class="faff-chart-axis${ends ? ' ends' : ''}">` + labels.map((l) => `<span>${l}</span>`).join('') + `</div>`;
  }

  connectedCallback() {
    this._draw();
    this._watch();
  }

  /* A chart animates in when it is first seen, not when it is parsed. */
  private _watch() {
    if (this._io) return;
    this._io = new IntersectionObserver(
      (es) => es.forEach((e) => {
        if (e.isIntersecting) {
          this.play();
          this._io?.disconnect();
        }
      }),
      { threshold: 0.35 },
    );
    this._io.observe(this);
  }

  play() {
    this.removeAttribute('data-enter');
    void this.offsetWidth;
    this.setAttribute('data-enter', '');
  }

  attributeChangedCallback() {
    if (this.isConnected) this._draw();
  }

  private _draw() {
    const type = this.getAttribute('type') || 'bars';
    let vals: Array<number | null> = [];
    try {
      vals = JSON.parse(this.getAttribute('values') || '[]');
    } catch {
      /* ignore malformed values attribute */
    }
    const nums = vals.filter((v): v is number => v != null);
    if (!nums.length) return;
    let dom: [number, number] | null;
    try {
      dom = JSON.parse(this.getAttribute('domain') || 'null');
    } catch {
      dom = null;
    }
    if (!dom) {
      const lo = Math.min(...nums);
      const hi = Math.max(...nums);
      const pad = (hi - lo) * 0.25 || 1;
      dom = type === 'bars' ? [0, hi] : [lo - pad, hi + pad];
    }
    const [d0, d1] = dom;
    const span = d1 - d0 || 1;
    const pct = (v: number) => Math.max(0, Math.min(100, ((v - d0) / span) * 100));
    this.classList.add('faff-chart');
    this._hue();

    if (type === 'ring') {
      const R = 40;
      const C = 2 * Math.PI * R;
      const v = pct(nums[0]);
      const arc = this.querySelector('circle.value');
      if (arc) {
        arc.setAttribute('stroke-dasharray', `${((C * v) / 100).toFixed(2)} ${C.toFixed(2)}`);
        return;
      }
      const id = 'fc' + ++FAFF_CHART_ID;
      this.innerHTML = `<svg class="ring" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style="stop-color:var(--c-lift)"></stop>
          <stop offset="52%" style="stop-color:var(--c)"></stop>
          <stop offset="100%" style="stop-color:var(--c-turn)"></stop>
        </linearGradient></defs>
        <circle class="track" cx="50" cy="50" r="${R}" fill="none"></circle>
        <circle class="value" cx="50" cy="50" r="${R}" fill="none" stroke="url(#${id})"
          stroke-dasharray="${((C * v) / 100).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 50 50)"></circle>
      </svg>`;
      return;
    }

    if (type === 'bars') {
      const bars = this.querySelectorAll('.faff-chart-bars>i');
      if (bars.length === vals.length) {
        bars.forEach((b, i) => (b as HTMLElement).style.setProperty('--v', String(vals[i] == null ? 0 : pct(vals[i] as number))));
        return;
      }
      this.innerHTML =
        `<div class="faff-chart-plot"><div class="faff-chart-bars">` +
        vals.map((v, i) => `<i style="--v:${v == null ? 0 : pct(v)};--i:${i}"></i>`).join('') +
        `</div></div>` +
        this._axis(vals.length, false);
      return;
    }

    /* the line is inset from the plot edges so its round caps read as ends, not as cuts */
    const PAD = 3;
    const W = 100 - PAD * 2;
    const step = vals.length > 1 ? W / (vals.length - 1) : 0;
    const pts = vals
      .map((v, i) => (v == null ? null : `${(PAD + i * step).toFixed(2)},${(100 - pct(v)).toFixed(2)}`))
      .filter((p): p is string => Boolean(p))
      .join(' ');
    const existing = this.querySelector('polyline.line');
    if (existing) {
      existing.setAttribute('points', pts);
      return;
    }
    const id = 'fc' + ++FAFF_CHART_ID;
    this.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style="stop-color:var(--c-lift)"></stop>
        <stop offset="52%" style="stop-color:var(--c)"></stop>
        <stop offset="100%" style="stop-color:var(--c-turn)"></stop>
      </linearGradient></defs>
      <polyline class="line" style="stroke:url(#${id})" points="${pts}"></polyline></svg>`;
    /* pathLength normalises the geometry, so a stretched viewBox can never clip the stroke */
    const poly = this.querySelector('polyline');
    if (poly) {
      poly.setAttribute('pathLength', '100');
      poly.style.setProperty('--len', '100');
      poly.style.strokeDasharray = '100';
      poly.addEventListener('animationend', () => {
        poly.style.strokeDasharray = 'none';
      });
      if (!this.hasAttribute('data-enter')) poly.style.strokeDasharray = 'none';
    }
    this.innerHTML = `<div class="faff-chart-plot">${this.innerHTML}</div>` + this._axis(vals.length, true);
  }
}

/** Idempotent: safe to call from every component that renders a <faff-chart>. */
export function registerFaffChart() {
  if (typeof window === 'undefined') return;
  if (!customElements.get('faff-chart')) customElements.define('faff-chart', FaffChart);
}
