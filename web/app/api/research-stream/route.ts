/**
 * /api/research-stream — SSE streaming version of course research.
 *
 * Emits events as Claude searches so the UI can show live progress.
 * Event format: `data: {type, ...}\n\n`
 */

import { streamResearchCourse, type ResearchProgressEvent } from '../../../lib/course-research';

type Body = {
  raceName: string;
  officialUrl?: string;
  typicalDate?: string;
  expectedDistanceMi?: number;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body.raceName) return new Response('Missing raceName', { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response('ANTHROPIC_API_KEY not set', { status: 503 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: ResearchProgressEvent) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { /* client disconnected */ }
      }

      try {
        await streamResearchCourse(
          {
            raceName: body.raceName,
            officialUrl: body.officialUrl,
            typicalDate: body.typicalDate,
            expectedDistanceMi: body.expectedDistanceMi,
          },
          emit
        );
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
