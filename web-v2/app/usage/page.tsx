/**
 * /usage — daily LLM spend dashboard (P43).
 *
 * Quick way to see: am I burning credits at a normal rate or testing spike?
 */
import { TopNav } from '@/components/layout/TopNav';
import { dailyRollup } from '@/lib/coach/usage';

export const dynamic = 'force-dynamic';

export default async function UsagePage() {
  const { by_day, total_cost_usd } = await dailyRollup(30);

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 1000, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, margin: 0, letterSpacing: '0.5px' }}>
          Usage.
        </h1>
        <p style={{ color: 'var(--mute)', fontSize: 13, lineHeight: 1.55, marginTop: 12, marginBottom: 24 }}>
          Coach LLM spend, last 30 days. Counts every <code>generateBriefing()</code> call — both
          user-initiated and background warms. Cost computed from per-token Anthropic pricing at
          insert time, so historical rows stay accurate even if prices change.
        </p>

        <div style={{
          background: 'rgba(62,189,65,0.08)', border: '1px solid rgba(62,189,65,0.30)',
          borderRadius: 14, padding: '18px 22px', marginBottom: 28,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--green)' }}>
            30-DAY TOTAL
          </div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 48, color: 'var(--ink)', marginTop: 4 }}>
            ${total_cost_usd.toFixed(2)}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'var(--mute)', fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase' }}>
              <th style={{ textAlign: 'left',  padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>Date</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>Briefings</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>Rounds</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>Input tok</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>Output tok</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>Cache hit %</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {by_day.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '20px 12px', color: 'var(--mute)' }}>No briefings logged yet. The first one will land on the next coach call.</td></tr>
            )}
            {by_day.map((d) => {
              const cacheHitPct = d.input_tokens > 0
                ? Math.round((d.cache_read_tokens / (d.input_tokens + d.cache_read_tokens)) * 100)
                : 0;
              return (
                <tr key={d.date} style={{ color: 'rgba(246,247,248,0.85)' }}>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>{d.date}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>{d.briefings}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>{d.rounds}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>{d.input_tokens.toLocaleString()}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>{d.output_tokens.toLocaleString()}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', textAlign: 'right', color: cacheHitPct > 50 ? 'var(--green)' : 'var(--mute)' }}>
                    {cacheHitPct}%
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', textAlign: 'right', fontWeight: 600, color: 'var(--ink)' }}>
                    ${d.cost_usd.toFixed(d.cost_usd < 0.01 ? 4 : 2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p style={{ color: 'var(--mute)', fontSize: 11, marginTop: 24, lineHeight: 1.6 }}>
          Pricing snapshot: sonnet-4-5 input $3/M, output $15/M, cache-creation $3.75/M, cache-read $0.30/M.
          When Anthropic updates pricing, edit <code>web-v2/lib/coach/usage.ts</code> — historical rows
          keep the cost stamped at insert time.
        </p>
      </div>
    </main>
  );
}
