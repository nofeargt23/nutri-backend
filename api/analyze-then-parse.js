// pages/api/analyze-then-parse.ts
import type { NextApiRequest, NextApiResponse } from "next";

type Concept = { name: string; value: number };
type ClarifaiConcept = { name: string; value: number };

const MIN_CONF = 0.55;
const BAN_IF_LOW = new Set(["cake", "cookie", "candy", "ice cream", "dessert"]);

function pick(raw: ClarifaiConcept[], name: string, min = 0.25) {
  return raw.find((c) => c.name === name && c.value >= min);
}

function mapToIngredients(concepts: Concept[], raw: ClarifaiConcept[]) {
  const out: string[] = [];

  const has = (n: string, m = 0.25) => !!pick(raw, n, m);

  // Heurísticos útiles
  if (has("arepa", 0.22) || has("arepas", 0.22)) out.push("1 arepa");
  if (has("steak", 0.25) || has("beef", 0.25)) out.push("200 g beef steak");
  if (has("chicken", 0.25)) out.push("150 g chicken");
  if (has("rice", 0.28) || has("brown rice", 0.28)) out.push("1 cup rice");
  if (has("pita", 0.22) || has("tortilla", 0.22) || has("bread", 0.28))
    out.push("1 piece bread");
  if (has("cheese", 0.28) || has("mozzarella", 0.22)) out.push("30 g cheese");
  if (has("tomato", 0.25)) out.push("1 medium tomato");

  // Además, mapea conceptos fuertes seleccionados
  for (const c of concepts) {
    switch (c.name) {
      case "pizza":
        out.push("1 slice pizza");
        break;
      case "burger":
        out.push("1 burger");
        break;
      case "salad":
        out.push("2 cups salad");
        break;
      // evita duplicados básicos
      case "rice":
        if (!out.some((x) => x.includes("rice"))) out.push("1 cup rice");
        break;
      case "chicken":
        if (!out.some((x) => x.includes("chicken"))) out.push("150 g chicken");
        break;
    }
  }

  // Dedup
  return Array.from(new Set(out));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    // auth
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (!apiKey || apiKey !== process.env.BACKEND_API_KEY) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    const { url, base64 } = req.body || {};
    if (!url && !base64) {
      return res.status(400).json({ error: "Provide url or base64" });
    }

    // ---- Clarifai
    const user = process.env.CLARIFAI_USER_ID!;
    const app = process.env.CLARIFAI_APP_ID!;
    const wf = process.env.CLARIFAI_WORKFLOW_ID!;
    const pat = process.env.CLARIFAI_PAT!;

    const clarifyBody = {
      inputs: [
        {
          data: {
            image: url ? { url } : { base64 },
          },
        },
      ],
    };

    const cf = await fetch(
      `https://api.clarifai.com/v2/users/${user}/apps/${app}/workflows/${wf}/results`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${pat}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(clarifyBody),
      }
    );

    const cfJson = await cf.json();
    const out = cfJson?.results?.[0]?.outputs?.[0];
    const statusOk = cfJson?.status?.code === 10000 && out?.status?.code === 10000;
    if (!statusOk) {
      return res.status(502).json({
        vision: { ok: false, status: cfJson?.status ?? out?.status },
        error: "Clarifai error",
      });
    }

    const raw: ClarifaiConcept[] = (out?.data?.concepts || [])
      .map((c: any) => ({ name: c.name, value: c.value }))
      .sort((a: any, b: any) => b.value - a.value);

    // Filtro principal
    let strong: Concept[] = raw
      .filter((c) => c.value >= MIN_CONF && !BAN_IF_LOW.has(c.name))
      .map((c) => ({ name: c.name, confidence: c.value }));

    // Si no hay fuertes, permite combos razonables (evita "cake" por teclado)
    if (strong.length === 0) {
      const fallback: Concept[] = [];
      if (pick(raw, "steak", 0.25) || pick(raw, "beef", 0.25))
        fallback.push({ name: "steak", confidence: pick(raw, "steak", 0.25)?.value || 0.3 });
      if (pick(raw, "bread", 0.28) || pick(raw, "pita", 0.22) || pick(raw, "tortilla", 0.22))
        fallback.push({ name: "bread", confidence: 0.3 });
      if (pick(raw, "rice", 0.28) || pick(raw, "brown rice", 0.28))
        fallback.push({ name: "rice", confidence: 0.3 });
      if (pick(raw, "chicken", 0.25))
        fallback.push({ name: "chicken", confidence: 0.3 });
      if (pick(raw, "cheese", 0.28))
        fallback.push({ name: "cheese", confidence: 0.28 });

      strong = fallback;
    }

    // Mapeo a ingredientes concretos para el parser nutricional
    const mapped = mapToIngredients(strong, raw);

    // ---- Nutrition (usa tu propio endpoint interno)
    let nutrition = null as any;
    try {
      const base =
        process.env.PUBLIC_BASE_URL ||
        `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
      const nres = await fetch(`${base}/api/nutrition/parse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey, // misma key
        },
        body: JSON.stringify({ ingredients: mapped }),
      });
      if (nres.ok) nutrition = await nres.json();
      else
        nutrition = {
          ok: false,
          status: nres.status,
        };
    } catch (e) {
      nutrition = { ok: false, status: 500, error: "Nutrition call failed" };
    }

    return res.status(200).json({
      debug: {
        minConf: MIN_CONF,
        mappedIngredients: mapped,
      },
      vision: {
        ok: true,
        status: cfJson?.status,
        outStatus: out?.status,
        countStrong: strong.length,
        countAll: raw.length,
      },
      concepts: strong,
      allConcepts: raw.map((c) => ({ name: c.name, confidence: c.value })),
      nutrition,
    });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
}

