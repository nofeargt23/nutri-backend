// @ts-nocheck
import Busboy from "busboy";
import { Blob } from "buffer";
import sharp from "sharp";

const BASE = "https://api.logmeal.com";
const TTL = +(process.env.CACHE_TTL_SECONDS || 43200); // 12h
const MAX_BYTES = 1048576; // 1MB

// ===== Caché en memoria por instancia =====
const IMAGE_CACHE = new Map<string, { ts: number; data: any }>();
const cacheGet = (k: string) => {
  const h = IMAGE_CACHE.get(k);
  if (!h) return null;
  if ((Date.now() - h.ts) / 1000 > TTL) { IMAGE_CACHE.delete(k); return null; }
  return h.data;
};
const cacheSet = (k: string, data: any) => IMAGE_CACHE.set(k, { ts: Date.now(), data });

// Hash ligero (sin crypto)
function fastHash(buf: Buffer) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

// ===== Tokens + llamadas =====
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
    const token = tokens[(start + i) % tokens.length];
    let resp: any = null;
    try {
      resp = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch (e) { lastErr = e; continue; }
    if (resp.ok) return resp;
    const txt = await resp.text().catch(() => "");
    if ([401,403,429].includes(resp.status)) { lastErr = new Error(`${resp.status}: ${txt.slice(0,200)}`); continue; }
    throw new Error(`${resp.status}: ${txt.slice(0,200)}`);
  }
  throw lastErr || new Error("All tokens failed");
}
async function postJSON(path: string, body: any) {
  const r = await callWithTokens(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  return r.json();
}
async function postImage(path: string, file: { buffer: Buffer; filename?: string; mime?: string }) {
  const fd = new FormData();
  const blob = new Blob([file.buffer], { type: file.mime || "image/jpeg" });
  fd.append("image", blob, file.filename || "image.jpg");
  const r = await callWithTokens(`${BASE}${path}`, { method: "POST", body: fd });
  return r.json();
}

// ===== Parse multipart =====
function parseMultipart(req: any): Promise<{ file: { buffer: Buffer; filename?: string; mime?: string } | null; fields: any }> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    const out: any = { file: null, fields: {} };
    bb.on("file", (_n, s, info) => {
      const chunks: Buffer[] = [];
      s.on("data", (c: Buffer) => chunks.push(c));
      s.on("end", () => { out.file = { buffer: Buffer.concat(chunks), filename: info.filename, mime: info.mimeType }; });
    });
    bb.on("field", (n, v) => { out.fields[n] = v; });
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

// ===== Compresión server-side (<1MB) =====
async function compressUnder1MB(input: Buffer) {
  // intentos progresivos: bajar calidad y ancho hasta <1MB
  let buf = input;
  let quality = 80;
  let width: number | null = 1600;
  for (let i = 0; i < 6 && buf.length > MAX_BYTES; i++) {
    const pipeline = sharp(buf).rotate();
    if (width) pipeline.resize({ width, withoutEnlargement: true });
    buf = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
    quality = Math.max(40, quality - 10);
    if (width) width = Math.max(700, Math.floor(width * 0.8));
  }
  // si aún pasa 1MB, último intento a 40% sin resize extra
  if (buf.length > MAX_BYTES) {
    buf = await sharp(buf).jpeg({ quality: 40, mozjpeg: true }).toBuffer();
  }
  return buf;
}

// ===== Normalizador de nutrición (igual que antes) =====
const isNum = (x: any) => typeof x === "number" && Number.isFinite(x);
function deepFindNumberByKey(obj: any, testKey: (k: string) => boolean): number | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of Object.keys(obj)) {
    const lk = key.toLowerCase(); const val = (obj as any)[key];
    if (isNum(val) && testKey(lk)) return val;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const r = deepFindNumberByKey(val, testKey); if (isNum(r)) return r;
    }
  }
  return null;
}
function pickNumberByKey(obj: any, keys: (string | RegExp)[]) {
  for (const pat of keys) {
    const test = typeof pat === "string" ? (k: string) => k === pat.toLowerCase() : (k: string) => (pat as RegExp).test(k);
    const found = deepFindNumberByKey(obj, test); if (isNum(found)) return found;
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
            for (const vk of valueCandidates) { const val = it[vk]; if (isNum(val)) return val; }
          }
        }
        if (it && typeof it === "object") stack.push(it);
      }
    } else for (const k of Object.keys(v)) stack.push(v[k]);
  }
  return null;
}
function getNutrient(obj: any, keyMatchers: (string|RegExp)[], arrayMatchers?: RegExp[]) {
  const direct = pickNumberByKey(obj, keyMatchers); if (isNum(direct)) return direct;
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
  return { calories: kcal ?? null, protein_g: prot ?? null, carbs_g: carb ?? null, fat_g: fat ?? null, fiber_g: fiber ?? null, sugars_g: sugar ?? null,
           sodium_mg: sodium ?? null, potassium_mg: potas ?? null, calcium_mg: calci ?? null, iron_mg: iron ?? null, vitamin_d_iu: vitd ?? null };
}
function heuristicsByName(name?: string | null) {
  const n = (name || "").toLowerCase();
  if (/\b(huevo|egg)\b/.test(n)) return { calories:155, protein_g:13.0, carbs_g:1.1, fat_g:11.0, fiber_g:0, sugars_g:1.1, sodium_mg:124, potassium_mg:126, calcium_mg:50, iron_mg:1.2, vitamin_d_iu:87 };
  if (/pollo|chicken/.test(n)) return { calories:165, protein_g:31.0, carbs_g:0, fat_g:3.6, fiber_g:0, sugars_g:0, sodium_mg:74, potassium_mg:256, calcium_mg:15, iron_mg:1.0 };
  if (/arroz|rice/.test(n))    return { calories:130, protein_g:2.7, carbs_g:28, fat_g:0.3, fiber_g:0.4, sugars_g:0.1, sodium_mg:1, potassium_mg:35, calcium_mg:10, iron_mg:0.2 };
  return null;
}
const baseIsEmpty = (b: any) => [b?.protein_g, b?.carbs_g, b?.fat_g, b?.fiber_g, b?.sugars_g].every(v => !isNum(v));
const extractDishes = (o: any) => Array.isArray(o?.recognition_results) ? o.recognition_results
  : Array.isArray(o?.dishes) ? o.dishes : Array.isArray(o?.items) ? o.items : [];

