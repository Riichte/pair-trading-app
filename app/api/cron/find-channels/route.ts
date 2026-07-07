import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MIN_CHANNEL_WIDTH_PCT = 10;
const MIN_TOUCHES = 3;
const MIN_R2 = 0.7;

function riskTolerance(risk: string) {
  if (risk === 'High') return 0.08;
  if (risk === 'Med') return 0.06;
  return 0.05;
}

function linreg(points: { idx: number; val: number }[]) {
  const n = points.length;
  if (n < 2) return null;
  const sumX = points.reduce((s, p) => s + p.idx, 0);
  const sumY = points.reduce((s, p) => s + p.val, 0);
  const sumXY = points.reduce((s, p) => s + p.idx * p.val, 0);
  const sumXX = points.reduce((s, p) => s + p.idx * p.idx, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.val - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.val - (slope * p.idx + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

function detectRatioChannels(
  series: { idx: number; date: string; val: number }[],
  touchTolerance: number,
  minTouches: number
) {
  if (series.length < 10) return [];

  const SWING_WINDOW = 5; // days on each side that must confirm the swing
  const localMins: typeof series = [];
  const localMaxs: typeof series = [];
  for (let i = SWING_WINDOW; i < series.length - SWING_WINDOW; i++) {
    const window = series.slice(i - SWING_WINDOW, i + SWING_WINDOW + 1);
    const curr = series[i].val;
    const isMin = window.every(p => p.val >= curr);
    const isMax = window.every(p => p.val <= curr);
    if (isMin) localMins.push(series[i]);
    if (isMax) localMaxs.push(series[i]);
  }

  function clusterLevels(points: typeof series) {
    const clusters: { level: number; touches: typeof series }[] = [];
    for (const pt of points) {
      let merged = false;
      for (const cl of clusters) {
        if (Math.abs(pt.val - cl.level) / cl.level <= touchTolerance) {
          cl.touches.push(pt);
          cl.level = cl.touches.reduce((s, p) => s + p.val, 0) / cl.touches.length;
          merged = true;
          break;
        }
      }
      if (!merged) clusters.push({ level: pt.val, touches: [pt] });
    }
    return clusters
      .filter(cl => cl.touches.length >= minTouches)
      .sort((a, b) => b.touches.length - a.touches.length);
  }

  const floorClusters = clusterLevels(localMins);
  const ceilClusters = clusterLevels(localMaxs);
  if (!floorClusters.length || !ceilClusters.length) return [];

  const results = [];
  for (const floor of floorClusters.slice(0, 3)) {
    for (const ceiling of ceilClusters.slice(0, 3)) {
      if (ceiling.level <= floor.level) continue;
      const channelWidthPct = ((ceiling.level - floor.level) / floor.level) * 100;

      const allTouches = [...floor.touches, ...ceiling.touches].sort((a, b) => a.idx - b.idx);
      let avgHrsBetweenTouches: number | null = null;
      if (allTouches.length >= 2) {
        const gaps = [];
        for (let i = 1; i < allTouches.length; i++) gaps.push(allTouches[i].idx - allTouches[i - 1].idx);
        avgHrsBetweenTouches = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
      }

      const inChannel = series.filter(
        p => p.val >= floor.level * (1 - touchTolerance) && p.val <= ceiling.level * (1 + touchTolerance)
      ).length;
      const confidence = Math.round((inChannel / series.length) * 100);

      const floorLine = linreg(floor.touches.map(p => ({ idx: p.idx, val: p.val })));
      const ceilLine = linreg(ceiling.touches.map(p => ({ idx: p.idx, val: p.val })));

      let channelType = 'horizontal';
      let apexDate: string | null = null;
      if (floorLine && ceilLine && floorLine.r2 >= MIN_R2 && ceilLine.r2 >= MIN_R2) {
        const slopeDiff = Math.abs(floorLine.slope - ceilLine.slope);
        const avgSlope = (Math.abs(floorLine.slope) + Math.abs(ceilLine.slope)) / 2;
        const sameSign = Math.sign(floorLine.slope) === Math.sign(ceilLine.slope);
        if (sameSign && (avgSlope === 0 || slopeDiff / avgSlope < 0.3)) {
          channelType =
            floorLine.slope > 0 ? 'parallel_ascending' : floorLine.slope < 0 ? 'parallel_descending' : 'horizontal';
        } else if (floorLine.slope !== ceilLine.slope) {
          const apexIdx = (ceilLine.intercept - floorLine.intercept) / (floorLine.slope - ceilLine.slope);
          const lastIdx = series[series.length - 1].idx;
          if (apexIdx > lastIdx) {
            channelType = 'wedge';
            const daysAhead = Math.round(apexIdx - lastIdx);
            const lastDate = new Date(series[series.length - 1].date);
            lastDate.setDate(lastDate.getDate() + daysAhead);
            apexDate = lastDate.toISOString().split('T')[0];
          }
        }
      }

      results.push({
        floor: floor.level,
        ceiling: ceiling.level,
        floorTouches: floor.touches.length,
        ceilTouches: ceiling.touches.length,
        channelWidthPct,
        avgHrsBetweenTouches,
        confidence,
        floorLine,
        ceilLine,
        channelType,
        apexDate,
      });
    }
  }
  return results.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

export async function GET() {
  const { data: assets } = await supabase.from('assets').select('*').eq('active', true);
  if (!assets) return NextResponse.json({ error: 'no assets' }, { status: 500 });

  const { data: priceRows } = await supabase
    .from('daily_prices')
    .select('ticker, close, date')
    .order('date', { ascending: true });

  if (!priceRows) return NextResponse.json({ error: 'no prices' }, { status: 500 });

  const byTime: Record<string, Record<string, number>> = {};
  for (const r of priceRows) {
    if (r.close === null) continue;
    if (!byTime[r.date]) byTime[r.date] = {};
    byTime[r.date][r.ticker] = r.close;
  }
  const dates = Object.keys(byTime).sort();

  const assetMap: Record<string, any> = {};
  assets.forEach(a => (assetMap[a.ticker] = a));
  const tickers = assets.map(a => a.ticker);

  const channels: any[] = [];

  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const a = tickers[i], b = tickers[j];
      const pricesA = dates.map(d => byTime[d][a]).filter(v => v > 0);
      const pricesB = dates.map(d => byTime[d][b]).filter(v => v > 0);
      if (!pricesA.length || !pricesB.length) continue;

      const avgA = pricesA.reduce((s, v) => s + v, 0) / pricesA.length;
      const avgB = pricesB.reduce((s, v) => s + v, 0) / pricesB.length;

      const numTicker = avgA >= avgB ? a : b;
      const denTicker = avgA >= avgB ? b : a;

      const series: { idx: number; date: string; val: number }[] = [];
      let idx = 0;
      for (const d of dates) {
        const pNum = byTime[d][numTicker], pDen = byTime[d][denTicker];
        if (pNum > 0 && pDen > 0) {
          series.push({ idx, date: d, val: pNum / pDen });
          idx++;
        }
      }

      const infoA = assetMap[a], infoB = assetMap[b];
      const tolerance = Math.max(
        infoA.touch_tolerance_override || riskTolerance(infoA.risk),
        infoB.touch_tolerance_override || riskTolerance(infoB.risk)
      );

      const channelResults = detectRatioChannels(series, tolerance, MIN_TOUCHES).filter(
        c => c.channelWidthPct >= MIN_CHANNEL_WIDTH_PCT
      );
      if (!channelResults.length) continue;

      channelResults.forEach((channel, rank) => {
        channels.push({
          pair: `${numTicker}/${denTicker}`,
          rank: rank + 1,
          num_ticker: numTicker,
          den_ticker: denTicker,
          floor: channel.floor,
          ceiling: channel.ceiling,
          width_pct: channel.channelWidthPct,
          confidence: channel.confidence,
          floor_touches: channel.floorTouches,
          ceil_touches: channel.ceilTouches,
          avg_hrs_between_touches: channel.avgHrsBetweenTouches,
          channel_type: channel.channelType,
          slope_floor: channel.floorLine?.slope ?? null,
          intercept_floor: channel.floorLine?.intercept ?? null,
          r2_floor: channel.floorLine?.r2 ?? null,
          slope_ceil: channel.ceilLine?.slope ?? null,
          intercept_ceil: channel.ceilLine?.intercept ?? null,
          r2_ceil: channel.ceilLine?.r2 ?? null,
          apex_date: channel.apexDate,
          updated_at: new Date().toISOString(),
        });
      });
    }
  }

  if (channels.length) {
    await supabase.from('channels').upsert(channels, { onConflict: 'pair,rank' });
  }

  return NextResponse.json({ pairs_with_channels: new Set(channels.map(c => c.pair)).size, total_channels: channels.length });
}