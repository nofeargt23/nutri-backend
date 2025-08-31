import type { VercelRequest, VercelResponse } from "vercel";
import axios from "axios";
import FormData from "form-data";

const COMPANY = process.env.LOGMEAL_COMPANY_TOKEN!;
const USER = process.env.LOGMEAL_USER_TOKEN!;
const BASE = process.env.LOGMEAL_BASE_URL || "https://api.logmeal.com";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { base64 } = req.body || {};
    if (!base64) return res.status(400).json({ error: "Missing base64" });

    const cleaned = base64.replace(/^data:\w+\/\w+;base64,/, "");
    const buf = Buffer.from(cleaned, "base64");

    const form = new FormData();
    form.append("image", buf, { filename: "photo.jpg", contentType: "image/jpeg" });

    const r = await axios.post(
      `${BASE}/image/recognition/complete`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          "Authorization": `Bearer ${USER}`,
          "x-app-token": COMPANY,
        },
        timeout: 20000,
        maxBodyLength: 10 * 1024 * 1024,
      }
    );

    res.status(200).json(r.data);
  } catch (err: any) {
    const status = err?.response?.status || 500;
    res.status(status).json({
      error: "logmeal-base64-failed",
      detail: err?.response?.data || err?.message || String(err),
    });
  }
}