// ===== Handler =====
export default async function handler(req: any, res: any) {
  cors(res);
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    let file: any = null; let body: any = null;

    if (ct.startsWith("application/json")) {
      const chunks: Buffer[] = []; for await (const ch of req) chunks.push(ch as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8"); body = raw ? JSON.parse(raw) : {};
    } else {
      const mp = await parseMultipart(req); file = mp.file; body = mp.fields;
    }

    // cache key
    let cacheKey = "";
    if (file?.buffer) cacheKey = "BUF:" + fastHash(file.buffer);
    else if (body?.imageId) cacheKey = "ID:" + String(body.imageId);
    if (cacheKey) { const c = cacheGet(cacheKey); if (c) { res.status(200).json(c); return; } }

    // pipeline
    let imageId: string | null = body?.imageId || null;
    let seg: any = null;

    if (file) {
      // 🔽 compresión a < 1MB ANTES de llamar a LogMeal
      file.buffer = await compressUnder1MB(file.buffer);
      file.mime = "image/jpeg";
      file.filename = "image.jpg";

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

    const firstName = dishes?.[0]?.name || dishes?.[0]?.dish || null;
    let base = normalizeNutrition(nutrition || {}); if (baseIsEmpty(base)) { const h = heuristicsByName(firstName); if (h) base = h; }

    if (!dishes.length) dishes = [{ name: "Plato (ingredientes)", prob: null }];

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
      nutrition_raw: nutrition
    };

    if (cacheKey) cacheSet(cacheKey, out);
    res.status(200).json(out);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
