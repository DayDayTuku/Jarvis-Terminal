import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { sanitizeNoteBody } from '@/lib/workspace';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const requested = Number(request.nextUrl.searchParams.get('limit') || 20);
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 20, 1), 50);

    const { data, error } = await supabase
      .from('jarvis_notes')
      .select('id,body,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Notes load failed:', error.message);
      return NextResponse.json({ error: 'Notes storage is not configured yet.' }, { status: 503 });
    }
    return NextResponse.json({ notes: data ?? [] });
  } catch {
    return NextResponse.json({ error: 'Unable to load notes.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const limit = await checkRateLimit({
      scope: 'notes-write',
      identifier: user.id,
      limit: 30,
      windowSeconds: 60,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many note saves. Try again shortly.' },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const text = sanitizeNoteBody(payload.body);
    if (!text) {
      return NextResponse.json(
        { error: 'A note must be between 1 and 2,000 characters.' },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('jarvis_notes')
      .insert({ user_id: user.id, body: text })
      .select('id,body,created_at')
      .single();

    if (error) {
      console.error('Note insert failed:', error.message);
      return NextResponse.json({ error: 'Unable to save note.' }, { status: 500 });
    }
    return NextResponse.json({ note: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unable to save note.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rawId = request.nextUrl.searchParams.get('id') ?? '';
    if (!/^\d{1,19}$/.test(rawId)) {
      return NextResponse.json({ error: 'Invalid note id.' }, { status: 400 });
    }

    const { error } = await supabase
      .from('jarvis_notes')
      .delete()
      .eq('user_id', user.id)
      .eq('id', rawId);

    if (error) {
      console.error('Note delete failed:', error.message);
      return NextResponse.json({ error: 'Unable to delete note.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Unable to delete note.' }, { status: 500 });
  }
}
