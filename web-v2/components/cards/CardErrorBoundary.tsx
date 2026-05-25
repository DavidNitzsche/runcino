'use client';

import { Component, type ReactNode } from 'react';

/**
 * Per-card error boundary. One bad topic must not crash the whole page.
 * Renders a quiet "(card unavailable)" placeholder + logs in dev.
 */
export class CardErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[card error]', this.props.label ?? 'unknown', error);
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ padding: '14px 16px', opacity: 0.4 }}>
          <div className="card-eyebrow" style={{ color: 'var(--mute)' }}>
            CARD UNAVAILABLE
          </div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)' }}>
            {this.props.label ?? 'A card failed to render. The rest of the page is fine.'}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
