// api/barcode.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Responde 200 siempre.
 * - found: true -> product con nutrimentos
 * - found: false -> no encontrado (la app no debe tratarlo como error)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const codeParam =
      req.method === "GET"
        ? (req.query.code as string)
        : (req.body as any)?.code;

    const code = (codeParam || "").trim();

    if (!code) {
      return res.status(200).json({
        found: false,
        code: null,
        error: 'missing_code',
        message: 'Falta "code".'
      });
    }

    const offUrl = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
    const r = await fetch(offUrl, { headers: { "User-Agent": "nutri-app/1.0" } });

    if (!r.ok) {
      // Upstream caído / rate limit, etc. -> no rompemos la app
      return res.status(200).json({
        found: false,
        code,
        error: `upstream_${r.status}`,
      });
    }

    const data = await r.json();

    if (data.status !== 1 || !data.product) {
      // No encontrado en OFF -> 200 con found:false
      return res.status(200).json({
        found: false,
        code,
        error: "not_found",
      });
    }

    const p = data.product;
    const n = p.nutriments || {};

    // OFF da sodio en gramos -> a mg
    const sodiumMg =
      n.sodium_100g != null
        ? Math.round(Number(n.sodium_100g) * 1000)
        : n.sodium_serving != null
        ? Math.round(Number(n.sodium_serving) * 1000)
        : null;

    return res.status(200).json({
      found: true,
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
    // 200 con found:false para que la app no muestre "fallo"
    return res.status(200).json({
      found: false,
      error: "server_error",
      message: err?.message || "unexpected",
    });
  }
}
