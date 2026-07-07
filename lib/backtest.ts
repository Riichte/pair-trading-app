export function sma(arr: number[], len: number) {
  return arr.map((_, i) => i < len - 1 ? null : arr.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0) / len);
}
export function stdev(arr: number[], len: number) {
  return arr.map((_, i) => {
    if (i < len - 1) return null;
    const s = arr.slice(i - len + 1, i + 1);
    const m = s.reduce((a, b) => a + b, 0) / len;
    return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / len);
  });
}
export function rsi(closes: number[], len: number) {
  const out: (number | null)[] = Array(closes.length).fill(null);
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

export interface StrategyParams {
  bbLen: number; rsiLen: number; zLen: number; smoothing: number;
  scale: number; ob: number; os: number;
}

export interface Trade {
  index: number; date: string; side: 'BUY' | 'SELL';
  price: number; amount: number; win: boolean | null;
}

export function runBacktest(closes: number[], dates: string[], params: StrategyParams, startCash = 100000) {
  const { bbLen, rsiLen, zLen, smoothing, scale, ob, os } = params;
  const basis = sma(closes, bbLen);
  const dev = stdev(closes, bbLen);
  const r = rsi(closes, rsiLen);
  const meanP = sma(closes, zLen);
  const stdP = stdev(closes, zLen);

  const composite: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (basis[i] == null || dev[i] == null || r[i] == null || meanP[i] == null || stdP[i] == null || dev[i] === 0) {
      composite.push(0); continue;
    }
    const bbPct = (closes[i] - (basis[i]! - 2 * dev[i]!)) / (4 * dev[i]!) * 100;
    const bbScore = (bbPct - 50) / 25 * scale;
    const rsiScore = (r[i]! - 50) / 20 * scale;
    const z = Math.max(Math.min((closes[i] - meanP[i]!) / (stdP[i] || 1e-9), 4), -4) * 0.5 * scale;
    composite.push((bbScore + rsiScore + z) / 3);
  }
  const smoothed = sma(composite, smoothing);

  let shares = 0, cash = startCash, costBasis = 0;
  const trades: Trade[] = [];
  let maxWin = 0, maxLoss = 0, grossProfit = 0, grossLoss = 0, wins = 0, losses = 0;

  for (let i = 1; i < closes.length; i++) {
    if (smoothed[i] == null || smoothed[i - 1] == null) continue;
    const crossUp = smoothed[i - 1]! <= os && smoothed[i]! > os;
    const crossDown = smoothed[i - 1]! >= ob && smoothed[i]! < ob;

    if (crossUp && cash > 0) {
      const depth = Math.min(Math.abs(smoothed[i]! - os) / Math.abs(os), 1);
      const buyPct = Math.min(0.1 + depth * 0.5, 0.6);
      const spend = cash * buyPct;
      shares += spend / closes[i];
      cash -= spend;
      costBasis += spend;
      trades.push({ index: i, date: dates[i], side: 'BUY', price: closes[i], amount: spend, win: null });
    } else if (crossDown && shares > 0) {
      const depth = Math.min(Math.abs(smoothed[i]! - ob) / Math.abs(ob), 1);
      const sellPct = Math.min(0.1 + depth * 0.5, 0.6);
      const sellShares = shares * sellPct;
      const avgCost = shares > 0 ? costBasis / shares : 0;
      const proceeds = sellShares * closes[i];
      const profit = proceeds - avgCost * sellShares;
      cash += proceeds;
      costBasis -= avgCost * sellShares;
      shares -= sellShares;
      const win = profit > 0;
      if (win) { wins++; grossProfit += profit; maxWin = Math.max(maxWin, profit); }
      else { losses++; grossLoss += profit; maxLoss = Math.min(maxLoss, profit); }
      trades.push({ index: i, date: dates[i], side: 'SELL', price: closes[i], amount: proceeds, win });
    }
  }

  const lastPrice = closes[closes.length - 1];
  const unrealized = shares * lastPrice - costBasis;
  const realized = grossProfit + grossLoss;
  const totalValue = shares * lastPrice + cash;
  const roi = ((totalValue - startCash) / startCash) * 100;
  const totalTrades = wins + losses;

  return {
    trades,
    oscillator: smoothed,
    stats: {
      totalTrades, wins, losses,
      winRate: totalTrades ? (wins / totalTrades) * 100 : 0,
      avgWin: wins ? grossProfit / wins : 0,
      avgLoss: losses ? grossLoss / losses : 0,
      maxWin, maxLoss,
      openShares: shares,
      positionValue: shares * lastPrice,
      unrealized, realized,
      totalValue, roi,
      cash,
    },
  };
}