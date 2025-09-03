// @ts-nocheck
import Busboy from "busboy";
import { Blob } from "buffer";

const BASE = "https://api.logmeal.com";
const TTL = +(process.env.CACHE_TTL_SECONDS || 43200); // 12h
const MAX_BYTES = 1048576; // 1MB

// ---------------------- Caché simple ----------------------
const CACHE = new Map<string, { ts: number; data: any }>();
const cacheGet = (k: string) => {
  const h = CACHE.get(k); if (!h) return null;
  if ((Date.now() - h.ts) / 1000 > TTL) { CACHE.delete(k); return null; }
  return h.data;
};
const cacheSet = (k: string, v: any) => CACHE.set(k, { ts: Date.now(), data: v });

function fastHash(buf: Buffer) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

// ---------------------- HTTP helpers ----------------------
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
  const r = await callWithTokens(`${BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {})
  });
  return r.json();
}
async function postImage(path: string, file: { buffer: Buffer; filename?: string; mime?: string }) {
  const fd = new FormData();
  const blob = new Blob([file.buffer], { type: file.mime || "image/jpeg" });
  fd.append("image", blob, file.filename || "image.jpg");
  const r = await callWithTokens(`${BASE}${path}`, { method: "POST", body: fd });
  return r.json();
}

// ---------------------- Multipart ----------------------
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

// ---------------------- Compresión (<1MB) ----------------------
async function compressUnder1MB(input: Buffer) {
  let sharp: any;
  try { const mod = await import("sharp"); sharp = mod.default || mod; }
  catch { return input; } // si no hay sharp, seguimos tal cual
  try {
    let buf = input, q = 80, w: number | null = 1600;
    for (let i = 0; i < 6 && buf.length > MAX_BYTES; i++) {
      const p = sharp(buf).rotate(); if (w) p.resize({ width: w, withoutEnlargement: true });
      buf = await p.jpeg({ quality: q, mozjpeg: true }).toBuffer();
      q = Math.max(40, q - 10); if (w) w = Math.max(700, Math.floor(w * 0.8));
    }
    if (buf.length > MAX_BYTES) buf = await sharp(buf).jpeg({ quality: 40, mozjpeg: true }).toBuffer();
    return buf;
  } catch { return input; }
}

// ---------------------- Normalización Nutrición ----------------------
const isNum = (x: any) => typeof x === "number" && Number.isFinite(x);

// "13 g" | "1,2" | {value:"13"} -> 13
function toNumber(val: any): number | null {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const m = val.replace(",", ".").match(/-?\d+(\.\d+)?/);
    if (m) return Number(m[0]);
  }
  if (val && typeof val === "object") {
    const n = toNumber(val.value ?? val.amount ?? val.quantity ?? val.qty ?? val.val);
    if (Number.isFinite(n as any)) return n as number;
  }
  return null;
}

// Devuelve sub-objetos preferidos "per 100 g"
function candidateScopes(n: any): any[] {
  if (!n || typeof n !== "object") return [];
  const scopes: any[] = [];
  const pushIf = (o: any) => { if (o && typeof o === "object") scopes.push(o); };

  // 1) bloques llamados per_100g / per100g / 100g / per_100
  for (const k of Object.keys(n)) {
    if (/(^|_|\s)per_?100g$|(^|_|\s)100g$|per_?100$/i.test(k)) pushIf(n[k]);
  }
  // 2) objetos que parezcan "per_100g" dentro de arrays
  const stack = [n];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) v.forEach(x => stack.push(x));
    else {
      for (const k of Object.keys(v)) {
        const child = v[k];
        if (/(^|_|\s)per_?100g$|(^|_|\s)100g$|per_?100$/i.test(k)) pushIf(child);
        if (child && typeof child === "object") stack.push(child);
      }
    }
  }
  // 3) si no encontramos, devolvemos también el objeto raíz como último recurso
  scopes.push(n);
  return scopes;
}

function deepFindNumberByKey(obj: any, testKey: (k: string) => boolean): number | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of Object.keys(obj)) {
    const lk = key.toLowerCase(); const val = (obj as any)[key];
    if (testKey(lk)) { const n = toNumber(val); if (Number.isFinite(n as any)) return n as number; }
    if (val && typeof val === "object") {
      const r = deepFindNumberByKey(val, testKey); if (Number.isFinite(r as any)) return r as number;
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
            for (const vk of valueCandidates) {
              if (vk in it) { const n = toNumber(it[vk]); if (Number.isFinite(n as any)) return n as number; }
            }
          }
        }
        if (it && typeof it === "object") stack.push(it);
      }
    } else for (const k of Object.keys(v)) stack.push(v[k]);
  }
  return null;
}
function getNutrient(obj: any, keys: (string|RegExp)[], arr?: RegExp[]) {
  const d = pickNumberByKey(obj, keys); if (isNum(d)) return d;
  const a = pickNumberFromArrays(obj, arr ?? keys.map(p => typeof p === "string" ? new RegExp(`\\b${p}\\b`) : p as RegExp));
  return isNum(a) ? a : null;
}

// Lee preferentemente "per 100 g"
function normalizePer100g(n: any) {
  const scopes = candidateScopes(n);
  const tryScope = (o: any) => {
    const en = {
      kcal: [/kcal\b/, /energy.*kcal/, /^calories?$/],
      protein: [/^protein/, /^prot\b/, /proteins?/],
      carb: [/^carb/, /carbo/, /carbohydrates?/],
      fat: [/^fat\b/, /lipid/],
      fiber: [/^fiber/, /fibre/],
      sugar: [/^sugar/],
      sodium: [/sodium/, /\bna\b/],
      potassium: [/potassium/, /\bk\b/],
      calcium: [/calcium/, /\bca\b/],
      iron: [/iron/, /\bfe\b/],
      vitd: [/vitamin[_\s-]?d/],
    };
    const es = {
      kcal: [/calor[ií]as?/, /energ[ií]a/],
      protein: [/prote[ií]na(s)?/],
      carb: [/hidratos?/, /carbohidratos?/],
      fat: [/grasas?/],
      fiber: [/fibra/],
      sugar: [/az[uú]car(es)?/],
      sodium: [/sodio/],
      potassium: [/potasio/],
      calcium: [/calcio/],
      iron: [/hierro/],
      vitd: [/vitamina[_\s-]?d/],
    };
    const kcal   = getNutrient(o, [...en.kcal, ...es.kcal]);
    const protein= getNutrient(o, [...en.protein, ...es.protein]);
    const carbs  = getNutrient(o, [...en.carb, ...es.carb]);
    const fat    = getNutrient(o, [...en.fat, ...es.fat]);
    const fiber  = getNutrient(o, [...en.fiber, ...es.fiber]);
    const sugar  = getNutrient(o, [...en.sugar, ...es.sugar]);
    const sodium = getNutrient(o, [...en.sodium, ...es.sodium]);
    const potas  = getNutrient(o, [...en.potassium, ...es.potassium]);
    const calci  = getNutrient(o, [...en.calcium, ...es.calcium]);
    const iron   = getNutrient(o, [...en.iron, ...es.iron]);
    const vitd   = getNutrient(o, [...en.vitd, ...es.vitd]);
    return { kcal, protein, carbs, fat, fiber, sugar, sodium, potas, calci, iron, vitd };
  };

  for (const s of scopes) {
    const v = tryScope(s);
    const anyMacro = [v.protein, v.carbs, v.fat].some(isNum);
    if (isNum(v.kcal) || anyMacro) {
      // sanity: si kcal por 100g > 900, recalcular si tenemos macros
      let kcal = v.kcal;
      if (isNum(kcal) && (kcal as number) > 900 && [v.protein, v.carbs, v.fat].every(isNum)) {
        kcal = +(4*(v.protein as number) + 4*(v.carbs as number) + 9*(v.fat as number)).toFixed(1);
      }
      return {
        calories: isNum(kcal) ? kcal : null,
        protein_g: v.protein ?? null,
        carbs_g: v.carbs ?? null,
        fat_g: v.fat ?? null,
        fiber_g: v.fiber ?? null,
        sugars_g: v.sugar ?? null,
        sodium_mg: v.sodium ?? null,
        potassium_mg: v.potas ?? null,
        calcium_mg: v.calci ?? null,
        iron_mg: v.iron ?? null,
        vitamin_d_iu: v.vitd ?? null,
      };
    }
  }
  return null;
}

const baseIsEmpty = (b: any) => !b || [b.protein_g,b.carbs_g,b.fat_g,b.fiber_g,b.sugars_g,b.calories].every(v => !isNum(v));
function numberAtKeys(o: any, keys: string[]) {
  for (const k of keys) {
    if (!(k in o)) continue;
    const n = toNumber(o[k]); if (Number.isFinite(n as any)) return n as number;
  }
  return null;
}
function gramsFromItem(it: any): number | null {
  return numberAtKeys(it, ["grams","g","weight_g","weight","mass_g","qty_g","quantity_g","amount_g","cantidad_g"]) ?? null;
}
function zeros(){return{calories:0,protein_g:0,carbs_g:0,fat_g:0,fiber_g:0,sugars_g:0,sodium_mg:0,potassium_mg:0,calcium_mg:0,iron_mg:0,vitamin_d_iu:0};}
function add(a:any,b:any){for(const k of Object.keys(a))a[k]+=isNum(b[k])?b[k]:0;return a;}
function totalsFromIngredients(raw:any){
  if(!raw)return null;const st=[raw];let out=zeros();let ok=false;
  while(st.length){const v=st.pop();if(!v||typeof v!=="object")continue;
    if(Array.isArray(v)){for(const it of v){if(it&&typeof it==="object"){
      const per100=normalizePer100g(it);
      if(per100&&!baseIsEmpty(per100)){const g=gramsFromItem(it);const f=g?g/100:1;
        const sc:any={...per100};for(const k of Object.keys(sc)){if(isNum(sc[k]))sc[k]=+(sc[k]*f).toFixed(2);} out=add(out,sc); ok=true;}
    } if(it&&typeof it==="object")st.push(it);} }
    else{for(const k of Object.keys(v))st.push(v[k]);}
  } return ok?out:null;
}

function comboHeuristicByName(name?:string|null){
  const n=(name||"").toLowerCase();
  const egg=/egg|huevo/.test(n), bacon=/bacon|tocino/.test(n), bread=/bread|pan|biscuit/.test(n);
  if(egg||bacon||bread){
    const egg100={calories:155,protein_g:13,carbs_g:1.1,fat_g:11.1,fiber_g:0,sugars_g:1.1,sodium_mg:124,potassium_mg:126,calcium_mg:50,iron_mg:1.2,vitamin_d_iu:87};
    const bacon100={calories:541,protein_g:37,carbs_g:1.4,fat_g:42,fiber_g:0,sugars_g:1.1,sodium_mg:1717,potassium_mg:565,calcium_mg:11,iron_mg:1.4,vitamin_d_iu:7};
    const bread100={calories:265,protein_g:9,carbs_g:49,fat_g:3.2,fiber_g:2.7,sugars_g:5,sodium_mg:491,potassium_mg:115,calcium_mg:144,iron_mg:3.6,vitamin_d_iu:0};
    const w=[egg?0.35:0,bacon?0.35:0,bread?0.30:0]; const tot=w.reduce((a,b)=>a+b,0)||1; const ws=w.map(x=>x/tot);
    const mix:any={}; const keys=Object.keys(egg100) as (keyof typeof egg100)[];
    for(const k of keys) mix[k]=+(egg100[k]*ws[0]+bacon100[k]*ws[1]+bread100[k]*ws[2]).toFixed(1);
    return mix;
  }
  return null;
}

const dishesFrom = (o:any)=>Array.isArray(o?.recognition_results)?o.recognition_results:
  Array.isArray(o?.dishes)?o.dishes:Array.isArray(o?.items)?o.items:[];

// ---------------------- Handler ----------------------
export default async function handler(req: any, res: any) {
  cors(res);
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const ct = (req.headers["content-type"] || "").toLowerCase();
    let file:any=null, body:any=null;

    if (ct.startsWith("application/json")) {
      const chun:Buffer[]=[]; for await (const ch of req) chun.push(ch as Buffer);
      const raw=Buffer.concat(chun).toString("utf8"); body = raw?JSON.parse(raw):{};
    } else {
      const mp = await parseMultipart(req); file = mp.file; body = mp.fields;
    }

    let cacheKey=""; if(file?.buffer) cacheKey="BUF:"+fastHash(file.buffer); else if(body?.imageId) cacheKey="ID:"+String(body.imageId);
    if (cacheKey){ const c=cacheGet(cacheKey); if(c){ res.status(200).json(c); return; } }

    let imageId:string|null = body?.imageId || null;
    let seg:any = null;

    if (file) {
      file.buffer = await compressUnder1MB(file.buffer);
      file.mime = "image/jpeg"; file.filename = "image.jpg";
      seg = await postImage("/v2/image/segmentation/complete", file);
      imageId = seg?.imageId || seg?.image_id || seg?.id || imageId;
    } else if (!imageId) { res.status(400).json({ error: "Missing image or imageId" }); return; }

    let dishes = dishesFrom(seg);
    if (!dishes.length) {
      try { const r1 = await postJSON("/v2/image/recognition/complete", { imageId }); dishes = dishesFrom(r1); } catch {}
      if (!dishes.length && file) { try { const r2 = await postImage("/v2/recognition/dish", file); dishes = dishesFrom(r2); } catch {} }
    }

    let ingredients:any=null;
    try { ingredients = await postJSON("/v2/nutrition/recipe/ingredients", { imageId }); } catch {}
    if (!ingredients && file) { try { ingredients = await postImage("/v2/nutrition/recipe/ingredients", file); } catch {} }

    let nutrition:any=null;
    try {
      const payload = imageId ? { imageId } : ingredients ? { ingredients } : {};
      nutrition = await postJSON("/v2/nutrition/recipe/nutritionalInfo", payload);
      if (!nutrition) { nutrition = await postJSON("/v2/recipe/nutritionalInfo", payload); }
    } catch {}

    const firstName = dishes?.[0]?.name || dishes?.[0]?.dish || null;

    // 1) per 100 g directo
    let base = normalizePer100g(nutrition || {});
    // 2) si no, sumarizado por ingredientes
    if (baseIsEmpty(base)) base = totalsFromIngredients(ingredients);
    // 3) heurística por nombre (huevos/bacon/pan…)
    if (baseIsEmpty(base)) base = comboHeuristicByName(firstName);

    if (!dishes.length) dishes = [{ name: "Plato (ingredientes)", prob: null }];

    const out = {
      imageId,
      candidates: dishes.map((d:any)=>({
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
    console.error("Proxy fatal error:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
}
