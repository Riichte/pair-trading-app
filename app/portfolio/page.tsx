import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export default async function Portfolio() {
  const { data: assets } = await supabase.from('assets').select('*').eq('owned', true);

  const tickers = (assets ?? []).map(a => a.ticker);
  const { data: latest } = await supabase
    .from('prices')
    .select('ticker, price, logged_at')
    .in('ticker', tickers)
    .order('logged_at', { ascending: false });

  const latestPrice: Record<string, number> = {};
  latest?.forEach(r => {
    if (!(r.ticker in latestPrice) && r.price !== null) latestPrice[r.ticker] = r.price;
  });

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Portfolio</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>
            <th>Ticker</th><th>Avg Cost</th><th>Current</th><th>P&L %</th><th>Zone</th>
          </tr>
        </thead>
        <tbody>
          {assets?.map(a => {
            const cur = latestPrice[a.ticker];
            const pnl = a.avg_cost && cur ? ((cur - a.avg_cost) / a.avg_cost) * 100 : null;
            const zone = a.sell_zone_1 && cur >= a.sell_zone_1 ? 'SELL'
              : a.buy_zone_1 && cur <= a.buy_zone_1 ? 'BUY' : '—';
            return (
              <tr key={a.ticker} style={{ borderBottom: '1px solid #222' }}>
                <td>{a.ticker}</td>
                <td>{a.avg_cost ?? '—'}</td>
                <td>{cur ?? '—'}</td>
                <td style={{ color: pnl && pnl >= 0 ? '#4caf50' : '#f44336' }}>
                  {pnl !== null ? pnl.toFixed(1) + '%' : '—'}
                </td>
                <td>{zone}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}