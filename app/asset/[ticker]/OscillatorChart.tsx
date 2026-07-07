'use client';
import { useEffect, useRef } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';

export default function OscillatorChart({
  dates, oscillator, ob, os,
}: { dates: string[]; oscillator: (number | null)[]; ob: number; os: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, { width: ref.current.clientWidth, height: 200 });
    const series = chart.addSeries(LineSeries, { color: '#2962FF' });
    series.setData(
      dates.map((d, i) => ({ time: d, value: oscillator[i] ?? 0 })).filter((_, i) => oscillator[i] != null)
    );
    series.createPriceLine({ price: ob, color: '#ef5350', title: 'OB' });
    series.createPriceLine({ price: 0, color: '#888', title: '0' });
    series.createPriceLine({ price: os, color: '#26a69a', title: 'OS' });
    return () => chart.remove();
  }, [dates, oscillator, ob, os]);

  return <div ref={ref} />;
}