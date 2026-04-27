import Link from 'next/link';

export function Nav({ active }: { active?: 'plan' | 'races' | 'retrospective' | 'training' | 'research' | 'settings' | 'overview' }) {
  const links: Array<{ href: string; key: string; label: string; pill?: string }> = [
    { href: '/',                        key: 'plan',          label: 'Build plan' },
    { href: '/races',                   key: 'races',         label: 'Races' },
    { href: '/training',                key: 'training',      label: 'Training' , pill: 'M3' },
    { href: '/retrospective',           key: 'retrospective', label: 'Retrospective', pill: 'M1' },
    { href: '/research',                key: 'research',      label: 'Research' },
    { href: '/settings/integrations',   key: 'settings',      label: 'Data' , pill: 'M2' },
  ];
  return (
    <nav style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '20px 0',
      borderBottom: '1px solid var(--color-line)',
    }}>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
        <div className="brand-mark">R</div>
        <span className="font-display" style={{ fontSize: 20, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--color-ink)' }}>Runcino</span>
      </Link>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', fontSize: 14 }}>
        {links.map(l => {
          const isActive = l.key === active;
          return (
            <Link key={l.key} href={l.href} style={{
              color: isActive ? 'var(--color-terracotta)' : 'var(--color-ink-2)',
              textDecoration: 'none',
              fontWeight: isActive ? 600 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}>
              {l.label}
              {l.pill && (
                <span style={{
                  padding: '2px 6px',
                  background: 'var(--color-paper-2)',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--color-ink-3)',
                }}>{l.pill}</span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function Footer({ tag }: { tag?: string }) {
  return (
    <footer style={{
      padding: '32px 0',
      borderTop: '1px solid var(--color-line)',
      color: 'var(--color-ink-3)',
      fontSize: 13,
      display: 'flex',
      justifyContent: 'space-between',
    }}>
      <div>Runcino · localhost · personal build</div>
      <div>{tag ?? 'v0.1.0'}</div>
    </footer>
  );
}
