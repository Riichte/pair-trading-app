'use client';
import { useEffect, useRef } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';

export default function PairChart({ data, floor, ceiling }: { data: any[]; floor?: number; ceiling?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, { width: ref.current.clientWidth, height: 400 });
    const series = chart.addSeries(LineSeries, { color: '#2962FF' });
    series.setData(data);

    if (floor) {
      series.createPriceLine({ price: floor, color: '#4caf50', title: 'Floor' });
    }
    if (ceiling) {
      series.createPriceLine({ price: ceiling, color: '#f44336', title: 'Ceiling' });
    }

    return () => chart.remove();
  }, [data, floor, ceiling]);

  return <div ref={ref} />;
}