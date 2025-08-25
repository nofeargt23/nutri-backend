// /pages/api/vision/analyze.ts  (o /src/pages/api/vision/analyze.ts según tu estructura)
import type { NextApiRequest, NextApiResponse } from "next";

const CLARIFAI_PAT = process.env.CLARIFAI_PAT!;
const USER_ID = "clarifai";
const APP_ID  = "main";
const FOOD_MODEL_ID    = "food-item-recognition";
const FOOD_VERSION_ID  = "1d5fd481e0cf4826aa72ec3ff049e044"; // versión estable del modelo de comida
const GENERAL_MODEL_ID = "general-image-recognition";

const CLARIFAI_BASE = `https://api.clarifai.com/v2/users/${USER_ID}/apps/${APP_ID}`;

type ClarifaiInput = { data: { image: { url?: string; base64?: string } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { url, base64, minConf = 0.65 } = (req.body || {}) as {
      url?: string; base64?: string; minConf?: number;
    };
    if (!url && !base64) return res.status(400).json({ ok:false, reason: "NO_INPUT", error: "url or base64 required" });

    const input: ClarifaiInput = { data: { image: {} as any } };
    if (url)  (input.data.image as any).url = url;
    if (base64) (input.data.image as any).base64 = base64;

    const headers = {
      "Authorization": `Key ${CLARIFAI_PAT}`,
      "Content-Type": "application/json",
    };

    async function runModel(modelId: string, versionId?: string) {
      const endpoint = `${CLARIFAI_BASE}/models/${modelId}${versionId ? `/versions/${versionId}` : ""}/outputs`;
      const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ inputs: [input] }) });
      const j = await r.json();
      const out = j?.outputs?.[0];
      return {
        ok: j?.status?.code === 10000 && out?.status?.code === 10000,
        concepts: out?.data?.concepts ?? [],
        raw: j
      };
    }

    // Ejecutar en paralelo el modelo de comida y el general
    const [food, general] = await Promise.all([
      runModel(FOOD_MODEL_ID, FOOD_VERSION_ID),
      runModel(GENERAL_MODEL_ID)
    ]);

    const debug = {
      minConf,
      foodOk: food.ok, generalOk: general.ok,
      foodTop: food.concepts?.slice(0, 5),
      generalTop: general.concepts?.slice(0, 5)
    };

    if (!food.ok) {
      return res.status(502).json({ ok:false, reason:"FOOD_MODEL_FAILED", debug });
    }

    // Gate: bloquear escenas obvias NO comida y permitir si el general ve "comida/plato"
    const badSet = new Set([
      "keyboard","laptop","computer","monitor","screen",
      "person","people","human","man","woman","boy","girl",
      "pool","swimming pool","car","dog","cat","phone","bus",
      "building","room","bed","sofa"
    ]);
    const goodSet = new Set([
      "food","dish","meal","cuisine","breakfast","lunch","dinner",
      "plate","tableware","cutlery","kitchen","cooking","restaurant"
    ]);

    const gConcepts = (general.concepts || []) as any[];
    const score = (names: Set<string>) =>
      Math.max(0, ...gConcepts.filter(c => names.has(String(c.name))).map(c => c.value ?? c.confidence ?? 0));
    const badScore  = score(badSet);
    const goodScore = score(goodSet);

    const hasStrongFoodConcept = (food.concepts || []).some((c: any) => (c.value ?? c.confidence ?? 0) >= minConf);

    if ((!hasStrongFoodConcept && goodScore < 0.55) || (badScore >= 0.60 && goodScore < 0.60)) {
      return res.status(200).json({
        ok: false,
        reason: "NO_FOOD",
        debug: { ...debug, gate: { badScore, goodScore, hasStrongFoodConcept } }
      });
    }

    // Whitelist de alimentos y filtro por umbral
    const whitelist = new Set([
      "pizza","tomato","pepperoni","cheese","mozzarella","ham","salami","sausage",
      "steak","beef","chicken","turkey","pork","bacon","fish","salmon","shrimp","egg","yolk",
      "arepa","tortilla","cornbread","corn cake","bread","bun","bagel","toast","pita",
      "rice","brown rice","quinoa","couscous","noodle","spaghetti","pasta","lasagna",
      "salad","lettuce","avocado","onion","garlic","beans","lentil","pea","broccoli","carrot",
      "potato","fries","yuca","cassava","plantain","banana","apple","orange",
      "soup","oatmeal","porridge","cereal","yogurt","milk","butter","oil",
      "cake","cookie","donut","pie","pancake","waffle"
    ]);

    const allConcepts = (food.concepts || []).map((c: any) => ({
      name: String(c.name),
      confidence: Number(c.value ?? c.confidence ?? 0)
    }));

    const concepts = allConcepts
      .filter(c => whitelist.has(c.name) && c.confidence >= minConf)
      .sort((a, b) => b.confidence - a.confidence);

    return res.status(200).json({
      ok: true,
      concepts,
      allConcepts,
      debug: { ...debug, gate: { badScore, goodScore, hasStrongFoodConcept } }
    });
  } catch (err: any) {
    return res.status(500).json({ ok:false, reason:"UNEXPECTED", error: String(err?.message || err) });
  }
}

