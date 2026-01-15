import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('drive_documents')
    .select('*')
    .eq('user_id', userId)
    .order('modified_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Error fetching drive documents', error);
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }

  return NextResponse.json({ documents: data || [] });
}

