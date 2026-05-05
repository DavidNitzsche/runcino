import {
  listRecovery,
  createRecovery,
  creditSummary,
  SERVICES,
  type RecoveryInput,
} from '../../../lib/recovery-store';

export async function GET(req: Request) {
  try {
    const url   = new URL(req.url);
    const today = url.searchParams.get('today') ?? new Date().toISOString().slice(0, 10);
    const from  = url.searchParams.get('from')  ?? today;
    const to    = url.searchParams.get('to')    ?? today;

    const [sessions, credits] = await Promise.all([
      listRecovery(from, to),
      creditSummary(today),
    ]);

    return Response.json({ sessions, credits, services: SERVICES });
  } catch (e) {
    return Response.json({ sessions: [], credits: null, error: String(e) });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as RecoveryInput;
    if (!body.date || !body.service) {
      return Response.json({ error: 'date and service are required' }, { status: 400 });
    }
    if (!SERVICES[body.service]) {
      return Response.json({ error: `Unknown service: ${body.service}` }, { status: 400 });
    }
    const session = await createRecovery(body);
    return Response.json({ session });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
