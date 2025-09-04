// @ts-nocheck
import Busboy from "busboy";
import { Blob } from "buffer";

const BASE = "https://api.logmeal.com";
const TTL = +(process.env.CACHE_TTL_SECONDS || 43200); // 12h
const MAX_BYTES = 1048576; // 1 MB
const CONF_THRESHOLD = 0.7; // umbral de confianza del plato principal

// ---------------------- cache ----------------------
const CACHE = new Map<string, { ts: number; data: any }>();
const now = () => Date.now();
const cacheGet = (k: string) => {
  const h = CACHE.get(k);
  if (!h) return null;
  if ((now() - h.ts) / 1000 > TTL) {
    CACHE.delete(k);
    return null;
  }
  return h.data;
};
const cacheSet = (k: string, v: any) => CACHE.set(k, { ts: now(), data: v });
const fastHash = (b: Buffer) => {
  let h = (2166136261 >>> 0) as number;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
};

// ---------------------- tokens / calls ----------------------
function getTokens(): string[] {
  const raw = process.env.LOGMEAL_TOKENS || "";
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new Error("Missing LOGMEAL_TOKENS");
  return list;
}
async function callWithTokens(url: string, init: RequestInit = {}) {
  const tokens = getTokens();
  const start = Math.floor(now() / 60000) % tokens.length;
  let last: any = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[(start + i) % tokens.length];
    try {
      const r = await fetch(url, {
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` },
      });
      if (r.ok) return r;
      const txt = await r.text().catch(() => "");
      if ([401, 403, 429].includes(r.status)) {
        last = new Error(`${r.status}: ${txt.slice(0, 200)}`);
        continue;
      }
      throw new Error(`${r.status}: ${txt.slice(0, 200)}`);
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("All tokens failed");
}
async function postJSON(path: string, body: any) {
  const r = await callWithTokens(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}
async function postImage(
  path: string,
  file: { buffer: Buffer; filename?: string; mime?: string }
) {
  const fd = new FormData();
  const blob = new Blob([file.buffer], { type: file.mime || "image/jpeg" });
  fd.append("image", blob, file.filename || "image.jpg");
  const r = await callWithTokens(`${BASE}${path}`, { method: "POST", body: fd });
  return r.json();
}

// ---------------------- multipart + cors ----------------------
function parseMultipart(req: any): Promise<{
  file: { buffer: Buffer; filename?: string; mime?: string } | null;
  fields: any;
}> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    const out: any = { file: null, fields: {} };
    bb.on("file", (_n, s, info) => {
      const chunks: Buffer[] = [];
      s.on("data", (c: Buffer) => chunks.push(c));
      s.on("end", () => {
        out.file = {
          buffer: Buffer.concat(chunks),
          filename: info.filename,
          mime: info.mimeType,
        };
      });
    });
    bb.on("field", (n, v) => (out.fields[n] = v));
    bb.on("finish", () => resolve(out));
    bb.on("error", reject);
    req.pipe(bb);
  });
}
const cors = (res: any) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

// ---------------------- compress <1MB ----------------------
async function compressUnder1MB(input: Buffer) {
  let sharp: any;
  try {
    const mod = await import("sharp");
    sharp = mod.default || mod;
  } catch {
    return input;
  }
  try {
    let buf = input;
    let q = 80;
    let w: number | null = 1600;
    for (let i = 0; i < 6 && buf.length > MAX_BYTES; i++) {
      const p = sharp(buf).rotate();
      if (w) p.resize({ width: w, withoutEnlargement: true });
      buf = await p.jpeg({ quality: q, mozjpeg: true }).toBuffer();
      q = Math.max(40, q - 10);
      if (w) w = Math.max(700, Math.floor(w * 0.8));
    }
    if (buf.length > MAX_BYTES) {
      buf = await sharp(buf).jpeg({ quality: 40, mozjpeg: true }).toBuffer();
    }
    return buf;
  } catch {
    return input;
  }
}

// ---------------------- nutrition helpers ----------------------
const isNum = (x: any) => typeof x === "number" && Number.isFinite(x);
function toNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.replace(",", ".").match(/-?\d+(\.\d+)?/);
    if (m) return Number(m[0]);
  }
  if (v && typeof v === "object") {
    const n = toNumber(
      v.value ?? v.amount ?? v.quantity ?? v.qty ?? v.val ?? v.per_100g
    );
    if (isNum(n)) return n as number;
  }
  return null;
}
function deepFindNumberByKey(
  obj: any,
  pred: (k: string) => boolean
): number | null {
  if (!obj || typeof obj !== "object") return null;
  for (const k of Object.keys(obj)) {
    const val = obj[k],
      lk = k.toLowerCase();
    if (pred(lk)) {
      const n = toNumber(val);
      if (isNum(n)) return n as number;
    }
    if (val && typeof val === "object") {
      const r = deepFindNumberByKey(val, pred);
      if (isNum(r)) return r as number;
    }
  }
  return null;
}
function pickNumberByKey(obj: any, keys: (string | RegExp)[]) {
  for (const p of keys) {
    const t =
      typeof p === "string"
        ? (k: string) => k === p.toLowerCase()
        : (k: string) => (p as RegExp).test(k);
    const n = deepFindNumberByKey(obj, t);
    if (isNum(n)) return n;
  }
  return null;
}
function pickNumberFromArrays(
  obj: any,
  regs: RegExp[],
  values = [
    "value",
    "amount",
    "quantity",
    "qty",
    "val",
    "per_100g",
    "per100",
    "per100g",
    "kcal",
    "g",
    "mg",
  ]
) {
  const stack = [obj];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const it of v) {
        if (it && typeof it === "object") {
          const label = String(
            it.name ?? it.label ?? it.tag ?? it.key ?? it.nutrient ?? it.id ?? ""
          ).toLowerCase();
          if (label && regs.some((rx) => rx.test(label))) {
            for (const vk of values) {
              if (vk in it) {
                const n = toNumber(it[vk]);
                if (isNum(n)) return n as number;
              }
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
function getNutrient(obj: any, keys: (string | RegExp)[], arr?: RegExp[]) {
  const d = pickNumberByKey(obj, keys);
  if (isNum(d)) return d;
  const a = pickNumberFromArrays(
    obj,
    arr ?? keys.map((p) => (typeof p === "string" ? new RegExp(`\\b${p}\\b`) : (p as RegExp)))
  );
  return isNum(a) ? a : null;
}
function candidateScopes(n: any): any[] {
  if (!n || typeof n !== "object") return [];
  const scopes: any[] = [];
  const push = (o: any) => { if (o && typeof o === "object") scopes.push(o); };
  for (const k of Object.keys(n))
    if (/(^|_|\s)per_?100g$|(^|_|\s)100g$|per_?100$/i.test(k)) push(n[k]);
  const stack = [n];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) v.forEach((x) => stack.push(x));
    else for (const k of Object.keys(v)) {
      const c = v[k];
      if (/(^|_|\s)per_?100g$|(^|_|\s)100g$|per_?100$/i.test(k)) push(c);
      if (c && typeof c === "object") stack.push(c);
    }
  }
  scopes.push(n);
  return scopes;
}
function normalizePer100g(n: any) {
  const scopes = candidateScopes(n);
  const run = (o: any) => {
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
    const kcal = getNutrient(o, [...en.kcal, ...es.kcal]);
    const protein = getNutrient(o, [...en.protein, ...es.protein]);
    const carbs = getNutrient(o, [...en.carb, ...es.carb]);
    const fat = getNutrient(o, [...en.fat, ...es.fat]);
    const fiber = getNutrient(o, [...en.fiber, ...es.fiber]);
    const sugar = getNutrient(o, [...en.sugar, ...es.sugar]);
    const sodium = getNutrient(o, [...en.sodium, ...es.sodium]);
    const potas = getNutrient(o, [...en.potassium, ...es.potassium]);
    const calci = getNutrient(o, [...en.calcium, ...es.calcium]);
    const iron = getNutrient(o, [...en.iron, ...es.iron]);
    const vitd = getNutrient(o, [...en.vitd, ...es.vitd]);
    return {
      kcal, protein, carbs, fat, fiber, sugar, sodium, potas, calci, iron, vitd,
    };
  };
  for (const s of scopes) {
    const v = run(s);
    const anyMacro = [v.protein, v.carbs, v.fat].some(isNum);
    if (isNum(v.kcal) || anyMacro) {
      let kcal = v.kcal;
      if (isNum(kcal) && (kcal as number) > 900 &&
          [v.protein, v.carbs, v.fat].every(isNum)) {
        kcal = +(4*(v.protein as number)+4*(v.carbs as number)+9*(v.fat as number)).toFixed(1);
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
const baseIsEmpty = (b: any) =>
  !b ||
  [b.protein_g, b.carbs_g, b.fat_g, b.fiber_g, b.sugars_g, b.calories].every((v) => !isNum(v));
const zeros = () => ({
  calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugars_g: 0,
  sodium_mg: 0, potassium_mg: 0, calcium_mg: 0, iron_mg: 0, vitamin_d_iu: 0,
});
const add = (a: any, b: any) => { for (const k of Object.keys(a)) a[k] += isNum(b[k]) ? b[k] : 0; return a; };
const avg = (arr: any[]) => { if (!arr.length) return null; const t = zeros(); arr.forEach((x) => add(t, x)); for (const k of Object.keys(t)) t[k] = +(t[k] / arr.length).toFixed(2); return t; };
function per100FromIngredients(raw: any) {
  if (!raw) return null;
  const items: any[] = [];
  const stack = [raw];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      v.forEach((it) => {
        if (it && typeof it === "object") {
          const p = normalizePer100g(it);
          if (p && !baseIsEmpty(p)) items.push(p);
        }
        if (it && typeof it === "object") stack.push(it);
      });
    } else for (const k of Object.keys(v)) stack.push(v[k]);
  }
  return items.length ? avg(items) : null;
}

// ---------------------- mezcla limitada por nombre principal ----------------------
type Nut = {
  calories: number; protein_g: number; carbs_g: number; fat_g: number;
  fiber_g?: number; sugars_g?: number; sodium_mg?: number; potassium_mg?: number;
  calcium_mg?: number; iron_mg?: number; vitamin_d_iu?: number;
};
const F: Record<string, Nut> = {
  egg:{calories:155,protein_g:13,carbs_g:1.1,fat_g:11.1,fiber_g:0,sugars_g:1.1,sodium_mg:124,potassium_mg:126,calcium_mg:50,iron_mg:1.2,vitamin_d_iu:87},
  bacon:{calories:541,protein_g:37,carbs_g:1.4,fat_g:42,sodium_mg:1717,potassium_mg:565,calcium_mg:11,iron_mg:1.4},
  ham:{calories:145,protein_g:20,carbs_g:1.5,fat_g:6.7,sodium_mg:1200},
  charcuterie:{calories:300,protein_g:18,carbs_g:2,fat_g:24,sodium_mg:1200},
  sobrasada:{calories:459,protein_g:11,carbs_g:1.5,fat_g:45,sodium_mg:1400},
  bread:{calories:265,protein_g:9,carbs_g:49,fat_g:3.2,fiber_g:2.7,sugars_g:5,sodium_mg:491,calcium_mg:144,iron_mg:3.6},
  rice:{calories:130,protein_g:2.4,carbs_g:28,fat_g:0.3,fiber_g:0.4},
  cheese:{calories:402,protein_g:25,carbs_g:1.3,fat_g:33},
  ricotta:{calories:174,protein_g:11.3,carbs_g:3,fat_g:13},
  cottage:{calories:98,protein_g:11.1,carbs_g:3.4,fat_g:4.3},
  beef:{calories:250,protein_g:26,carbs_g:0,fat_g:17},
  chicken:{calories:165,protein_g:31,carbs_g:0,fat_g:3.6},
  mushroom:{calories:22,protein_g:3.1,carbs_g:3.3,fat_g:0.3},
  asparagus:{calories:20,protein_g:2.2,carbs_g:3.9,fat_g:0.1},
  avocado:{calories:160,protein_g:2,carbs_g:9,fat_g:15,fiber_g:7}
};
const MATCHES: Array<[RegExp, keyof typeof F]> = [
  [/huevo|egg/i,"egg"], [/bacon|tocino/i,"bacon"], [/jam[oó]n|ham|prosciutto/i,"ham"],
  [/charcuterie|embutid/i,"charcuterie"], [/sobras?ada|sobrassada|salami|chorizo/i,"sobrasada"],
  [/ricotta/i,"ricotta"], [/cottage/i,"cottage"], [/queso|cheese/i,"cheese"],
  [/pan|bread|biscuit/i,"bread"], [/arroz|rice/i,"rice"], [/res|beef|carne molida/i,"beef"],
  [/pollo|chicken/i,"chicken"], [/champi|mushroom/i,"mushroom"], [/esp[aá]rrago|asparagus/i,"asparagus"],
  [/aguacate|avocado/i,"avocado"]
];
function mixFromPrimaryName(name: string): any | null {
  const hits: Nut[] = [];
  const n = (name || "").toLowerCase();
  for (const [rx, k] of MATCHES) if (rx.test(n)) hits.push(F[k]);
  return hits.length ? avg(hits) : null;
}

// ---------------------- saneo y kcal Atwater ----------------------
function fillMissing(base: any, ref: any) {
  if (!base || !ref) return base;
  const out = { ...base };
  for (const k of Object.keys(ref)) if (!isNum(out[k])) out[k] = ref[k];
  return out;
}
function sanitize(base: any, ref: any | null) {
  let out = { ...base };
  for (const k of ["protein_g","carbs_g","fat_g","fiber_g","sugars_g"])
    if (isNum(out[k])) out[k] = Math.max(0, Math.min(100, out[k]));
  if (isNum(out.sodium_mg))    out.sodium_mg    = Math.max(0, Math.min(3500, out.sodium_mg));
  if (isNum(out.potassium_mg)) out.potassium_mg = Math.max(0, Math.min(2500, out.potassium_mg));
  if (isNum(out.calcium_mg))   out.calcium_mg   = Math.max(0, Math.min(1500, out.calcium_mg));
  if (isNum(out.iron_mg))      out.iron_mg      = Math.max(0, Math.min(30,   out.iron_mg));

  const missingMacros = ["protein_g","carbs_g","fat_g"].some(k => !isNum(out[k]));
  const kcalWeird = !isNum(out.calories) || (isNum(out.calories) && out.calories > 420);
  if (ref && (missingMacros || kcalWeird)) out = fillMissing(out, ref);

  if (["protein_g","carbs_g","fat_g"].every(k => isNum(out[k]))) {
    const kcal = +(4*out.protein_g + 4*out.carbs_g + 9*out.fat_g).toFixed(1);
    if (!isNum(out.calories) || out.calories > kcal*1.2 || out.calories < kcal*0.8)
      out.calories = kcal;
  }
  return out;
}

// ---------------------- helpers de nombres ----------------------
const dishesFrom = (o:any)=> Array.isArray(o?.recognition_results)?o.recognition_results :
  Array.isArray(o?.dishes)?o.dishes : Array.isArray(o?.items)?o.items : [];
function namesFromAll(dishes:any[], ingredients:any): string[] {
  const names:string[]=[];
  dishes.forEach((d:any)=>{ const n=(d?.name||d?.dish||"")+"";
    if (n.trim()) names.push(n.toLowerCase());
  });
  const stack=[ingredients];
  while(stack.length){
    const v=stack.pop();
    if (!v||typeof v!=="object") continue;
    if (Array.isArray(v)) v.forEach(x=>stack.push(x));
    else {
      const label=(v.name||v.label||v.ingredient||v.title||"")+"";
      if (label && label.length<60) names.push(label.toLowerCase());
      for (const k of Object.keys(v)) stack.push(v[k]);
    }
  }
  return Array.from(new Set(names)).slice(0,50);
}

// ---------------------- handler ----------------------
export default async function handler(req:any,res:any){
  cors(res);
  if (req.method==="OPTIONS"){ res.status(200).end(); return; }
  if (req.method!=="POST"){ res.status(405).json({error:"Method not allowed"}); return; }

  try {
    const ct=(req.headers["content-type"]||"").toLowerCase();
    let file:any=null, body:any=null;
    if (ct.startsWith("application/json")){
      const chunks:Buffer[]=[]; for await (const ch of req) chunks.push(ch as Buffer);
      const raw=Buffer.concat(chunks).toString("utf8"); body=raw?JSON.parse(raw):{};
    } else {
      const mp=await parseMultipart(req); file=mp.file; body=mp.fields;
    }

    let cacheKey=""; if (file?.buffer) cacheKey="BUF:"+fastHash(file.buffer); else if (body?.imageId) cacheKey="ID:"+String(body.imageId);
    if (cacheKey){ const c=cacheGet(cacheKey); if(c){ res.status(200).json(c); return; } }

    let imageId = body?.imageId || null;
    let seg:any=null;

    if (file){
      file.buffer = await compressUnder1MB(file.buffer);
      file.mime="image/jpeg"; file.filename="image.jpg";
      seg = await postImage("/v2/image/segmentation/complete", file);
      imageId = seg?.imageId || seg?.image_id || seg?.id || imageId;
    } else if (!imageId){ res.status(400).json({error:"Missing image or imageId"}); return; }

    // reconocimiento de platos
    let dishes = dishesFrom(seg);
    if (!dishes.length){
      try { const r1=await postJSON("/v2/image/recognition/complete",{imageId}); dishes=dishesFrom(r1);} catch {}
      if (!dishes.length && file){ try { const r2=await postImage("/v2/recognition/dish", file); dishes=dishesFrom(r2);} catch {} }
    }

    // ingredientes y nutrición
    let ingredients:any=null;
    try { ingredients=await postJSON("/v2/nutrition/recipe/ingredients",{imageId}); } catch {}
    if (!ingredients && file){ try { ingredients=await postImage("/v2/nutrition/recipe/ingredients",file);} catch{} }

    let nutrition:any=null;
    try {
      const payload=imageId?{imageId}:ingredients?{ingredients}:{};
      nutrition = await postJSON("/v2/nutrition/recipe/nutritionalInfo", payload);
      if (!nutrition) nutrition = await postJSON("/v2/recipe/nutritionalInfo", payload);
    } catch {}

    // decisión basada en confianza
    const names = namesFromAll(dishes, ingredients);
    const primary = dishes?.[0] || {};
    const primaryName = (primary?.name || primary?.dish || names[0] || "").toLowerCase();
    const conf = Number(primary?.prob ?? primary?.score ?? 0);

    // normalización base
    let base = normalizePer100g(nutrition || {});
    if (baseIsEmpty(base)) base = per100FromIngredients(ingredients);

    // relleno controlado por confianza
    let refMix: any = null;
    if (conf >= CONF_THRESHOLD) {
      // solo mezclamos por el nombre principal si el modelo está seguro
      refMix = mixFromPrimaryName(primaryName);
    }

    if (base) base = fillMissing(base, refMix);
    if (base) base = sanitize(base, refMix);
    if (!base && refMix) base = refMix;

    if (!dishes.length) dishes=[{ name:"Dish", prob:null }];

    const out = {
      imageId,
      candidates: dishes.map((d:any)=>({
        name: d?.name || d?.dish || "Dish",
        confidence: d?.prob || d?.score || null,
        base_per: "100g",
        base,
        provider: "logmeal",
        raw: { dish:d, seg }
      })),
      ingredients,
      nutrition_raw: nutrition
    };

    if (cacheKey) cacheSet(cacheKey,out);
    res.status(200).json(out);
  } catch (e:any){
    console.error("Proxy fatal error:", e);
    res.status(500).json({ error:String(e?.message||e) });
  }
}
