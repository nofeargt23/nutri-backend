// api/barcode-v2.ts  — Ruta nueva, no reemplaza nada
import type { VercelRequest, VercelResponse } from '@vercel/node';

function num(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function kcal(nutriments: any): number | null {
  // OFF puede traer energy-kcal_100g o solo energy_100g (kJ)
  if (nutriments?.['energy-kcal_100g'] != null) return num(nutriments['energy-kcal_100g']);
  // Si solo hay kJ, convierte a kcal (1 kcal ≈ 4.184 kJ)
  if (nutriments?.['energy_100g'] != null && nutriments?.['energy_unit'] === 'kJ') {
    const kj = num(nutriments['energy_100g']);
    return kj != null ? Math.round(kj / 4.184) : null;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const code = (req.query.code as string)?.trim();
  if (!code) {
    return res.status(200).json({ ok: false, found: false, message: 'missing_code' });
  }

  try {
    // OpenFoodFacts v2
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'nutri-backend/1.0' } });
    const data = await r.json();

    if (!data || data.status !== 1 || !data.product) {
      // No encontrado → devolvemos 200 con found:false (para no reventar la app)
      return res.status(200).json({
        ok: false,
        found: false,
        code,
        message: 'not_found',
        source: 'openfoodfacts'
      });
    }

    const p = data.product;
    const n = p.nutriments || {};

    const product = {
      code,
      name: p.product_name || p.generic_name || null,
      brand: (Array.isArray(p.brands_tags) && p.brands_tags[0]) || p.brands || null,
      quantity: p.quantity || null,
      image: p.image_front_url || p.image_url || null,
      source: 'openfoodfacts',
      nutriments: {
        calories_kcal_100g: kcal(n),
        protein_g_100g: num(n['proteins_100g']),
        carbs_g_100g: num(n['carbohydrates_100g']),
        fat_g_100g: num(n['fat_100g']),
        sugars_g_100g: num(n['sugars_100g']),
        fiber_g_100g: num(n['fiber_100g']),
        // OFF suele dar salt_100g; convertimos a sodio (mg) si es necesario: Na = Sal * 0.393 * 1000
        sodium_mg_100g:
          n['sodium_100g'] != null
            ? Math.round(Number(n['sodium_100g']) * 1000)
            : n['salt_100g'] != null
            ? Math.round(Number(n['salt_100g']) * 0.393 * 1000)
            : null,
      },
    };

    return res.status(200).json({ ok: true, found: true, product });
  } catch (err: any) {
    // Falla de red/parseo → no tumbamos la app
    return res.status(200).json({
      ok: false,
      found: false,
      code,
      message: 'upstream_error',
      detail: String(err?.message || err),
    });
  }
}
