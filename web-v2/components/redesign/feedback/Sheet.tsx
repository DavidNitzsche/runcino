import type { CSSProperties, ReactNode } from 'react';
import { IconButton } from '@/components/redesign/core/IconButton';

/**
 * components/redesign/feedback/Sheet.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/ui_kits/web/WebSheet.jsx), 2026-08-18. The
 * shared modal/panel shell every level-3 web screen in this batch renders
 * inside (Gear, Settings, CoachReply, LogSheet, RunAction) — none of those
 * screens are wired up yet (out of scope for this pass), but this is the
 * shell they will all mount into.
 *
 * Faithful port: same tokens, same fixed-right-edge-panel-over-scrim
 * construction, same header (kicker + display title + close IconButton)
 * and optional footer. One structural adaptation: the source inlines its
 * keyframe with a `<style>` tag injected on every mount
 * (`@keyframes faff-sheet-in{...}`) — moved to the shared
 * app/redesign/tokens/base.css stylesheet instead (checked first; it did
 * not already exist there) so the keyframe is declared once, not
 * re-injected as a new <style> tag on every Sheet instance. The panel
 * carries a `faff-sheet` class so base.css's
 * `prefers-reduced-motion: reduce` guard can suppress the slide-in, which
 * the source's inline version had no way to do.
 */

export interface SheetProps {
  title: string;
  /** One quiet line above the title, e.g. "Settings", "About your CIM goal". */
  kicker?: string;
  onClose?: () => void;
  width?: number;
  children?: ReactNode;
  footer?: ReactNode;
  style?: CSSProperties;
}

/**
 * One shell for every level-3 sheet: log/edit, coach reply, settings. A milled panel off the
 * right edge, over whatever surface was showing — never a route, never full-bleed.
 */
export function Sheet({ title, kicker, onClose, width = 460, children, footer, style }: SheetProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)' }} />
      <div
        className="faff-sheet"
        style={{
          position: 'relative', width, maxWidth: '92vw', height: '100%', background: 'var(--surface-page)',
          boxShadow: 'var(--elevation-sheet)', display: 'flex', flexDirection: 'column', overflowX: 'hidden',
          animation: 'faff-sheet-in var(--dur-3,320ms) var(--ease-out,cubic-bezier(.2,.7,.3,1)) backwards',
          ...style,
        }}
      >
        <div style={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--sp-8) var(--sp-9)', boxShadow: 'inset 0 -1px 0 var(--rule-light)',
        }}>
          <div>
            {kicker && (
              <div style={{
                fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
                letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
              }}>
                {kicker}
              </div>
            )}
            <div className="faff-display" style={{ fontSize: 'var(--type-display-3)', marginTop: kicker ? 4 : 0 }}>{title}</div>
          </div>
          <IconButton name="x" onClick={onClose} label="Close" />
        </div>
        <div style={{
          flex: '1 1 auto', minHeight: 0, minWidth: 0, overflowY: 'auto', overflowX: 'hidden',
          padding: 'var(--sp-9)', display: 'grid', gap: 'var(--sp-8)', alignContent: 'start',
        }}>
          {children}
        </div>
        {footer && (
          <div style={{
            flex: '0 0 auto', padding: 'var(--sp-8) var(--sp-9)', boxShadow: 'inset 0 1px 0 var(--rule-light)',
            display: 'flex', gap: 'var(--sp-5)', justifyContent: 'flex-end',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
