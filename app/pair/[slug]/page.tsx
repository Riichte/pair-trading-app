import { createClient } from '@supabase/supabase-js';
import PairChart from './PairChart';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export default async function PairPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [numTicker, denTicker] = slug.split('-');
  const pair = `${numTicker}/${denTicker}`;

  const { data: channelList } = await supabase.from('channels').select('*').eq('pair', pair).order('rank');
  const channel = channelList?.[0];
  const { data: dailyNum } = await supabase.from('daily_prices').select('date, close').eq('ticker', numTicker).order('date');
  const { data: dailyDen } = await supabase.from('daily_prices').select('date, close').eq('ticker', denTicker).order('date');

  const denMap: Record<string, number> = {};
  dailyDen?.forEach(d => (denMap[d.date] = d.close));
  const ratioSeries = (dailyNum ?? [])
    .filter(d => denMap[d.date])
    .map((d, i) => ({ time: d.date, value: d.close / denMap[d.date], idx: i }));

  let daysToApex: number | null = null;
  if (channel?.apex_date) {
    const today = new Date();
    const apex = new Date(channel.apex_date);
    daysToApex = Math.round((apex.getTime() - today.getTime()) / 86400000);
  }

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>{pair}</h1>
      {channelList?.map(c => (
        <p key={c.rank}>
          #{c.rank} Floor: {c.floor?.toFixed(4)} | Ceiling: {c.ceiling?.toFixed(4)} | Confidence: {c.confidence}%
          {' | '}Type: {c.channel_type}
        </p>
      ))}
      <PairChart data={ratioSeries} channels={channelList ?? []} />
    </main>
  );
}