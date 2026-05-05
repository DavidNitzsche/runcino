import { getShoe, updateShoe } from '../../../../lib/shoe-store';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const shoe = await getShoe(Number(id));
    if (!shoe) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ shoe });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const patch = await req.json();
    const shoe = await updateShoe(Number(id), patch);
    if (!shoe) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ shoe });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
