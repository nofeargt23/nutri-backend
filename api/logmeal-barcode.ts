// api/logmeal-barcode.ts  (GET ?code=123)
// Usa el mismo pool LOGMEAL_TOKENS

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
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[(start + i) % tokens.length];
    const resp = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    }).catch(() => null as any);
    if (resp && resp.ok) return resp;
    if (resp && ![401, 403, 429].includes(resp.status)) {
      const t = await resp.text().catch(() => "");
      throw new Error(`${resp.status}: ${t.slice(0, 200)}`);
    }
  }
  throw new Error("All tokens failed (429/401/403)");
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const url = new URL(req.url || "", "http://localhost");
    const code = url.searchParams.get("code");
    if (!code) { res.status(400).json({ error: "Missing ?code" }); return; }
    const lm = `${BASE}/v2/barcode_scan/${encodeURIComponent(code)}`;
    const r = await callWithTokens(lm);
    const json = await r.json();
    res.status(200).json(json);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
