import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: Request) {
  const body = await req.json();
  const { error } = await supabase.from('strategy_params').upsert({
    ticker: body.ticker,
    bb_length: body.bbLen, rsi_length: body.rsiLen, z_length: body.zLen,
    smoothing: body.smoothing, scale_factor: body.scale, ob_level: body.ob, os_level: body.os,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'ticker' });
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true });
}