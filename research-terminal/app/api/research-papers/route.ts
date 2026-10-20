import { NextResponse } from 'next/server';
import { createClient } from '../../../utils/supabase/server';
import { isAdmin } from '@/lib/auth';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);


export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const { data, error } = await supabase
    .from('research_papers')
    .select('id,title,summary,sector,published_on,storage_path,file_name,mime_type,file_size,created_at')
    .order('published_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const papers = await Promise.all((data || []).map(async (paper) => {
    const { data: signed } = await supabase.storage.from('research-papers').createSignedUrl(paper.storage_path, 3600);
    return { ...paper, signed_url: signed?.signedUrl || null };
  }));

  return NextResponse.json({ papers, canUpload: isAdmin(user) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: 'Admin access required.' }, { status: 403 });

  const form = await request.formData();
  const file = form.get('file');
  const title = String(form.get('title') || '').trim();
  const summary = String(form.get('summary') || '').trim();
  const sector = String(form.get('sector') || '').trim();
  const publishedOn = String(form.get('publishedOn') || '').trim();

  if (!(file instanceof File) || !title || !/^\d{4}-\d{2}-\d{2}$/.test(publishedOn)) {
    return NextResponse.json({ error: 'Title, publication date, and document are required.' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type) || file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'Use a PDF or Word document up to 20 MB.' }, { status: 400 });
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const safeBase = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'research-paper';
  const storagePath = `${user.id}/${Date.now()}-${safeBase}.${extension}`;
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('research-papers')
    .upload(storagePath, bytes, { contentType: file.type, upsert: false });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: paper, error: insertError } = await supabase
    .from('research_papers')
    .insert({
      title: title.slice(0, 140),
      summary: summary ? summary.slice(0, 500) : null,
      sector: sector ? sector.slice(0, 60) : null,
      published_on: publishedOn,
      storage_path: storagePath,
      file_name: file.name.slice(0, 180),
      mime_type: file.type,
      file_size: file.size,
      created_by: user.id,
    })
    .select('id,title,summary,sector,published_on,file_name,file_size,created_at')
    .single();

  if (insertError) {
    await supabase.storage.from('research-papers').remove([storagePath]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ paper }, { status: 201 });
}
