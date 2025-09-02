// api/logmeal.ts — proxy con rotación + normalizador + heurísticos de respaldo
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

// ==== normalizador robusto (claves + arrays) ====
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

// ==== heurísticos de respaldo por nombre (100 g) ==
