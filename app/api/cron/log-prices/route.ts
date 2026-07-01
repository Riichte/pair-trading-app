import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MANUAL_TICKERS = ['GNS'];
const ATH_FILTER_PCT = 0.15;
const DIV_THRESHOLD = 0.10;

function isMarketHours(date: Date) {
  const utcHr = date.getUTCHours();
  const utcMin = date.getUTCMinutes();
  const etHr = utcHr - 4;
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = etHr * 60 + utcMin;
  return mins >= 570 && mins <= 960;
}

async function fetchPrice(ticker: string) {
  const res = await fetch(
    `https://api.twelvedata.com/quote?symbol=${ticker}&apikey=${process.env.TWELVE_DATA_API_KEY}`
  );
  const data = await res.json();
  if (!data.close) return null;
  return {
    price: parseFloat(data.close),
    changePct: parseFloat(data.percent_change) / 100,
  };
}

async function scanPairs(rows: any[], assets: any[]) {
  const priceMap: Record<string, number> = {};
  const changeMap: Record<string, number> = {};
  rows.forEach(r => {
    if (r.price !== null) priceMap[r.ticker] = r.price;
    if (r.change_pct !== null) changeMap[r.ticker] = r.change_pct;
  });

  const assetMap: Record<string, any> = {};
  assets.forEach(a => (assetMap[a.ticker] = a));
  const tickers = assets.map(a => a.ticker);

  const alerts: any[] = [];

  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const a = tickers[i], b = tickers[j];
      const pA = priceMap[a], pB = priceMap[b];
      const cA = changeMap[a], cB = changeMap[b];
      const zA = assetMap[a], zB = assetMap[b];

      let divSignal = false, zoneSignal = false, divergence: number | null = null;
      if (cA !== undefined && cB !== undefined) {
        divergence = cA - cB;
        if (Math.abs(divergence) >= DIV_THRESHOLD) divSignal = true;
      }

      const aInSell = zA?.sell_zone_1 && pA >= zA.sell_zone_1;
      const aInBuy = zA?.buy_zone_1 && pA <= zA.buy_zone_1;
      const bInSell = zB?.sell_zone_1 && pB >= zB.sell_zone_1;
      const bInBuy = zB?.buy_zone_1 && pB <= zB.buy_zone_1;

      if ((aInSell && bInBuy) || (aInBuy && bInSell)) {
        if (aInSell && !zA.owned) zoneSignal = false;
        else if (bInSell && !zB.owned) zoneSignal = false;
        else zoneSignal = true;
      }

      if (divSignal || zoneSignal) {
        const strength = divSignal && zoneSignal ? 'STRONG' : divSignal ? 'DIV' : 'ZONE';
        let athFlag = '';
        if (aInBuy && zA.ath && pA >= zA.ath * (1 - ATH_FILTER_PCT)) athFlag = `NO TRADE — ${a} near ATH`;
        if (bInBuy && zB.ath && pB >= zB.ath * (1 - ATH_FILTER_PCT)) athFlag = `NO TRADE — ${b} near ATH`;

        alerts.push({
          ticker_a: a, ticker_b: b, strength, divergence_pct: divergence,
          change_a_pct: cA ?? null, change_b_pct: cB ?? null,
          zone_a: aInSell ? 'SELL' : aInBuy ? 'BUY' : null,
          zone_b: bInSell ? 'SELL' : bInBuy ? 'BUY' : null,
          price_a: pA ?? null, price_b: pB ?? null,
        });
      }
    }
  }
  return alerts;
}

export async function GET() {
  const now = new Date();
  const marketOpen = isMarketHours(now);

  const { data: assets } = await supabase
    .from('assets')
    .select('*')
    .eq('active', true);

  if (!assets) return NextResponse.json({ error: 'no assets' }, { status: 500 });

  const rows = [];
  for (const { ticker } of assets) {
    if (MANUAL_TICKERS.includes(ticker)) continue;
    const result = await fetchPrice(ticker);
    rows.push({
      ticker,
      price: result?.price ?? null,
      change_pct: result?.changePct ?? null,
      is_market_hours: marketOpen,
      logged_at: now.toISOString(),
    });
  }

  const { error } = await supabase.from('prices').insert(rows);
  if (error) return NextResponse.json({ error }, { status: 500 });

  const alerts = await scanPairs(rows, assets);
  if (alerts.length) {
    await supabase.from('alerts').insert(alerts);
  }

  return NextResponse.json({ logged: rows.length, alerts: alerts.length, at: now.toISOString() });
}