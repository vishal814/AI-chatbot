import { NextRequest, NextResponse } from 'next/server';
import { LocalVectorStore } from '@/lib/vectorStore';
import { RAGService } from '@/lib/services/rag';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    const headerKey = authHeader ? authHeader.replace('Bearer ', '').trim() : '';
    const apiKey = headerKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key is required. Please set it in the Settings panel.' },
        { status: 400 }
      );
    }

    // 2. Parse request body
    const body = await req.json();
    const { query, model = 'gpt-4o-mini' } = body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ error: 'Query parameter is required.' }, { status: 400 });
    }

    // 3. Initialize store
    const store = new LocalVectorStore();

    // 4. Query RAG Stream
    const { citations, stream: completionStream } = await RAGService.queryRAGStream(query, store, apiKey, model);

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        // Send the citations metadata first, separated by a newline
        const citationsStr = JSON.stringify(citations);
        controller.enqueue(encoder.encode(`__CITATIONS__:${citationsStr}\n`));

        try {
          for await (const chunk of completionStream) {
            const text = chunk.choices[0]?.delta?.content || '';
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
        } catch (streamErr) {
          console.error('Error during chat completion streaming:', streamErr);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    console.error('Chat error:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'An error occurred during chat processing.' },
      { status: 500 }
    );
  }
}
