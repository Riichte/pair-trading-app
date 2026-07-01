import { createClient } from '@supabase/supabase-js';
import PairChart from './PairChart';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export default async function PairPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [numTicker, denTicker] = slug.split('-');
  const pair = `${numTicker}/${denTicker}`;

  const { data: channel } = await supabase.from('channels').select('*').eq('pair', pair).single();
  const { data: dailyNum } = await supabase.from('daily_prices').select('date, close').eq('ticker', numTicker).order('date');
  const { data: dailyDen } = await supabase.from('daily_prices').select('date, close').eq('ticker', denTicker).order('date');

  const denMap: Record<string, number> = {};
  dailyDen?.forEach(d => (denMap[d.date] = d.close));
  const ratioSeries = (dailyNum ?? [])
    .filter(d => denMap[d.date])
    .map(d => ({ time: d.date, value: d.close / denMap[d.date] }));

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>{pair}</h1>
      {channel && <p>Floor: {channel.floor?.toFixed(4)} | Ceiling: {channel.ceiling?.toFixed(4)} | Confidence: {channel.confidence}%</p>}
      <PairChart data={ratioSeries} floor={channel?.floor} ceiling={channel?.ceiling} />
    </main>
  );
}