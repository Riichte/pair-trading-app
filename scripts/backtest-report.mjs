import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function sma(arr, len) { return arr.map((_, i) => i < len - 1 ? null : arr.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0) / len); }
function stdev(arr, len) { return arr.map((_, i) => { if (i < len - 1) return null; const s = arr.slice(i - len + 1, i + 1); const m = s.reduce((a, b) => a + b, 0) / len; return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / len); }); }
function rsi(closes, len) {
  const out = Array(closes.length).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= len; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) gains += d; else losses -= d; }
  let avgG = gains / len, avgL = losses / len;
  out[len] = 100 - 100 / (1 + avgG / (avgL || 1e-9));
  for (let i = len + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (len - 1) + Math.max(d, 0)) / len;
    avgL = (avgL * (len - 1) + Math.max(-d, 0)) / len;
    out[i] = 100 - 100 / (1 + avgG / (avgL || 1e-9));
  }
  return out;
}

function backtest(closes, dates, params, risk) {
  const { bbLen, rsiLen, zLen, smoothing, scale, ob, os } = params;
  const basis = sma(closes, bbLen);
  const dev = stdev(closes, bbLen);
  const r = rsi(closes, rsiLen);
  const meanP = sma(closes, zLen);
  const stdP = stdev(closes, zLen);

  const composite = [];
  for (let i = 0; i < closes.length; i++) {
    if (basis[i] == null || dev[i] == null || r[i] == null || meanP[i] == null || stdP[i] == null || dev[i] === 0) { composite.push(null); continue; }
    const bbPct = (closes[i] - (basis[i] - 2 * dev[i])) / (4 * dev[i]) * 100;
    const bbScore = (bbPct - 50) / 25 * scale;
    const rsiScore = (r[i] - 50) / 20 * scale;
    const z = Math.max(Math.min((closes[i] - meanP[i]) / (stdP[i] || 1e-9), 4), -4) * 0.5 * scale;
    composite.push((bbScore + rsiScore + z) / 3);
  }
  const smoothed = sma(composite.map(c => c ?? 0), smoothing);

  const START_CASH = 100000;
  const riskMult = risk === 'High' ? 1.3 : risk === 'Med' ? 1.0 : 0.7;
  let shares = 0, cashBag = START_CASH, costBasis = 0, trades = 0, wins = 0;
  const markers = [];

  for (let i = 1; i < closes.length; i++) {
    if (smoothed[i] == null || smoothed[i - 1] == null) continue;
    const crossUp = smoothed[i - 1] <= os && smoothed[i] > os;
    const crossDown = smoothed[i - 1] >= ob && smoothed[i] < ob;

    if (crossUp && cashBag > 0) {
      const depth = Math.min(Math.abs(smoothed[i] - os) / Math.abs(os), 1);
      const buyPct = Math.min(0.1 + depth * 0.5 * riskMult, 0.6);
      const spend = cashBag * buyPct;
      shares += spend / closes[i];
      cashBag -= spend;
      costBasis += spend;
      trades++;
      markers.push({ time: dates[i], position: 'belowBar', color: '#26a69a', shape: 'arrowUp', text: `BUY $${spend.toFixed(0)}` });
    } else if (crossDown && shares > 0) {
      const depth = Math.min(Math.abs(smoothed[i] - ob) / Math.abs(ob), 1);
      const sellPct = Math.min(0.1 + depth * 0.5 * riskMult, 0.6);
      const sellShares = shares * sellPct;
      const avgCost = shares > 0 ? costBasis / shares : 0;
      const proceeds = sellShares * closes[i];
      cashBag += proceeds;
      costBasis -= avgCost * sellShares;
      shares -= sellShares;
      const win = closes[i] > avgCost;
      if (win) wins++;
      trades++;
      markers.push({ time: dates[i], position: 'aboveBar', color: win ? '#26a69a' : '#ef5350', shape: 'arrowDown', text: `SELL $${proceeds.toFixed(0)}` });
    }
  }

  const holdShares = START_CASH / closes[0];
  const finalValue = shares * closes[closes.length - 1] + cashBag;
  const holdValue = holdShares * closes[closes.length - 1];
  const winRate = trades ? (wins / trades) * 100 : 0;

  return {
    markers, trades, wins, losses: trades - wins, winRate,
    finalValue, holdValue, cashBag, shares,
    roi: ((finalValue - START_CASH) / START_CASH) * 100,
  };
}

