import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TICKERS = [
  'BSOL','CRCL','IBIT','MSTR','NVDA','TSLA','EOSE','NDA','FWDI','GNS','HODL','TTD',
  'ALAB','AMD','ARM','ASML','AVGO','GOOG','MRVL','MU','PLTR','TSM'
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const single = searchParams.get('ticker');
  const tickers = single ? [single] : TICKERS;

  const results = [];
  for (const ticker of tickers) {
    const res = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=730&apikey=${process.env.TWELVE_DATA_API_KEY}`
    );
    const data = await res.json();
    if (!data.values) {
      results.push({ ticker, error: data.message || 'failed' });
      continue;
    }
    const rows = data.values.map((v: any) => ({
      ticker,
      date: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    }));
    await supabase.from('daily_prices').upsert(rows, { onConflict: 'ticker,date' });
    results.push({ ticker, rows: rows.length });
    await new Promise(r => setTimeout(r, 15000)); // rate limit: 8 calls/min free tier
  }

  return NextResponse.json({ results });
}