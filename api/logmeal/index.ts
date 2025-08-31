import type { VercelRequest, VercelResponse } from "@vercel/node";
import axios from "axios";

const LOGMEAL_API_BASE = process.env.LOGMEAL_API_BASE || "https://api.logmeal.com";
const LOGMEAL_API_USER_TOKEN = process.env.LOGMEAL_API_USER_TOKEN; // el token “APIUser_*”
const LOGMEAL_TOKEN = process.env.LOGMEAL_TOKEN || LOGMEAL_API_USER_TOKEN; // compat
const COMPANY_TOKEN = process.env.LOGMEAL_COMPANY_TOKEN || "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    // La ruta existe -> 405 confirma que está bien desplegada
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { mode, url, base64 } = req.body || {};
    if (!mode || (mode !== "url" && mode !== "base64")) {
      return res.status(400).json({ ok: false, error: "Invalid mode. Use 'url' or 'base64'." });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${LOGMEAL_TOKEN}`,
    };
    if (COMPANY_TOKEN) headers["x-company-token"] = COMPANY_TOKEN;

    let payload: any;
    if (mode === "url") {
      if (!url) return res.status(400).json({ ok: false, error: "Missing 'url'." });
      payload = { image_url: url };
    } else {
      if (!base64) return res.status(400).json({ ok: false, error: "Missing 'base64'." });
      payload = { image: base64 }; // sin prefijo data:
    }

    // endpoint recomendado (reconocimiento + nutrición simplificada)
    const endpoint = `${LOGMEAL_API_BASE}/v2/image/recognition/complete`;

    const r = await axios.post(endpoint, payload, { headers, timeout: 15000 });
    return res.status(200).json({ ok: true, data: r.data });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail = err?.response?.data || err?.message || "Unknown error";
    return res.status(status).json({ ok: false, error: "Upstream error", detail });
  }
}
