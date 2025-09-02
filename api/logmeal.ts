Replace the file at path api/logmeal.ts with the following content and save it.

---FILE START---
import Busboy from "busboy";
import { createHash } from "crypto";

const BASE = "https://api.logmeal.com";
const TTL = +(process.env.CACHE_TTL_SECONDS || 43200); // 12h por defecto

// Caché en memoria (por instancia)
const IMAGE_CACHE = new Map<string, { ts: number; data: any }>();

function cacheGet(key: string) {
  const hit = IMAGE_CACHE.get(key);
  if (!hit) return null;
  if ((Date.now() - hit.ts) / 1000 > TTL) { IMAGE_CACHE.delete(key); return null; }
  return hit.data;
}
function cacheSet(key: string, data: any) {
  IMAGE_CACHE.set(key, { ts: Date.now(), data });
}

function sha1(buf: Buffer) {
  return createHash("sha1").update(buf).digest("hex");
}

function getTokens(): string[] {
  const raw = process.env.LOGMEAL_TOKENS || "";
  const list = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (!list.length) throw new Error("Missing LOGMEAL_TOKENS env var");
  return list;
}

async function callWithTokens(url: string, init: RequestInit = {}) {
  const tokens = getTokens();
  const start = Math.floor(Date.now() / 60000) % tokens.length;
  let lastErr: any = null;
  for (let i = 0; i < tokens.length; i++) {
    const idx = (start + i) % tokens.length;
    const token = tokens[idx];
    let resp: any = null;
    try {
      resp = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch (e: any) { lastErr = e; continue; }
    if (resp.ok) return resp;
    const t = await resp.text().catch(() => "");
    if ([401,403,429].includes(resp.status)) { lastErr = new Error(`Token ${idx} failed ${resp.status}: ${t.slice(0,200)}`); continue; }
    throw new Error(`${resp.status}: ${t.slice(0,200)}`);
  }
  throw lastErr || new Error("All tokens failed");
}

async function postJSON(path: string, body: any) {
  const resp = await callWithTokens(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
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
      stream.on("end", () => { out.file = { buffer: Buffer.concat(chunks), filename: info.filename, mime: info.mimeType }; });
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

// ====== normalizador (claves + arrays) ======
const isNum = (x: any) => typeof x === "number" && Number.isFinite(x);

function deepFindNumberByKey(obj: any, testKey: (k: string) => boolean): number | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of Object.keys(obj)) {
    const lk = key.toLowerCase();
    const val = (obj as any)[key];
    if (isNum(val) && testKey(lk)) return val;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const r = deepFindNumberByKey(val, testKey);
      if (isNum(r)) return r;
    }
  }
  return null;
}
function pickNumberByKey(obj: any, keys: (string | RegExp)[]) {
  for (const pat of keys) {
    const test = typeof pat === "string" ? (k: string) => k === pat.toLowerCase() : (k: string) => (pat as RegExp).test(k);
    const found = deepFindNumberByKey(obj, test);
    if (isNum(found)) return found;
  }
  return null;
}
function pickNumberFromArrays(obj: any, nameRegexes: RegExp[], valueCandidates = ["value","amount","quantity","qty","val","per_100g","per100","per100g","kcal","g","mg"]) {
  const stack: any[] = [obj];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const it of v) {
        if (it && typeof it === "object") {
          const label = String(it.name ?? it.label ?? it.tag ?? it.key ?? it.nutrient ?? it.id ?? "").toLowerCase();
          if (label && nameRegexes.some(rx => rx.test(label))) {
            for (const vk of valueCandidates) {
              const val = it[vk];
              if (isNum(val)) return val;
            }
          }
        }
        if (it && typeof it === "object") stack.push(it);
      }
    } else {
      for (const k of Object.keys(v)) stack.push(v[k]);
    }
  }
  return null;
}
function getNutrient(obj: any, keyMatchers: (string|RegExp)[], arrayMatchers?: RegExp[]) {
  const direct = pickNumberByKey(obj, keyMatchers);
  if (isNum(direct)) return direct;
  const arr = pickNumberFromArrays(obj, arrayMatchers ?? keyMatchers.map(p => typeof p === "string" ? new RegExp(`\\b${p}\\b`) : p as RegExp));
  return isNum(arr) ? arr : null;
}
function normalizeNutrition(n: any) {
  const kcal   = getNutrient(n, [/kcal\b/, /energy.*kcal/, /^calories?$/], [/kcal\b/, /energy/, /^calories?$/]);
  const prot   = getNutrient(n, [/^protein/, /^prot\b/], [/^protein/]);
  const carb   = getNutrient(n, [/^carb/, /carbo/], [/^carb/, /carbo/]);
  const fat    = getNutrient(n, [/^fat\b/, /lipid/], [/^fat\b/, /lipid/]);
  const fiber  = getNutrient(n, [/^fiber/, /fibre/], [/^fiber/, /fibre/]);
  const sugar  = getNutrient(n, [/^sugar/], [/sugar/]);
  const sodium = getNutrient(n, [/sodium/, /\bna\b/], [/sodium/, /\bna\b/]);
  const potas  = getNutrient(n, [/potassium/, /\bk\b/], [/potassium/, /\bk\b/]);
  const calci  = getNutrient(n, [/calcium/, /\bca\b/], [/calcium/, /\bca\b/]);
  const iron   = getNutrient(n, [/iron/, /\bfe\b/], [/iron/, /\bfe\b/]);
  const vitd   = getNutrient(n, [/vitamin[_\s-]?d/], [/vitamin[_\s-]?d/]);
  return {
    calories: kcal ?? null,
    protein_g: prot ?? null,
    carbs_g: carb ?? null,
    fat_g: fat ?? null,
    fiber_g: fiber ?? null,
    sugars_g: sugar ?? null,
    sodium_mg: sodium ?? null,
    potassium_mg: potas ?? null,
    calcium_mg: calci ?? null,
    iron_mg: iron ?? null,
    vitamin_d_iu: vitd ?? null,
  };
}

