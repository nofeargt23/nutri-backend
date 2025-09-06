// api/barcode.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const code =
      (req.method === "GET" ? (req.query.code as string) : (req.body as any)?.code)?.trim();

    if (!code) {
      return res.status(400).json({ error: 'Missing "code"' });
    }

    // OpenFoodFacts: no requiere API key
    const offUrl = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
    const r = await fetch(offUrl, { headers: { "User-Agent": "nutri-app/1.0" } });

    if (!r.ok) {
      return res.status(r.status).json({ error: `Upstream ${r.status}` });
    }

    const data = await r.json();

    if (data.status !== 1 || !data.product) {
      return res.status(404).json({ error: "Not found" });
    }

    const p = data.product;
    const n = p.nutriments || {};

    // nota: OFF reporta sodio en gramos -> lo convierto a mg
    const sodiumMg =
      n.sodium_100g != null
        ? Math.round(Number(n.sodium_100g) * 1000)
        : n.sodium_serving != null
        ? Math.round(Number(n.sodium_serving) * 1000)
        : null;

    res.json({
      source: "openfoodfacts",
      code,
      name: p.product_name || p.generic_name || "Producto",
      brand: p.brands,
      quantity: p.quantity,
      serving_size: p.serving_size,
      image: p.image_front_url || p.image_url,
      nutriments: {
        kcal: n["energy-kcal_100g"] ?? n["energy-kcal_serving"] ?? null,
        protein_g: n.proteins_100g ?? n.proteins_serving ?? null,
        carbs_g: n.carbohydrates_100g ?? n.carbohydrates_serving ?? null,
        fat_g: n.fat_100g ?? n.fat_serving ?? null,
        sugars_g: n.sugars_100g ?? n.sugars_serving ?? null,
        sodium_mg: sodiumMg,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "server_error" });
  }
}
