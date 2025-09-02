// api/logmeal.ts  (Vercel Serverless Function)
// Proxy con rotación de tokens LOGMEAL_TOKENS (separados por coma)
// POST multipart (campo "image") o JSON {imageId}
// Devuelve: { imageId, candidates[], ingredients, nutrition_raw }

import Busboy from "busboy";

const BASE = "https://api.logmeal.com";

function getTokens(): string[] {
  const raw = process.env.LOGMEAL_TOKENS || "";
  const list = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (!list.length) throw new Error("Missing LOGMEAL_TOKENS env var");
  return list;
}

async function callWithTokens(url: string, init: RequestInit = {}) {
  const tokens = getTokens();
  const start = Math.floor(Date.now() / 60000) % tokens.length; // pseudo round-robin por minuto
  let lastErr: any = null;

  for (let i = 0; i < tokens.length; i++) {
    const idx = (start + i) % tokens.length;
    const token = tokens[idx];
    let resp: any = null;
    try {
      resp = await fetch(url, {
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
      });
    } catch (e: any) {
      lastErr = e;
      continue;
    }
    if (resp.ok) return resp;
    const t = await resp.text().catch(() => "");
    // 401/403/429: intenta con el siguiente token
    if ([401, 403, 429].includes(resp.status)) {
      lastErr = new Error(`Token ${idx} failed ${resp.status}: ${t.slice(0, 200)}`);
      continue;
    }
    // otros errores: corta
    throw new Error(`${resp.status}: ${t.slice(0, 200)}`);
  }
  throw lastErr || new Error("All tokens failed");
}

async function postJSON(path: string, body: any) {
  const resp = await callWithTokens(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return resp.json();
}

async function postImage(path: string, file: { buffer: Buffer; filename?: string; mime?: string }) {
  const fd = new FormData();
  const blob = new Blob([file.buffer], { type: file.mime || "image/jpeg" });
  fd.append("image", blob, file.filename || "image.jpg");
  const resp = await callWithTokens(`${BASE}${path}`, { method: "POST", body: fd });
  return resp.json();
}

function parseMultipart(req: any): Promise<{ file: { buffer: Buffer; filename?: string; mime?: string } | null; fields: any }> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    const out: any = { file: null, fields: {} };
    bb.on("file", (_name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        out.file = { buffer: Buffer.concat(chunks), filename: info.filename, mime: info.mimeType };
      });
    });
    bb.on("field", (name, val) => { out.fields[name] = val; });
    bb.on("finish", () => resolve(out));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

function cors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalizeNutrition(n: any) {
  const get = (obj: any, keys: (string | RegExp)[]) => {
    const stack = [{ v: obj }];
    while (stack.length) {
      const { v } = stack.pop() as any;
      if (!v || typeof v !== "object") continue;
      for (const k of Object.keys(v)) {
        const lk = k.toLowerCase();
        const val = (v as any)[k];
        if (typeof val === "number" && keys.some(p => (p instanceof RegExp ? p.test(lk) : p === lk))) return val;
        if (val && typeof val === "object") stack.push({ v: val });
      }
    }
    return null;
  };
  return {
    calories:      get(n, [/kcal\b/, /energy.*kcal/, "calories"]),
    protein_g:     get(n, [/^protein/, /^prot\b/]),
    carbs_g:       get(n, [/^carb/, /carbo/]),
    fat_g:         get(n, [/^fat\b/, /lipid/]),
    fiber_g:       get(n, [/^fiber/, /fibre/]),
    sugars_g:      get(n, [/^sugar/]),
    sodium_mg:     get(n, [/sodium/, /\bna\b/]),
    potassium_mg:  get(n, [/potassium/, /\bk\b/]),
    calcium_mg:    get(n, [/calcium/, /\bca\b/]),
    iron_mg:       get(n, [/iron/, /\bfe\b/]),
    vitamin_d_iu:  get(n, [/vitamin[_\s-]?d/]),
  };
}

function extractDishes(obj: any): any[] {
  if (!obj) return [];
  if (Array.isArray(obj.recognition_results)) return obj.recognition_results;
  if (Array.isArray(obj.dishes)) return obj.dishes;
  if (Array.isArray(obj.items)) return obj.items;
  return [];
}
function extractIngredientNames(ing: any): string[] {
  const arr =
    ing?.ingredients ||
    ing?.data?.ingredients ||
    ing?.list ||
    ing?.items || [];
  const names: string[] = [];
  if (Array.isArray(arr)) {
    for (const it of arr) {
      const n = it?.name || it?.ingredient || it?.ingredient_name || it?.label;
      if (n && typeof n === "string") names.push(n);
    }
  }
  return names;
}

export default async function handler(req: any, res: any) {
  cors(res);
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    let file: any = null;
    let body: any = null;

    if (ct.startsWith("application/json")) {
      const chunks: Buffer[] = [];
      for await (const ch of req) chunks.push(ch as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : {};
    } else {
      const mp = await parseMultipart(req);
      file = mp.file;
      body = mp.fields;
    }

    // Pipeline
    let imageId: string | null = body?.imageId || null;
    let seg: any = null;

    if (file) {
      seg = await postImage("/v2/image/segmentation/complete", file);
      imageId = seg?.imageId || seg?.image_id || seg?.id || imageId;
    } else if (!imageId) {
      res.status(400).json({ error: "Missing image or imageId" });
      return;
    }

    let dishes = extractDishes(seg);
    if (!dishes.length) {
      try {
        const r1 = await postJSON("/v2/image/recognition/complete", { imageId });
        dishes = extractDishes(r1);
      } catch {}
      if (!dishes.length && file) {
        try {
          const r2 = await postImage("/v2/recognition/dish", file);
          dishes = extractDishes(r2);
        } catch {}
      }
    }

    let ingredients: any = null;
    try { ingredients = await postJSON("/v2/nutrition/recipe/ingredients", { imageId }); } catch {}
    if (!ingredients && file) { try { ingredients = await postImage("/v2/nutrition/recipe/ingredients", file); } catch {} }

    let nutrition: any = null;
    try {
      const payload = imageId ? { imageId } : ingredients ? { ingredients } : {};
      nutrition = await postJSON("/v2/nutrition/recipe/nutritionalInfo", payload);
    } catch {}

    if (!dishes.length) {
      const names = extractIngredientNames(ingredients);
      dishes = [{ name: names.slice(0,3).join(", ") || "Plato (ingredientes)", prob: null }];
    }

    const base = normalizeNutrition(nutrition || {});
    const candidates = dishes.map((d: any) => ({
      name: d?.name || d?.dish || "Plato",
      confidence: d?.prob || d?.score || null,
      base_per: "100g",
      base,
      provider: "logmeal",
      raw: { dish: d, seg },
    }));

    res.status(200).json({ imageId, candidates, ingredients, nutrition_raw: nutrition });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
