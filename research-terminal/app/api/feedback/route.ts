import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';

const validCategories = new Set(['BUG', 'DATA', 'FEATURE', 'OTHER']);
const validStatuses = new Set(['new', 'reviewing', 'resolved']);

type FeedbackRequest = {
  kind?: unknown;
  message?: unknown;
  website?: unknown;
  section?: unknown;
  ticker?: unknown;
  url?: unknown;
  contactOkay?: unknown;
};

type FeedbackUpdateRequest = {
  id?: unknown;
  status?: unknown;
};

function isAdmin(user: { app_metadata?: Record<string, unknown> } | null) {
  return user?.app_metadata?.role === 'admin';
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Please sign in before sending feedback.' }, { status: 401 });

    const body = (await request.json()) as FeedbackRequest;
    const category = typeof body.kind === 'string' ? body.kind.toUpperCase() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const honeypot = typeof body.website === 'string' ? body.website : '';

    if (honeypot) return NextResponse.json({ ok: true });
    if (!validCategories.has(category)) {
      return NextResponse.json({ error: 'Choose a valid feedback category.' }, { status: 400 });
    }
    if (message.length < 10 || message.length > 1200) {
      return NextResponse.json({ error: 'Feedback must be between 10 and 1,200 characters.' }, { status: 400 });
    }

    const { error } = await supabase.from('feedback').insert({
      user_id: user.id,
      user_email: user.email || null,
      category,
      message,
      section: String(body.section || 'UNKNOWN').slice(0, 80),
      ticker: body.ticker ? String(body.ticker).slice(0, 20) : null,
      page_url: String(body.url || '').slice(0, 500),
      contact_ok: Boolean(body.contactOkay),
    });

    if (error) {
      console.error('Feedback insert failed:', error.message);
      return NextResponse.json({ error: 'Feedback storage is not configured yet.' }, { status: 503 });
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Feedback could not be saved. Please try again.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 30);
  const limit = Math.min(Math.max(requestedLimit, 1), 100);
  const { data, error } = await supabase
    .from('feedback')
    .select('id,created_at,user_email,category,message,section,ticker,contact_ok,status')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: 'Unable to load feedback.' }, { status: 500 });
  return NextResponse.json({ feedback: data || [] });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json()) as FeedbackUpdateRequest;
  const id = typeof body.id === 'string' ? body.id : '';
  const status = typeof body.status === 'string' ? body.status : '';
  if (!id || !validStatuses.has(status)) {
    return NextResponse.json({ error: 'Invalid feedback update.' }, { status: 400 });
  }

  const { error } = await supabase.from('feedback').update({ status }).eq('id', id);
  if (error) return NextResponse.json({ error: 'Unable to update feedback.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
