import { createClient } from '@supabase/supabase-js';
import PairsList from './PairsList';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export default async function Home() {
  const { data: channels } = await supabase
    .from('channels')
    .select('*')
    .order('confidence', { ascending: false });

  const { data: assets } = await supabase.from('assets').select('ticker').eq('active', true).order('ticker');

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Pairs</h1>
      <PairsList channels={channels ?? []} tickers={(assets ?? []).map(a => a.ticker)} />
    </main>
  );
}