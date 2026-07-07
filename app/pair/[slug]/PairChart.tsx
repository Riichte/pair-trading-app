'use client';
import { useEffect, useRef } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';

const COLORS = ['#4caf50', '#ff9800', '#9c27b0'];

export default function PairChart({ data, channels }: { data: any[]; channels: any[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, { width: ref.current.clientWidth, height: 400 });
    const series = chart.addSeries(LineSeries, { color: '#2962FF' });
    series.setData(data.map(d => ({ time: d.time, value: d.value })));

    channels.forEach((c, i) => {
      const color = COLORS[i % COLORS.length];
      const isAngled = c.channel_type && c.channel_type !== 'horizontal';

      if (!isAngled) {
        series.createPriceLine({ price: c.floor, color, title: `#${c.rank} Floor` });
        series.createPriceLine({ price: c.ceiling, color, title: `#${c.rank} Ceiling` });
      } else {
        if (c.slope_floor !== null) {
          const fs = chart.addSeries(LineSeries, { color, lineWidth: 2 });
          fs.setData(data.map(d => ({ time: d.time, value: c.slope_floor * d.idx + c.intercept_floor })));
        }
        if (c.slope_ceil !== null) {
          const cs = chart.addSeries(LineSeries, { color, lineWidth: 2 });
          cs.setData(data.map(d => ({ time: d.time, value: c.slope_ceil * d.idx + c.intercept_ceil })));
        }
      }
    });

    return () => chart.remove();
  }, [data, channels]);

  return <div ref={ref} />;
}