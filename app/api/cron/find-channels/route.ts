import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ATH_FILTER_PCT = 0.15;
const MIN_CHANNEL_WIDTH_PCT = 10;
const MIN_TOUCHES = 3;

function riskTolerance(risk: string) {
  if (risk === 'High') return 0.08;
  if (risk === 'Med') return 0.06;
  return 0.05;
}

function detectRatioChannels(ratios: number[], touchTolerance: number, minTouches: number) {
  if (ratios.length < 10) return null;
  const valid = ratios.filter(r => r && isFinite(r) && r > 0);
  if (valid.length < 10) return null;

  const localMins: { idx: number; val: number }[] = [];
  const localMaxs: { idx: number; val: number }[] = [];
  for (let i = 1; i < valid.length - 1; i++) {
    const prev = valid[i - 1], curr = valid[i], next = valid[i + 1];
    if (curr <= prev && curr <= next) localMins.push({ idx: i, val: curr });
    if (curr >= prev && curr >= next) localMaxs.push({ idx: i, val: curr });
  }

  function clusterLevels(points: { idx: number; val: number }[]) {
    const clusters: { level: number; touches: { idx: number; val: number }[] }[] = [];
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
    return clusters.filter(cl => cl.touches.length >= minTouches)
      .sort((a, b) => b.touches.length - a.touches.length);
  }

  const floorClusters = clusterLevels(localMins);
  const ceilClusters = clusterLevels(localMaxs);
  if (!floorClusters.length || !ceilClusters.length) return null;

  const floor = floorClusters[0];
  const ceiling = ceilClusters[0];
  if (ceiling.level <= floor.level) return null;

  const channelWidthPct = ((ceiling.level - floor.level) / floor.level) * 100;

  const allTouches = [...floor.touches, ...ceiling.touches].sort((a, b) => a.idx - b.idx);
  let avgHrsBetweenTouches: number | null = null;
  if (allTouches.length >= 2) {
    const gaps = [];
    for (let i = 1; i < allTouches.length; i++) gaps.push(allTouches[i].idx - allTouches[i - 1].idx);
    avgHrsBetweenTouches = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
  }

  const inChannel = valid.filter(
    r => r >= floor.level * (1 - touchTolerance) && r <= ceiling.level * (1 + touchTolerance)
  ).length;
  const confidence = Math.round((inChannel / valid.length) * 100);

  return {
    floor: floor.level, ceiling: ceiling.level,
    floorTouches: floor.touches.length, ceilTouches: ceiling.touches.length,
    channelWidthPct, avgHrsBetweenTouches, confidence,
  };
}

export async function GET() {
  const { data: assets } = await supabase.from('assets').select('*').eq('active', true);
  if (!assets) return NextResponse.json({ error: 'no assets' }, { status: 500 });

  const { data: priceRows } = await supabase
    .from('daily_prices')
    .select('ticker, close, date')
    .order('date', { ascending: true });

  if (!priceRows) return NextResponse.json({ error: 'no prices' }, { status: 500 });

  // group prices by ticker, aligned by date
  const byTime: Record<string, Record<string, number>> = {};
  for (const r of priceRows) {
    if (r.close === null) continue;
    if (!byTime[r.date]) byTime[r.date] = {};
    byTime[r.date][r.ticker] = r.close;
  }
  const timeline = Object.values(byTime);

  const assetMap: Record<string, any> = {};
  assets.forEach(a => (assetMap[a.ticker] = a));
  const tickers = assets.map(a => a.ticker);

  const channels = [];

  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const a = tickers[i], b = tickers[j];
      const pricesA = timeline.map(t => t[a]).filter(v => v > 0);
      const pricesB = timeline.map(t => t[b]).filter(v => v > 0);
      if (!pricesA.length || !pricesB.length) continue;

      const avgA = pricesA.reduce((s, v) => s + v, 0) / pricesA.length;
      const avgB = pricesB.reduce((s, v) => s + v, 0) / pricesB.length;

      const numTicker = avgA >= avgB ? a : b;
      const denTicker = avgA >= avgB ? b : a;

      const ratios: number[] = [];
      for (const t of timeline) {
        const pNum = t[numTicker], pDen = t[denTicker];
        if (pNum > 0 && pDen > 0) ratios.push(pNum / pDen);
      }

      const infoA = assetMap[a], infoB = assetMap[b];
      const tolerance = Math.max(
        infoA.touch_tolerance_override || riskTolerance(infoA.risk),
        infoB.touch_tolerance_override || riskTolerance(infoB.risk)
      );

      const channel = detectRatioChannels(ratios, tolerance, MIN_TOUCHES);
      if (!channel) continue;
      if (channel.channelWidthPct < MIN_CHANNEL_WIDTH_PCT) continue;

      channels.push({
        pair: `${numTicker}/${denTicker}`,
        num_ticker: numTicker,
        den_ticker: denTicker,
        floor: channel.floor,
        ceiling: channel.ceiling,
        width_pct: channel.channelWidthPct,
        confidence: channel.confidence,
        floor_touches: channel.floorTouches,
        ceil_touches: channel.ceilTouches,
        avg_hrs_between_touches: channel.avgHrsBetweenTouches,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (channels.length) {
    await supabase.from('channels').upsert(channels, { onConflict: 'pair' });
  }

  return NextResponse.json({ pairs_with_channels: channels.length });
}