// ====== heurísticos (más alimentos, por 100 g) ======
function heuristicsByName(name?: string | null) {
  const n = (name || "").toLowerCase();
  const H: Record<string, any> = {
    huevo:      { calories:155, protein_g:13.0, carbs_g:1.1, fat_g:11.0, fiber_g:0, sugars_g:1.1, sodium_mg:124, potassium_mg:126, calcium_mg:50, iron_mg:1.2, vitamin_d_iu:87 },
    egg:        { calories:155, protein_g:13.0, carbs_g:1.1, fat_g:11.0, fiber_g:0, sugars_g:1.1, sodium_mg:124, potassium_mg:126, calcium_mg:50, iron_mg:1.2, vitamin_d_iu:87 },
    pollo:      { calories:165, protein_g:31.0, carbs_g:0,   fat_g:3.6,  fiber_g:0, sugars_g:0,   sodium_mg:74,  potassium_mg:256, calcium_mg:15, iron_mg:1.0 },
    chicken:    { calories:165, protein_g:31.0, carbs_g:0,   fat_g:3.6,  fiber_g:0, sugars_g:0,   sodium_mg:74,  potassium_mg:256, calcium_mg:15, iron_mg:1.0 },
    arroz:      { calories:130, protein_g:2.7,  carbs_g:28,  fat_g:0.3,  fiber_g:0.4, sugars_g:0.1, sodium_mg:1, potassium_mg:35, calcium_mg:10, iron_mg:0.2 },
    rice:       { calories:130, protein_g:2.7,  carbs_g:28,  fat_g:0.3,  fiber_g:0.4, sugars_g:0.1, sodium_mg:1, potassium_mg:35, calcium_mg:10, iron_mg:0.2 },
    pasta:      { calories:157, protein_g:5.8,  carbs_g:30.6,fat_g:0.9,  fiber_g:1.8, sugars_g:1.1, sodium_mg:1, potassium_mg:44, calcium_mg:7, iron_mg:0.6 },
    beef:       { calories:250, protein_g:26,   carbs_g:0,   fat_g:17,   fiber_g:0, sugars_g:0,    sodium_mg:72, potassium_mg:318, calcium_mg:18, iron_mg:2.6 },
    pork:       { calories:242, protein_g:27,   carbs_g:0,   fat_g:14,   fiber_g:0, sugars_g:0,    sodium_mg:62, potassium_mg:362, calcium_mg:19, iron_mg:1.1 },
    salmon:     { calories:208, protein_g:20,   carbs_g:0,   fat_g:13,   fiber_g:0, sugars_g:0,    sodium_mg:59, potassium_mg:363, calcium_mg:9,  iron_mg:0.3 },
    tuna:       { calories:144, protein_g:23,   carbs_g:0,   fat_g:5,    fiber_g:0, sugars_g:0,    sodium_mg:50, potassium_mg:237, calcium_mg:4,  iron_mg:1.0 },
    bread:      { calories:265, protein_g:9,    carbs_g:49,  fat_g:3.2,  fiber_g:2.7, sugars_g:5,  sodium_mg:491,potassium_mg:115, calcium_mg:144, iron_mg:3.6 },
    queso:      { calories:402, protein_g:25,   carbs_g:1.3, fat_g:33,   fiber_g:0, sugars_g:0.5,  sodium_mg:621,potassium_mg:98,  calcium_mg:721, iron_mg:0.7 },
    cheese:     { calories:402, protein_g:25,   carbs_g:1.3, fat_g:33,   fiber_g:0, sugars_g:0.5,  sodium_mg:621,potassium_mg:98,  calcium_mg:721, iron_mg:0.7 },
    avocado:    { calories:160, protein_g:2,    carbs_g:9,   fat_g:15,   fiber_g:7, sugars_g:0.7,  sodium_mg:7,  potassium_mg:485, calcium_mg:12, iron_mg:0.6 },
    banana:     { calories:89,  protein_g:1.1,  carbs_g:23,  fat_g:0.3,  fiber_g:2.6, sugars_g:12, sodium_mg:1,  potassium_mg:358, calcium_mg:5,  iron_mg:0.3 },
    apple:      { calories:52,  protein_g:0.3,  carbs_g:14,  fat_g:0.2,  fiber_g:2.4, sugars_g:10, sodium_mg:1,  potassium_mg:107, calcium_mg:6,  iron_mg:0.1 }
  };
  for (const k of Object.keys(H)) if (n.includes(k)) return H[k];
  return null;
}
const baseIsEmpty = (b: any) => [b?.protein_g, b?.carbs_g, b?.fat_g, b?.fiber_g, b?.sugars_g].every(v => !isNum(v));

