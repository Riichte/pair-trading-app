'use client';
import { useEffect, useRef } from 'react';
import { createChart, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import type { Trade } from '@/lib/backtest';

export default function AssetChart({ data, trades }: { data: { time: string; value: number }[]; trades: Trade[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, { width: ref.current.clientWidth, height: 500 });
    const series = chart.addSeries(LineSeries, { color: '#2962FF' });
    series.setData(data);

    createSeriesMarkers(
      series,
      trades.map(t => ({
        time: t.date,
        position: t.side === 'BUY' ? 'belowBar' : 'aboveBar',
        color: t.side === 'BUY' ? '#26a69a' : t.win ? '#26a69a' : '#ef5350',
        shape: t.side === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: `${t.side} $${t.amount.toFixed(0)}`,
      }))
    );

    return () => chart.remove();
  }, [data, trades]);

  return <div ref={ref} />;
}