// api/logmeal/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import fetch from "node-fetch";
import FormData from "form-data";

const LOGMEAL_BASE = process.env.LOGMEAL_API_BASE || "https://api.logmeal.com";
const LOGMEAL_TOKEN = process.env.LOGMEAL_TOKEN;                 // REQUIRED
const LOGMEAL_API_USER_TOKEN = process.env.LOGMEAL_API_USER_TOKEN; // optional
const LOGMEAL_COMPANY_TOKEN = process.env.LOGMEAL_COMPANY_TOKEN;   // optional

function authHeaders() {
  const h: Record<string, string> = {
    Authorization: `Bearer ${LOGMEAL_TOKEN}`,
  };
  if (LOGMEAL_API_USER_TOKEN) h["x-api-user-token"] = LOGMEAL_API_USER_TOKEN;
  if (LOGMEAL_COMPANY_TOKEN) h["x-company-token"] = LOGMEAL_COMPANY_TOKEN;
  return h;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    if (!LOGMEAL_TOKEN) return res.status(500).json({ error: "Missing LOGMEAL_TOKEN" });

    const { mode, url, base64 } = req.body || {};
    if (mode !== "url" && mode !== "base64") {
      return res.status(400).json({ error: "Invalid mode. Use 'url' or 'base64'." });
    }

    let lmRes: Response;

    if (mode === "url") {
      lmRes = await fetch(`${LOGMEAL_BASE}/image/recognition/type`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ image_url: url }),
      });
    } else {
      const clean = String(base64).replace(/^data:image\/[a-zA-Z]+;base64,/, "");
      const form = new FormData();
      form.append("image_base64", clean);
      lmRes = await fetch(`${LOGMEAL_BASE}/image/recognition/type`, {
        method: "POST",
        headers: { ...authHeaders(), ...form.getHeaders() },
        body: form as any,
      });
    }

    if (!lmRes.ok) {
      const txt = await lmRes.text().catch(() => "");
      return res.status(lmRes.status).json({ error: "LogMeal upstream", detail: txt });
    }

    const result = await lmRes.json();
    const items =
      (result?.recognition_results || result?.food || []).map((it: any) => ({
        name: it?.name || it?.food_name || "item",
        score: it?.prob || it?.score || 0,
      })) ?? [];

    return res.status(200).json({
      items,
      totals: { calories: undefined, protein_g: undefined, carbs_g: undefined, fat_g: undefined },
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
}
