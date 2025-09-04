// @ts-nocheck
// Vercel Edge/Node handler: Normaliza nutrición por 100 g desde OpenFoodFacts y recalcula kcal por Atwater.

const CORS = (res: any) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const OFF_HOSTS = [
  "https://world.openfoodfacts.org",
  "https://us.openfoodfacts.org",
  "https://mx.openfoodfacts.org",
  "https://es.openfoodfacts.org",
];

const num = (x: any) => typeof x === "number" && Number.isFinite(x) ? x : null;
const toNum = (v: any) => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = v.replace(",", ".").match(/-?\d+(\.\d+)?/);
    if (m) return +m[0];
  }
  return null;
};

function mg(val: any) {
  const n = toNum(val);
  return n == null ? null : +n;
}
function gToMg(val: any) {
  const n = toNum(val);
  return n == null ? null : +(n * 1000);
}

// kcal por Atwater si macros presentes
function atwaterKcal(p?: number | null, c?: number | null, f?: number | null) {
  if (p == null || c == null || f == null) return null;
  return +(4 * p + 4 * c + 9 * f).toFixed(1);
}

function normalizeProduct(p: any) {
  const n = (p && p.nutriments) || {};
  // Macros por 100 g (g/100g)
  const protein_g = toNum(n.proteins_100g);
  const carbs_g = toNum(n.carbohydrates_100g);
  const fat_g = toNum(n.fat_100g);
  const fiber_g = toNum(n.fiber_100g);
  const sugars_g = toNum(n.sugars_100g);

  // Energía (kcal/100g) o convertir desde kJ
  let calories = toNum(n["energy-kcal_100g"]);
  if (calories == null) {
    const kJ = toNum(n.energy_100g);
    if (kJ != null) calories = +(kJ * 0.239006).toFixed(1);
  }

  // Recalcular kcal por Atwater si hay macros (evita inconsistencias)
  const aw = atwaterKcal(protein_g, carbs_g, fat_g);
  if (aw != null) calories = aw;

  // Minerales — la API mezcla unidades; normalizamos a mg/100g
  // sodium_100g y potassium_100g suelen venir en g -> pasamos a mg
  // si no hay sodium, pero hay salt, aproximamos: 1 g sal ≈ 390 mg sodio
  let sodium_mg = gToMg(n.sodium_100g);
  if (sodium_mg == null && n.salt_100g != null) {
    const salt_g = toNum(n.salt_100g);
    sodium_mg = salt_g == null ? null : +(salt_g * 390); // aproximación
  }
  const potassium_mg = gToMg(n.potassium_100g) ?? mg(n.potassium_mg_100g);
  const calcium_mg = mg(n.calcium_mg_100g) ?? gToMg(n.calcium_100g);
  const iron_mg = mg(n.iron_mg_100g) ?? gToMg(n.iron_100g);

  return {
    product_name: p.product_name || p.generic_name || "",
    brand: p.brands || "",
    barcode: p.code || "",
    base_per: "100g",
    base: {
      calories: calories ?? null,
      protein_g: protein_g ?? null,
      carbs_g: carbs_g ?? null,
      fat_g: fat_g ?? null,
      fiber_g: fiber_g ?? null,
      sugars_g: sugars_g ?? null,
      sodium_mg: sodium_mg ?? null,
      potassium_mg: potassium_mg ?? null,
      calcium_mg: calcium_mg ?? null,
      iron_mg: iron_mg ?? null,
      vitamin_d_iu: null,
    },
    // Info útil adicional
    serving: {
      quantity: p.serving_quantity || null,
      unit: p.serving_size || null,
      per_serving: {
        calories: toNum(n["energy-kcal_serving"]) ?? null,
        protein_g: toNum(n.proteins_serving) ?? null,
        carbs_g: toNum(n.carbohydrates_serving) ?? null,
        fat_g: toNum(n.fat_serving) ?? null,
      },
    },
    raw: { nutriments: n },
  };
}

async function fetchOFF(code: string) {
  let lastErr: any = null;
  for (const host of OFF_HOSTS) {
    try {
      const url = `${host}/api/v2/product/${encodeURIComponent(code)}.json`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) {
        lastErr = new Error(`${r.status} ${r.statusText}`);
        continue;
      }
      const j = await r.json();
      if (j && j.product) return j.product;
      lastErr = new Error("NOT_FOUND");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("NOT_FOUND");
}

export default async function handler(req: any, res: any) {
  CORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : {};
    const code = String(body.code || "").replace(/\s+/g, "");

    if (!/^\d{8,14}$/.test(code)) {
      return res.status(400).json({ error: "Invalid barcode" });
    }

    const product = await fetchOFF(code);
    const out = normalizeProduct(product);
    if (!out) return res.status(404).json({ error: "Product not found" });

    return res.status(200).json(out);
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = /NOT_FOUND/i.test(msg) ? 404 : 500;
    return res.status(status).json({ error: msg });
  }
}
