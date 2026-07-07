import { createClient } from '@supabase/supabase-js';
import { runBacktest } from '@/lib/backtest';
import ParamsForm from './ParamsForm';
import SyncedCharts from './SyncedCharts';


const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export default async function AssetPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;

  const { data: sp } = await supabase.from('strategy_params').select('*').eq('ticker', ticker).single();
  const { data: rows } = await supabase.from('daily_prices').select('date, close').eq('ticker', ticker).order('date');

  if (!rows?.length) {
    return <main style={{ padding: 24 }}>Missing daily_prices for {ticker}</main>;
  }
  if (!sp) {
    return (
      <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
        <h1>{ticker}</h1>
        <ParamsForm ticker={ticker} initial={sp} />
        <p>No strategy params yet — set them below.</p>
        <ParamsForm ticker={ticker} initial={null} />
      </main>
    );
  }

  const closes = rows.map(r => r.close);
  const dates = rows.map(r => r.date);
  const { trades, stats, oscillator } = runBacktest(closes, dates, {
    bbLen: sp.bb_length, rsiLen: sp.rsi_length, zLen: sp.z_length,
    smoothing: sp.smoothing, scale: sp.scale_factor, ob: sp.ob_level, os: sp.os_level,
  });

  const priceData = dates.map((d, i) => ({ time: d, value: closes[i] }));

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>{ticker}</h1>
      <ParamsForm ticker={ticker} initial={sp} />
      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <SyncedCharts priceData={priceData} trades={trades} dates={dates} oscillator={oscillator} ob={sp.ob_level} os={sp.os_level} />
        </div>
        <div style={{ width: 260 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr><td>Total Trades</td><td>{stats.totalTrades}</td></tr>
              <tr><td>Wins</td><td style={{ color: '#26a69a' }}>{stats.wins}</td></tr>
              <tr><td>Losses</td><td style={{ color: '#ef5350' }}>{stats.losses}</td></tr>
              <tr><td>Win Rate</td><td>{stats.winRate.toFixed(1)}%</td></tr>
              <tr><td>Avg Win</td><td>${stats.avgWin.toFixed(0)}</td></tr>
              <tr><td>Avg Loss</td><td>${stats.avgLoss.toFixed(0)}</td></tr>
              <tr><td>Max Win</td><td>${stats.maxWin.toFixed(0)}</td></tr>
              <tr><td>Max Loss</td><td>${stats.maxLoss.toFixed(0)}</td></tr>
              <tr><td>Open Shares</td><td>{stats.openShares.toFixed(4)}</td></tr>
              <tr><td>Position Value</td><td>${stats.positionValue.toFixed(0)}</td></tr>
              <tr><td>Unrealized P&L</td><td>${stats.unrealized.toFixed(0)}</td></tr>
              <tr><td>Realized P&L</td><td>${stats.realized.toFixed(0)}</td></tr>
              <tr><td>Cash</td><td>${stats.cash.toFixed(0)}</td></tr>
              <tr><td>Total Value</td><td>${stats.totalValue.toFixed(0)}</td></tr>
              <tr><td>ROI</td><td style={{ color: stats.roi >= 0 ? '#26a69a' : '#ef5350' }}>{stats.roi.toFixed(1)}%</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}