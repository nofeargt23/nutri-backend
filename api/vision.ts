// api/vision.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const VISION_KEY = process.env.GOOGLE_VISION_API_KEY!;
const USDA_KEY = process.env.USDA_API_KEY; // opcional

type VisionLabel = { description: string; score: number };

async function detectLabels(imageBase64: string): Promise<VisionLabel[]> {
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`;
  const body = {
    requests: [
      {
        image: { content: imageBase64 },
        features: [{ type: "LABEL_DETECTION", maxResults: 10 }],
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vision error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const labels = json?.responses?.[0]?.labelAnnotations || [];
  return labels
    .map((l: any) => ({ description: l.description, score: l.score }))
    .filter((l: VisionLabel) => l.score >= 0.55); // filtro suavecillo
}

type Macro = { calories_kcal_100g?: number; protein_g_100g?: number; carbs_g_100g?: number; fat_g_100g?: number };
type Candidate = { name: string; confidence: number; fdcId?: number; macros?: Macro };

async function fdcSearchOne(query: string): Promise<Candidate | null> {
  if (!USDA_KEY) return null;
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_KEY}&pageSize=1&query=${encodeURIComponent(
    query
  )}`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const food = data?.foods?.[0];
  if (!food) return null;

  // Mapeo simple de nutrientes por nombre
  const nutrients: any[] = food?.foodNutrients || [];
  const get = (name: string) =>
    nutrients.find((n) => (n.nutrientName || "").toLowerCase().includes(name))?.value;

  const macros: Macro = {
    calories_kcal_100g: get("energy") || get("calories"),
    protein_g_100g: get("protein"),
    carbs_g_100g: get("carbohydrate"),
    fat_g_100g: get("fat"),
  };

  return {
    name: food.description,
    confidence: 0.65, // base (no viene de FDC)
    fdcId: food.fdcId,
    macros,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

    const { imageBase64 } = req.body || {};
    if (!imageBase64) return res.status(400).json({ ok: false, error: "imageBase64 is required" });

    const labels = await detectLabels(imageBase64);

    // Top etiquetas -> candidatos FDC (opcional)
    const top = labels.slice(0, 5);
    const candidates: Candidate[] = [];

    for (const l of top) {
      const q = l.description.toLowerCase();
      // Mapea algunas comunes a términos más "food"
      const norm = q
        .replace("dish", "")
        .replace("cuisine", "")
        .trim();

      const fdc = await fdcSearchOne(norm);
      candidates.push({
        name: l.description,
        confidence: l.score,
        ...(fdc ? { fdcId: fdc.fdcId, macros: fdc.macros, name: fdc.name } : {}),
      });
    }

    res.json({
      ok: true,
      labels,
      candidates,
    });
  } catch (e: any) {
    console.error("[vision] error", e);
    res.status(500).json({ ok: false, error: e.message || "Vision failed" });
  }
}
