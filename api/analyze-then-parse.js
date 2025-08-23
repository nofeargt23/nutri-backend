// api/analyze-then-parse.js (DEBUG + base fijo)
async function readMaybeJson(resp) {
  const ct = resp.headers.get("content-type") || "";
  const text = await resp.text();
  if (ct.includes("application/json")) {
    try { return { ok: true, json: JSON.parse(text), raw: text, ct, status: resp.status }; }
    catch (e) { return { ok: false, error: "json-parse-failed", raw: text.slice(0, 500), ct, status: resp.status }; }
  }
  return { ok: false, error: "non-json", raw: text.slice(0, 500), ct, status: resp.status };
}

export default async function handler(req, res) {
  // ---- CORS básico ----
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin || "";
  const isAllowed = !allowed.length || allowed.includes(origin);
  if (isAllowed && origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  // ---- Auth ----
  const expected = process.env.BACKEND_API_KEY || "";
  const provided = req.headers["x-api-key"];
  if (expected && provided !== expected) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "BAD_REQUEST", message: "url required" });

    // <<<<<< FORZAR BASE ESTABLE >>>>>>
    const explicit = process.env.PUBLIC_BASE_URL; // p.ej. https://nutri-backend-chi.vercel.app
    const base = explicit || `https://${req.headers.host}`;

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": provided || ""
    };

    // 1) Vision
    const vUrl = `${base}/api/vision/analyze`;
    const vResp = await fetch(vUrl, { method: "POST", headers, body: JSON.stringify({ url }) });
    const vData = await readMaybeJson(vResp);

    // 2) Nutrition (solo si visión trajo conceptos)
    let nData = null, nUrl = null;
    if (vData.ok && Array.isArray(vData.json?.concepts) && vData.json.concepts.length) {
      nUrl = `${base}/api/nutrition/parse`;
      const ingredients = vData.json.concepts.map(c => c.name);
      const nResp = await fetch(nUrl, { method: "POST", headers, body: JSON.stringify({ ingredients }) });
      nData = await readMaybeJson(nResp);
    }

    return res.status(200).json({
      debug: {
        base,
        vUrl, vStatus: vData?.status, vCt: vData?.ct,
        vOk: vData?.ok, vErr: vData?.error || null,
        vRaw: vData?.ok ? undefined : vData?.raw
      },
      vision: vData?.ok ? vData.json : null,
      nutritionDebug: nData && {
        nUrl, nStatus: nData?.status, nCt: nData?.ct,
        nOk: nData?.ok, nErr: nData?.error || null,
        nRaw: nData?.ok ? undefined : nData?.raw
      },
      nutrition: nData?.ok ? nData.json : null
    });
  } catch (err) {
    return res.status(500).json({ error: "SERVER_ERROR", message: err?.message || String(err) });
  }
}
