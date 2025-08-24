// /api/analyze-then-parse.js
// 1 llamada: Clarifai (workflow) -> filtra conceptos -> mapea a ingredientes -> Nutritionix -> macros

const MIN_CONF = 0.20;        // umbral de confianza para conceptos
const MAX_CONCEPTS = 20;      // recorte de top-N para no hacer ruido

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

// Mapea conceptos de Clarifai a ingredientes (strings) sencillos para Nutritionix
function mapConceptsToIngredients(concepts) {
  const keep = new Set([
    "rice","brown rice","white rice","pilaf","risotto","quinoa","couscous","oatmeal",
    "chicken","beef","pork","turkey","lamb","bacon","meat",
    "fish","salmon","tuna","shrimp",
    "egg","eggs",
    "beans","lentils","chickpea","pea",
    "tomato","onion","garlic","pepper","bell pepper","lettuce","spinach","carrot","corn","cauliflower","broccoli","cabbage","mushroom","zucchini","potato",
    "cheese","mozzarella","parmesan","blue cheese",
    "bread","tortilla","pasta","noodles",
    "oil","olive oil","butter","yogurt",
    "salt","sugar",
    "pizza","burger","sandwich","soup","porridge","stew"
  ]);

  // normaliza nombres y aplica un mapeo simple
  const normalize = (s) => s.toLowerCase().trim();
  const synonyms = new Map([
    ["meat","beef"],
    ["eggs","egg"],
    ["bell pepper","pepper"],
  ]);

  const picked = [];
  for (const c of concepts) {
    const name = normalize(c.name || "");
    if (!name) continue;
    // filtra por allowlist
    if (!keep.has(name)) continue;
    // sinónimos
    const norm = synonyms.get(name) || name;
    // mete con cantidad default si aplica
    if (["chicken","beef","pork","turkey","lamb","fish","salmon","tuna","shrimp","bacon"].includes(norm)) {
      picked.push(`150 g ${norm}`);
    } else if (["rice","brown rice","white rice","quinoa","couscous","oatmeal","pasta","noodles"].includes(norm)) {
      picked.push(`1 cup ${norm}`);
    } else if (["cheese","mozzarella","parmesan","blue cheese","yogurt"].includes(norm)) {
      picked.push(`30 g ${norm}`);
    } else if (["bread","tortilla"].includes(norm)) {
      picked.push(`1 slice ${norm}`);
    } else if (["pizza","burger","sandwich","soup","stew","porridge"].includes(norm)) {
      picked.push(norm); // platillos completos, Nutritionix suele entenderlos
    } else {
      // verduras/condimentos
      picked.push(norm);
    }
  }

  // dedup conservando orden
  const seen = new Set();
  const dedup = picked.filter(x => (seen.has(x) ? false : (seen.add(x), true)));

  // límite de 6-8 ingredientes para no sobrecargar
  return dedup.slice(0, 8);
}

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

  // primer output
  const out = json.results?.[0]?.outputs?.[0];
  const conceptsRaw = out?.data?.concepts || [];
  // normaliza
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
  // si proteges tus endpoints internos con x-api-key, reenvíalo
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

  // auth opcional
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

    // 1) CLARIFAI (si hay imagen)
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

    // 2) Armar lista de ingredientes candidata
    let ingList = Array.isArray(ingredients) ? ingredients.filter(Boolean) : [];
    if (ingList.length === 0 && concepts.length) {
      ingList = mapConceptsToIngredients(concepts);
    }
    if (ingList.length === 0 && typeof hint === "string" && hint.trim()) {
      ingList = [hint.trim()];
    }

    // 3) Nutritionix interno
    let nutrition = null;
    if (ingList.length) {
      const n = await callNutritionixInternal(req, ingList);
      nutrition = { ok: n.ok, status: n.status, data: n.json };
    }

    return res.status(200).json({
      debug: {
        minConf: MIN_CONF,
        mappedIngredients: ingList,
      },
      vision,
      concepts,
      nutrition
    });
  } catch (err) {
    return res.status(500).json({ error: "SERVER_ERROR", message: String(err?.message || err) });
  }
}
