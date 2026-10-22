import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { sanitizePositions } from '@/lib/workspace';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
      .from('jarvis_portfolios')
      .select('name,positions,updated_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Portfolio load failed:', error.message);
      return NextResponse.json({ error: 'Portfolio storage is not configured yet.' }, { status: 503 });
    }
    return NextResponse.json({ portfolio: data ?? null });
  } catch {
    return NextResponse.json({ error: 'Unable to load portfolio.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const limit = await checkRateLimit({
      scope: 'portfolio-write',
      identifier: user.id,
      limit: 30,
      windowSeconds: 60,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many portfolio saves. Try again shortly.' },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const { positions, error: validationError } = sanitizePositions(payload.positions);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    const name = typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim().slice(0, 80)
      : 'Main portfolio';

    const { data, error } = await supabase
      .from('jarvis_portfolios')
      .upsert({
        user_id: user.id,
        name,
        positions,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select('name,positions,updated_at')
      .single();

    if (error) {
      console.error('Portfolio save failed:', error.message);
      return NextResponse.json({ error: 'Unable to save portfolio.' }, { status: 500 });
    }
    return NextResponse.json({ portfolio: data });
  } catch {
    return NextResponse.json({ error: 'Unable to save portfolio.' }, { status: 500 });
  }
}
