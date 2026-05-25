import { listShoes, createShoe, DEFAULT_SHOES, type ShoeInput } from '../../../lib/shoe-store';
import { query } from '../../../lib/db';

export async function GET() {
  try {
    let shoes = await listShoes();

    // Seed default rotation on first boot
    if (shoes.length === 0) {
      for (const s of DEFAULT_SHOES) {
        await createShoe(s);
      }
      shoes = await listShoes();
    }

    return Response.json({ shoes });
  } catch (e) {
    return Response.json({ shoes: [], error: String(e) });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as ShoeInput;
    if (!body.brand || !body.model || !Array.isArray(body.run_types)) {
      return Response.json({ error: 'brand, model, and run_types are required' }, { status: 400 });
    }
    const shoe = await createShoe(body);
    return Response.json({ shoe });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
