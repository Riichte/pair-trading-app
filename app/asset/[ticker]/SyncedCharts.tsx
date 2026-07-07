'use client';
import { useEffect, useRef } from 'react';
import { createChart, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import type { Trade } from '@/lib/backtest';

export default function SyncedCharts({
  priceData, trades, dates, oscillator, ob, os,
}: {
  priceData: { time: string; value: number }[]; trades: Trade[];
  dates: string[]; oscillator: (number | null)[]; ob: number; os: number;
}) {
  const priceRef = useRef<HTMLDivElement>(null);
  const oscRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!priceRef.current || !oscRef.current) return;

    const priceChart = createChart(priceRef.current, { width: priceRef.current.clientWidth, height: 400 });
    const series = priceChart.addSeries(LineSeries, { color: '#2962FF' });
    series.setData(priceData);
    createSeriesMarkers(series, trades.map(t => ({
      time: t.date, position: t.side === 'BUY' ? 'belowBar' : 'aboveBar',
      color: t.side === 'BUY' ? '#26a69a' : t.win ? '#26a69a' : '#ef5350',
      shape: t.side === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: `${t.side} $${t.amount.toFixed(0)}`,
    })));

    const oscChart = createChart(oscRef.current, { width: oscRef.current.clientWidth, height: 200 });
    const oscSeries = oscChart.addSeries(LineSeries, { color: '#2962FF' });
    oscSeries.setData(dates.map((d, i) => ({ time: d, value: oscillator[i] ?? 0 })).filter((_, i) => oscillator[i] != null));
    oscSeries.createPriceLine({ price: ob, color: '#ef5350', title: 'OB' });
    oscSeries.createPriceLine({ price: 0, color: '#888', title: '0' });
    oscSeries.createPriceLine({ price: os, color: '#26a69a', title: 'OS' });

    const syncing = { active: false };
    function sync(source: typeof priceChart, target: typeof priceChart) {
      source.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (syncing.active || !range) return;
        syncing.active = true;
        target.timeScale().setVisibleLogicalRange(range);
        syncing.active = false;
      });
    }
    sync(priceChart, oscChart);
    sync(oscChart, priceChart);

    return () => { priceChart.remove(); oscChart.remove(); };
  }, [priceData, trades, dates, oscillator, ob, os]);

  return (
    <div>
      <div ref={priceRef} />
      <div ref={oscRef} />
    </div>
  );
}