// /api/analyze-then-parse.js
// Clarifai (workflow) -> filtra conceptos -> mapea a ingredientes -> Nutritionix -> macros

const MIN_CONF = 0.20;        // umbral base para conservar conceptos
const MAX_CONCEPTS = 20;      // top-N máximo para evitar ruido

function setCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin || "";
  const isAllowed = !allowed.length || allowed.includes(origin);
  if (isAllowed && origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
}

function baseUrlFrom(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;
  const host = req.headers.host || "localhost:3000";
  const proto = host.includes("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

// ============== MAPEADOR MEJORADO (reemplazo completo) ==============
function mapConceptsToIngredients(concepts) {
  // 1) Normaliza y ordena
  const norm = concepts
    .map(c => ({ name: (c.name || "").toLowerCase().trim(), confidence: c.confidence || 0 }))
    .filter(c => c.name)
    .sort((a,b) => b.confidence - a.confidence);

  // 2) Listas base
  const GRAINS   = new Set(["rice","white rice","brown rice","quinoa","couscous","oatmeal","pilaf","risotto","pasta","noodles"]);
  const PROTEINS = new Set(["chicken","beef","pork","turkey","lamb","bacon","meat","fish","salmon","tuna","shrimp","egg","eggs"]);
  const VEGS     = new Set(["tomato","onion","garlic","pepper","bell pepper","lettuce","spinach","carrot","corn","cauliflower","broccoli","cabbage","mushroom","zucchini","beans","lentils","chickpea","pea","potato"]);
  const DAIRY    = new Set(["cheese","mozzarella","parmesan","blue cheese","yogurt","butter"]);
  const DISH     = new Set(["pizza","burger","sandwich","soup","stew","porridge"]);

  // 3) Umbrales diferenciados (más permisivo en proteínas)
  const TH_GRAIN = 0.15;
  const TH_PROT  = 0.08;  // rescata proteína con señal leve
  const TH_VEG   = 0.12;
  const TH_DAIRY = 0.12;
  const TH_DISH  = 0.20;

  const keep = [];
  let hasGrain = false, hasProtein = false;

  for (const c of norm) {
    const n = c.name;
    const v = c.confidence;

    if (DISH.has(n) && v >= TH_DISH) { keep.push(n); continue; }
    if (GRAINS.has(n) && v >= TH_GRAIN) { keep.push(n); hasGrain = true; continue; }
    if (PROTEINS.has(n) && v >= TH_PROT) {
      keep.push(n === "meat" ? "beef" : n);
      hasProtein = true;
      continue;
    }
    if (VEGS.has(n) && v >= TH_VEG)   { keep.push(n); continue; }
    if (DAIRY.has(n) && v >= TH_DAIRY) { keep.push(n); continue; }
  }

  // 4) Co-ocurrencia: si hay grano pero sin proteína, intenta rescatar una proteína débil (>= 0.05)
  if (hasGrain && !hasProtein) {
    const weakProt = norm.find(c => PROTEINS.has(c.name) && c.confidence >= 0.05);
    if (weakProt) {
      keep.push(weakProt.name === "meat" ? "beef" : weakProt.name);
      hasProtein = true;
    }
  }

  // 5) Cantidades por defecto y normalización simple
  const result = [];
  const seen = new Set();
  for (const n of keep) {
    if (seen.has(n)) continue; seen.add(n);

    if (PROTEINS.has(n)) {
      result.push(`150 g ${n}`);
    } else if (GRAINS.has(n)) {
      result.push(n.includes("rice") ? "1 cup rice" : `1 cup ${n}`);
    } else if (["cheese","mozzarella","parmesan","blue cheese"].includes(n)) {
      result.push(`30 g ${n}`);
    } else if (["bread","tortilla"].includes(n)) {
      result.push(`1 slice ${n}`);
    } else {
      result.push(n);
    }
  }

  return result.slice(0, 8);
}
// ====================================================================

async function callClarifaiWorkflow({ url, base64 }) {
  const KEY = process.env.CLARIFAI_API_KEY;
  const USER_ID = process.env.CLARIFAI_USER_ID || "nofeargt23";
  const APP_ID  = process.env.CLARIFAI_APP_ID  || "nofeargt23";
  const WORKFLOW_ID = process.env.CLARIFAI_WORKFLOW_ID || "foodnutri";

  if (!KEY) throw new Error("Missing CLARIFAI_API_KEY");

  const body = {
    inputs: [{ data: { image: url ? { url } : { base64 } } }]
  };

  const resp = await fetch(`https://api.clarifai.com/v2/users/${USER_ID}/apps/${APP_ID}/workflows/${WORKFLOW_ID}/results`, {
    method: "POST",
    headers: {
      Authorization: `Key ${KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const json = await resp.json().catch(() => null);
  if (!json) throw new Error("Clarifai: invalid JSON");
  if (json.status?.code !== 10000) {
    const msg = json.status?.description || "Clarifai error";
    throw new Error(`Clarifai: ${json.status?.code} ${msg}`);
  }

  const out = json.results?.[0]?.outputs?.[0];
  const conceptsRaw = out?.data?.concepts || [];

  const concepts = conceptsRaw
    .map(c => ({ name: c.name || c.id, confidence: c.value }))
    .filter(c => typeof c.confidence === "number")
    .sort((a,b) => b.confidence - a.confidence)
    .slice(0, MAX_CONCEPTS)
    .filter(c => c.confidence >= MIN_CONF);

  return { concepts, raw: { status: json.status, outStatus: out?.status } };
}

async function callNutritionixInternal(req, ingredients) {
  const base = baseUrlFrom(req);
  const headers = { "Content-Type": "application/json" };
  const k = req.headers["x-api-key"];
  if (k) headers["x-api-key"] = k;

  const resp = await fetch(`${base}/api/nutrition/parse`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ingredients })
  });
  const json = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, json };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  // auth opcional (requiere x-api-key si está configurada)
  const expected = process.env.BACKEND_API_KEY || "";
  const provided = req.headers["x-api-key"];
  if (expected && provided !== expected) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  try {
    const { url, base64, hint, ingredients } = req.body || {};
    if (!url && !base64 && !hint && !ingredients) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "Send 'url' or 'base64' (or 'hint'/'ingredients')." });
    }

    // 1) Clarifai (si hay imagen)
    let concepts = [];
    let vision = null;
    if (url || base64) {
      try {
        const v = await callClarifaiWorkflow({ url, base64 });
        vision = { ok: true, status: v.raw.status, outStatus: v.raw.outStatus, count: v.concepts.length };
        concepts = v.concepts;
      } catch (e) {
        vision = { ok: false, error: String(e.message || e) };
      }
    } else {
      vision = { ok: false, note: "No image provided; using hint/ingredients." };
    }

    // 2) Lista candidata de ingredientes
    let ingList = Array.isArray(ingredients) ? ingredients.filter(Boolean) : [];
    if (ingList.length === 0 && concepts.length) {
      ingList = mapConceptsToIngredients(concepts);
    }
    if (ingList.length === 0 && typeof hint === "string" && hint.trim()) {
      ingList = [hint.trim()];
    }

    // 3) Nutritionix
    let nutrition = null;
    if (ingList.length) {
      const n = await callNutritionixInternal(req, ingList);
      nutrition = { ok: n.ok, status: n.status, data: n.json };
    }

    return res.status(200).json({
      debug: { minConf: MIN_CONF, mappedIngredients: ingList },
      vision,
      concepts,
      nutrition
    });
  } catch (err) {
    return res.status(500).json({ error: "SERVER_ERROR", message: String(err?.message || err) });
  }
}
