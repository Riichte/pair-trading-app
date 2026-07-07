import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
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

function backtest(closes, params, risk) {
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
  let shares = 0, cashBag = START_CASH, trades = 0, wins = 0;
  let costBasis = 0; // total cash spent on current shares

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
    } else if (crossDown && shares > 0) {
      const depth = Math.min(Math.abs(smoothed[i] - ob) / Math.abs(ob), 1);
      const sellPct = Math.min(0.1 + depth * 0.5 * riskMult, 0.6);
      const sellShares = shares * sellPct;
      const avgCost = shares > 0 ? costBasis / shares : 0;
      cashBag += sellShares * closes[i];
      costBasis -= avgCost * sellShares;
      shares -= sellShares;
      if (closes[i] > avgCost) wins++;
      trades++;
    }
  }

  const holdShares = START_CASH / closes[0];
  const finalValue = shares * closes[closes.length - 1] + cashBag;
  const holdValue = holdShares * closes[closes.length - 1];
  const shareAdvantage = holdShares > 0 ? shares / holdShares : 0;
  const winRate = trades ? wins / trades : 0;
  const rawScore = shareAdvantage * (finalValue / (holdValue || 1)) * (0.5 + winRate);
  const score = trades >= 5 && isFinite(rawScore) ? Math.min(rawScore, 20) : -999;
  const avgReturn = finalValue && holdValue ? (finalValue - holdValue) / holdValue : 0;

  return { winRate, avgReturn, trades, score };
}

async function optimizeTicker(ticker, risk) {
  const { data } = await supabase.from('daily_prices').select('close, date').eq('ticker', ticker).order('date');
  const closes = data.map(d => d.close);
  if (closes.length < 100) return null;

  let best = null;
  for (const bbLen of [50, 100, 150]) for (const rsiLen of [10, 14, 21]) for (const zLen of [30, 50, 70])
    for (const smoothing of [2, 3, 5]) for (const scale of [1.2, 1.8, 2.4]) for (const ob of [1.0, 1.5, 2.0]) for (const os of [-1.0, -1.5, -2.0]) {
      const result = backtest(closes, { bbLen, rsiLen, zLen, smoothing, scale, ob, os }, risk);
      if (!best || result.score > best.score) best = { ...result, bbLen, rsiLen, zLen, smoothing, scale, ob, os };
    }
  return best;
}

async function main() {
  const { data: assets } = await supabase.from('assets').select('ticker, risk').eq('active', true);
  for (const { ticker, risk } of assets) {
    console.log(`Optimizing ${ticker}...`);
    const best = await optimizeTicker(ticker, risk);
    if (!best) { console.log(`  skip (not enough data)`); continue; }
    await supabase.from('strategy_params').upsert({
      ticker, bb_length: best.bbLen, rsi_length: best.rsiLen, z_length: best.zLen,
      smoothing: best.smoothing, scale_factor: best.scale, ob_level: best.ob, os_level: best.os,
      score: best.score, win_rate: best.winRate, avg_return: best.avgReturn, trades: best.trades,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'ticker' });
    console.log(`  best: score=${best.score.toFixed(3)} winRate=${(best.winRate * 100).toFixed(0)}% trades=${best.trades}`);
  }
}
main();