import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function Home() {
  const { data: channels } = await supabase
    .from('channels')
    .select('*')
    .order('confidence', { ascending: false });

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Pairs ({channels?.length ?? 0})</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>
            <th>Pair</th><th>Floor</th><th>Ceiling</th><th>Width %</th><th>Confidence</th><th>Touches</th>
          </tr>
        </thead>
        <tbody>
          {channels?.map((c) => (
            <tr key={c.pair} style={{ borderBottom: '1px solid #222' }}>
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
    </main>
  );
}