function renderHTML(ticker, dates, closes, result, params) {
  const priceData = dates.map((d, i) => ({ time: d, value: closes[i] }));
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${ticker} Backtest</title>
<script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
<style>
body { background:#0d0d0d; color:#eee; font-family:sans-serif; margin:0; display:flex; }
#chart { flex:1; }
#stats { width:260px; padding:16px; background:#111; }
#stats table { width:100%; border-collapse:collapse; }
#stats td { padding:6px 4px; border-bottom:1px solid #333; font-size:13px; }
#stats td:last-child { text-align:right; font-weight:bold; }
h2 { padding:12px; margin:0; }
.pos { color:#26a69a; } .neg { color:#ef5350; }
</style></head>
<body>
<div style="flex:1;display:flex;flex-direction:column;">
  <h2>${ticker} — BB${params.bbLen} RSI${params.rsiLen} Z${params.zLen} Smooth${params.smoothing} OB${params.ob} OS${params.os}</h2>
  <div id="chart"></div>
</div>
<div id="stats">
  <h2>Stats</h2>
  <table>
    <tr><td>Total Trades</td><td>${result.trades}</td></tr>
    <tr><td>Wins</td><td class="pos">${result.wins}</td></tr>
    <tr><td>Losses</td><td class="neg">${result.losses}</td></tr>
    <tr><td>Win Rate</td><td class="${result.winRate>=50?'pos':'neg'}">${result.winRate.toFixed(1)}%</td></tr>
    <tr><td>Final Shares</td><td>${result.shares.toFixed(4)}</td></tr>
    <tr><td>Cash Left</td><td>$${result.cashBag.toFixed(0)}</td></tr>
    <tr><td>Final Value</td><td>$${result.finalValue.toFixed(0)}</td></tr>
    <tr><td>Buy&Hold Value</td><td>$${result.holdValue.toFixed(0)}</td></tr>
    <tr><td>ROI</td><td class="${result.roi>=0?'pos':'neg'}">${result.roi.toFixed(1)}%</td></tr>
  </table>
</div>
<script>
const chart = LightweightCharts.createChart(document.getElementById('chart'), {
  layout: { background: { color: '#0d0d0d' }, textColor: '#ddd' },
  grid: { vertLines: { color: '#222' }, horzLines: { color: '#222' } },
  width: window.innerWidth - 260, height: window.innerHeight - 50,
});
const series = chart.addLineSeries({ color: '#2962FF' });
series.setData(${JSON.stringify(priceData)});
series.setMarkers(${JSON.stringify(result.markers)});
</script>
</body></html>`;
}

async function main() {
  const ticker = process.argv[2];
  if (!ticker) { console.log('Usage: node scripts/backtest-report.mjs TICKER'); return; }

  const { data: asset } = await supabase.from('assets').select('*').eq('ticker', ticker).single();
  const { data: sp } = await supabase.from('strategy_params').select('*').eq('ticker', ticker).single();
  const { data } = await supabase.from('daily_prices').select('close, date').eq('ticker', ticker).order('date');

  if (!asset || !sp || !data?.length) { console.log('Missing asset, params, or price data for', ticker); return; }

  const closes = data.map(d => d.close);
  const dates = data.map(d => d.date);
  const params = {
    bbLen: sp.bb_length, rsiLen: sp.rsi_length, zLen: sp.z_length,
    smoothing: sp.smoothing, scale: sp.scale_factor, ob: sp.ob_level, os: sp.os_level,
  };

  const result = backtest(closes, dates, params, asset.risk);
  const html = renderHTML(ticker, dates, closes, result, params);

  fs.mkdirSync('backtest-reports', { recursive: true });
  const path = `backtest-reports/${ticker}.html`;
  fs.writeFileSync(path, html);
  console.log(`Report written to ${path} — open it in your browser`);
}
main();