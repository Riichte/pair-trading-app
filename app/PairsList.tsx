'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function PairsList({ channels, tickers }: { channels: any[]; tickers: string[] }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(tickers.map(t => [t, true]))
  );

  function toggle(t: string) {
    setEnabled(prev => ({ ...prev, [t]: !prev[t] }));
  }

  const filtered = channels.filter(c => enabled[c.num_ticker] && enabled[c.den_ticker]);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, padding: 12, border: '1px solid #333' }}>
        {tickers.map(t => (
          <label key={t} style={{ fontSize: 12 }}>
            <input type="checkbox" checked={enabled[t]} onChange={() => toggle(t)} /> {t}
          </label>
        ))}
      </div>
      <p>{filtered.length} pairs</p>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>
            <th>Pair</th><th>Floor</th><th>Ceiling</th><th>Width %</th><th>Confidence</th><th>Touches</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(c => (
            <tr key={`${c.pair}-${c.rank}`} style={{ borderBottom: '1px solid #222' }}>
              <td><Link href={`/pair/${c.num_ticker}-${c.den_ticker}`}>{c.pair}</Link></td>
              <td>{c.floor?.toFixed(4)}</td>
              <td>{c.ceiling?.toFixed(4)}</td>
              <td>{c.width_pct?.toFixed(1)}%</td>
              <td>{c.confidence}%</td>
              <td>{c.floor_touches}/{c.ceil_touches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}