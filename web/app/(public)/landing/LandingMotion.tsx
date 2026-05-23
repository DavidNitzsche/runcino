'use client';

import { useEffect } from 'react';

/**
 * Marketing-page motion, kept entirely DOM-driven so the page itself stays a
 * server component. On mount it wires:
 *   - scroll reveals  (.fr-reveal → .in once in view)
 *   - count-ups       ([data-countup] animates 0 → value when revealed)
 *   - device cycling  (.fr-cycle children rotate an .active class)
 *   - shot scaling    (.fr-shot iframes scale to fit their .fr-shot-wrap, so
 *                      a full 1280px real-app screen renders crisp inside a
 *                      device/browser frame at any width)
 * All effects no-op gracefully if the markup isn't present and respect
 * prefers-reduced-motion.
 */
export function LandingMotion() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── Responsive iframe scaling ───────────────────────────────────
    const scaleShots = () => {
      document.querySelectorAll<HTMLElement>('.fr-shot-wrap').forEach((wrap) => {
        const shot = wrap.querySelector<HTMLElement>('.fr-shot');
        if (!shot) return;
        const dw = parseFloat(shot.getAttribute('data-w') || '1280');
        const dh = parseFloat(shot.getAttribute('data-h') || '820');
        const s = wrap.clientWidth / dw;
        shot.style.transform = `scale(${s})`;
        wrap.style.height = `${Math.round(dh * s)}px`;
      });
    };
    scaleShots();
    // settle after fonts/layout
    const raf = requestAnimationFrame(scaleShots);
    const ro = 'ResizeObserver' in window ? new ResizeObserver(scaleShots) : null;
    document.querySelectorAll<HTMLElement>('.fr-shot-wrap').forEach((w) => ro?.observe(w));
    window.addEventListener('resize', scaleShots);

    // ── Scroll reveals + count-ups ──────────────────────────────────
    const revealEls = Array.from(document.querySelectorAll<HTMLElement>('.fr-reveal'));
    if (reduce) {
      revealEls.forEach((el) => el.classList.add('in'));
      document.querySelectorAll<HTMLElement>('[data-countup]').forEach((el) => {
        el.textContent = el.getAttribute('data-countup') ?? el.textContent;
      });
    }

    const runCountUp = (el: HTMLElement) => {
      if (el.dataset.counted) return;
      el.dataset.counted = '1';
      const target = parseFloat(el.getAttribute('data-countup') || '0');
      const decimals = (el.getAttribute('data-countup') || '').includes('.') ? 1 : 0;
      const prefix = el.getAttribute('data-prefix') || '';
      const suffix = el.getAttribute('data-suffix') || '';
      const dur = 1100;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = `${prefix}${(target * eased).toFixed(decimals)}${suffix}`;
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    let io: IntersectionObserver | null = null;
    if (!reduce && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const el = entry.target as HTMLElement;
            el.classList.add('in');
            el.querySelectorAll<HTMLElement>('[data-countup]').forEach(runCountUp);
            if (el.matches('[data-countup]')) runCountUp(el);
            io!.unobserve(el);
          });
        },
        { threshold: 0.18, rootMargin: '0px 0px -6% 0px' },
      );
      revealEls.forEach((el) => io!.observe(el));
      document
        .querySelectorAll<HTMLElement>('[data-countup]')
        .forEach((el) => { if (!el.closest('.fr-reveal')) io!.observe(el); });
    }

    // ── Hero parallax (mouse) ───────────────────────────────────────
    const stage = document.querySelector<HTMLElement>('.fr-stage');
    let onMove: ((e: MouseEvent) => void) | null = null;
    if (stage && !reduce && window.matchMedia('(pointer:fine)').matches) {
      const layers = Array.from(stage.querySelectorAll<HTMLElement>('[data-depth]'));
      onMove = (e: MouseEvent) => {
        const r = stage.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        layers.forEach((l) => {
          const d = parseFloat(l.getAttribute('data-depth') || '0');
          l.style.setProperty('--px', `${-dx * d * 26}px`);
          l.style.setProperty('--py', `${-dy * d * 26}px`);
        });
      };
      window.addEventListener('mousemove', onMove, { passive: true });
    }

    // ── Device screen cycling ───────────────────────────────────────
    const cyclers = Array.from(document.querySelectorAll<HTMLElement>('.fr-cycle'));
    const timers: number[] = [];
    if (!reduce) {
      cyclers.forEach((cycler) => {
        const slides = Array.from(cycler.children) as HTMLElement[];
        if (slides.length < 2) return;
        const interval = parseInt(cycler.getAttribute('data-interval') || '3000', 10);
        let i = 0;
        slides.forEach((s, idx) => s.classList.toggle('active', idx === 0));
        timers.push(window.setInterval(() => {
          slides[i].classList.remove('active');
          i = (i + 1) % slides.length;
          slides[i].classList.add('active');
        }, interval));
      });
    } else {
      cyclers.forEach((c) => (c.children[0] as HTMLElement)?.classList.add('active'));
    }

    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      ro?.disconnect();
      window.removeEventListener('resize', scaleShots);
      if (onMove) window.removeEventListener('mousemove', onMove);
      timers.forEach((t) => clearInterval(t));
    };
  }, []);

  return null;
}