// ====== merge de ingredientes con limpieza ======
const STOP = new Set(["plato","dish","salad","ensalada","soup","sopa","with","con","de","a","y","the","la","el","los","las","un","una","food"]);
function cleanWord(w: string) {
  return w.replace(/[().,;:!?#]/g, "").trim().toLowerCase();
}
function addNamePieces(dst: Set<string>, s: string) {
  const parts = s.split(/[,/+-]| con | with | y | de /i);
  for (const p of parts) {
    const w = cleanWord(p);
    if (!w || w.length < 2) continue;
    if (STOP.has(w)) continue;
    dst.add(w);
  }
}
function extractNamesFromArray(arr: any[], keyCandidates = ["name","ingredient","ingredient_name","label","title"]) {
  const out: string[] = [];
  for (const it of arr || []) {
    for (const k of keyCandidates) {
      const val = (it && typeof it === "object") ? it[k] : null;
      if (typeof val === "string") out.push(val);
    }
  }
  return out;
}
function collectIngredientNames(seg: any, ingredients: any, dishes: any) {
  const bag = new Set<string>();
  // de ingredientes API
  const apiList = ingredients?.ingredients || ingredients?.data?.ingredients || ingredients?.list || ingredients?.items || [];
  for (const s of extractNamesFromArray(apiList)) addNamePieces(bag, s);
  // de reconocimiento de platos
  const ds = Array.isArray(dishes) ? dishes : [];
  for (const d of ds) {
    const nm = d?.name || d?.dish;
    if (nm) addNamePieces(bag, nm);
  }
  // de segmentación si aporta labels
  const segItems = seg?.items || seg?.objects || [];
  for (const s of extractNamesFromArray(segItems, ["label","name","class"])) addNamePieces(bag, s);

  // devolver top 12
  return Array.from(bag).slice(0, 12);
}

// ====== helpers platos ======
function extractDishes(obj: any): any[] {
  if (!obj) return [];
  if (Array.isArray(obj.recognition_results)) return obj.recognition_results;
  if (Array.isArray(obj.dishes)) return obj.dishes;
  if (Array.isArray(obj.items)) return obj.items;
  return [];
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

    // ------ caché (key por buffer o por imageId) ------
    let cacheKey = "";
    if (file?.buffer) cacheKey = "BUF:" + sha1(file.buffer);
    else if (body?.imageId) cacheKey = "ID:" + String(body.imageId);
    if (cacheKey) {
      const cached = cacheGet(cacheKey);
      if (cached) { res.status(200).json(cached); return; }
    }

    // ------ Pipeline ------
    let imageId: string | null = body?.imageId || null;
    let seg: any = null;

    if (file) {
      seg = await postImage("/v2/image/segmentation/complete", file);
      imageId = seg?.imageId || seg?.image_id || seg?.id || imageId;
    } else if (!imageId) {
      res.status(400).json({ error: "Missing image or imageId" }); return;
    }

    let dishes = extractDishes(seg);
    if (!dishes.length) {
      try { const r1 = await postJSON("/v2/image/recognition/complete", { imageId }); dishes = extractDishes(r1); } catch {}
      if (!dishes.length && file) { try { const r2 = await postImage("/v2/recognition/dish", file); dishes = extractDishes(r2); } catch {} }
    }

    let ingredients: any = null;
    try { ingredients = await postJSON("/v2/nutrition/recipe/ingredients", { imageId }); } catch {}
    if (!ingredients && file) { try { ingredients = await postImage("/v2/nutrition/recipe/ingredients", file); } catch {} }

    let nutrition: any = null;
    try { const payload = imageId ? { imageId } : ingredients ? { ingredients } : {}; nutrition = await postJSON("/v2/nutrition/recipe/nutritionalInfo", payload); } catch {}

    // normalizar + heurístico
    const firstName = dishes?.[0]?.name || dishes?.[0]?.dish || null;
    let base = normalizeNutrition(nutrition || {});
    if (baseIsEmpty(base)) {
      const h = heuristicsByName(firstName);
      if (h) base = h;
    }

    // ingredientes mejorados
    const ingredients_best = collectIngredientNames(seg, ingredients, dishes);

    if (!dishes.length) {
      const fallbackName = ingredients_best.slice(0,3).join(", ") || "Plato (ingredientes)";
      dishes = [{ name: fallbackName, prob: null }];
    }

    const out = {
      imageId,
      candidates: dishes.map((d: any) => ({
        name: d?.name || d?.dish || "Plato",
        confidence: d?.prob || d?.score || null,
        base_per: "100g",
        base,
        provider: "logmeal",
        raw: { dish: d, seg },
      })),
      ingredients,
      ingredients_best,
      nutrition_raw: nutrition
    };

    if (cacheKey) cacheSet(cacheKey, out);
    res.status(200).json(out);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
---FILE END---
