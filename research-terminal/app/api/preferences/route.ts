import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { isAccessibleScheme, sanitizeSnapshot } from '@/lib/workspace';

type PreferencesRow = {
  color_scheme: string;
  onboarding_complete: boolean;
  last_visit_at: string | null;
  last_snapshot: Record<string, unknown>;
  updated_at: string;
};

const DEFAULTS: PreferencesRow = {
  color_scheme: 'default',
  onboarding_complete: false,
  last_visit_at: null,
  last_snapshot: {},
  updated_at: new Date(0).toISOString(),
};

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
      .from('jarvis_user_preferences')
      .select('color_scheme,onboarding_complete,last_visit_at,last_snapshot,updated_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Preferences load failed:', error.message);
      return NextResponse.json({ error: 'Preference storage is not configured yet.' }, { status: 503 });
    }
    return NextResponse.json({ preferences: data ?? DEFAULTS });
  } catch {
    return NextResponse.json({ error: 'Unable to load preferences.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const limit = await checkRateLimit({
      scope: 'preferences-write',
      identifier: user.id,
      limit: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many preference saves. Try again shortly.' },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};

    const { data: existing, error: readError } = await supabase
      .from('jarvis_user_preferences')
      .select('color_scheme,onboarding_complete,last_visit_at,last_snapshot')
      .eq('user_id', user.id)
      .maybeSingle();
    if (readError) {
      return NextResponse.json({ error: 'Preference storage is not configured yet.' }, { status: 503 });
    }

    const current = existing ?? DEFAULTS;
    const next = {
      user_id: user.id,
      color_scheme: isAccessibleScheme(payload.colorScheme)
        ? payload.colorScheme
        : current.color_scheme,
      onboarding_complete: typeof payload.onboardingComplete === 'boolean'
        ? payload.onboardingComplete
        : current.onboarding_complete,
      last_visit_at: typeof payload.lastVisitAt === 'string' && !Number.isNaN(Date.parse(payload.lastVisitAt))
        ? new Date(payload.lastVisitAt).toISOString()
        : current.last_visit_at,
      last_snapshot: payload.lastSnapshot === undefined
        ? current.last_snapshot
        : sanitizeSnapshot(payload.lastSnapshot),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('jarvis_user_preferences')
      .upsert(next, { onConflict: 'user_id' })
      .select('color_scheme,onboarding_complete,last_visit_at,last_snapshot,updated_at')
      .single();

    if (error) {
      console.error('Preferences save failed:', error.message);
      return NextResponse.json({ error: 'Unable to save preferences.' }, { status: 500 });
    }
    return NextResponse.json({ preferences: data });
  } catch {
    return NextResponse.json({ error: 'Unable to save preferences.' }, { status: 500 });
  }
}
