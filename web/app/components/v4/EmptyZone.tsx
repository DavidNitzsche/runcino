/**
 * EmptyZone — drop-in card-body that replaces a data-driven region
 * when the user has no data yet (no runs, no check-ins, etc).
 *
 * Source spec: designs/empty-states-v4.html §Generic empty-zone treatment.
 *
 * Used inside cards where a chart, list, or table would normally
 * render. Renders a dashed-border box with an icon, title, sub-copy,
 * and optional CTA buttons.
 */

import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  sub?: ReactNode;
  /** Optional action row — provide one or more buttons. */
  actions?: ReactNode;
}

export function EmptyZone({ icon = '●', title, sub, actions }: Props) {
  return (
    <div className="faff-empty-zone">
      <div className="faff-empty-zone-icon">{icon}</div>
      <div className="faff-empty-zone-title">{title}</div>
      {sub && <div className="faff-empty-zone-sub">{sub}</div>}
      {actions && <div className="faff-empty-zone-actions">{actions}</div>}

      <style jsx>{`
        .faff-empty-zone {
          padding: 36px 28px;
          background: rgba(13,15,18,.025);
          border: 1.5px dashed rgba(13,15,18,.08);
          border-radius: 14px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .faff-empty-zone-icon {
          width: 48px; height: 48px; border-radius: 50%;
          background: rgba(13,15,18,.04);
          display: flex; align-items: center; justify-content: center;
          color: rgba(13,15,18,.40);
          font-family: 'Inter', sans-serif; font-size: 20px;
        }
        .faff-empty-zone-title {
          font-family: 'Inter', sans-serif; font-weight: 700; font-size: 15px;
          color: #0D0F12;
        }
        .faff-empty-zone-sub {
          font-family: 'Inter', sans-serif; font-size: 13px;
          color: rgba(13,15,18,.55); line-height: 1.55;
          max-width: 480px;
        }
        .faff-empty-zone-actions { display: flex; gap: 8px; margin-top: 6px; }
      `}</style>
    </div>
  );
}

/** Helper button used inside EmptyZone actions */
export function EmptyZoneButton({
  href,
  variant = 'secondary',
  children,
}: {
  href: string;
  variant?: 'primary' | 'secondary' | 'strava';
  children: ReactNode;
}) {
  return (
    <>
      <a className={`faff-empty-btn faff-empty-btn-${variant}`} href={href}>
        {children}
      </a>
      <style jsx>{`
        .faff-empty-btn {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
          padding: 10px 16px; border-radius: 8px; cursor: pointer;
          border: 1px solid rgba(13,15,18,.16);
          background: transparent; color: rgba(13,15,18,.55);
          text-decoration: none; white-space: nowrap;
        }
        .faff-empty-btn:hover { background: rgba(13,15,18,.04); color: #0D0F12; }
        .faff-empty-btn-strava {
          background: #FC4C02; color: #fff; border-color: #FC4C02;
        }
        .faff-empty-btn-strava:hover { background: #E04400; color: #fff; }
        .faff-empty-btn-primary {
          background: #0D0F12; color: #fff; border-color: #0D0F12;
        }
        .faff-empty-btn-primary:hover { background: rgba(13,15,18,.85); }
      `}</style>
    </>
  );
}
