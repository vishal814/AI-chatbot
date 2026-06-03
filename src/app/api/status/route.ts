import { NextRequest, NextResponse } from 'next/server';
import { LocalVectorStore } from '@/lib/vectorStore';

export async function GET(req: NextRequest) {
  try {
    const store = new LocalVectorStore();
    const stats = await store.stats();
    const profiles = await store.getProfiles();

    return NextResponse.json({
      stats,
      profiles,
    });
  } catch (err) {
    console.error('Status GET error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const store = new LocalVectorStore();
    await store.clear();
    return NextResponse.json({
      message: 'Vector database cleared successfully.',
      stats: await store.stats(),
      profiles: {},
    });
  } catch (err) {
    console.error('Status DELETE error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
