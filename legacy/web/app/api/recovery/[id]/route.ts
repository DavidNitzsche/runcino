import { markDone, updateRecovery, deleteRecovery, SERVICES } from '../../../../lib/recovery-store';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json() as {
      done?: boolean;
      service?: string;
      note?: string;
    };

    if (body.done !== undefined) {
      const session = await markDone(Number(id), body.done);
      if (!session) return Response.json({ error: 'Not found' }, { status: 404 });
      return Response.json({ session });
    }

    const patch: { service?: Parameters<typeof updateRecovery>[1]['service']; note?: string } = {};
    if (body.note !== undefined) patch.note = body.note;
    if (body.service !== undefined) {
      if (!SERVICES[body.service as keyof typeof SERVICES]) {
        return Response.json({ error: `Unknown service: ${body.service}` }, { status: 400 });
      }
      patch.service = body.service as Parameters<typeof updateRecovery>[1]['service'];
    }

    const session = await updateRecovery(Number(id), patch);
    if (!session) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ session });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteRecovery(Number(id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
