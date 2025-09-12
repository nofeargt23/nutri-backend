// api/vision-labels.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const { imageBase64, maxResults = 10 } = (req.body as any) || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    const API_KEY = process.env.GOOGLE_VISION_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: "Missing GOOGLE_VISION_API_KEY env var" });
    }

    const visionReq = {
      requests: [
        {
          image: { content: imageBase64 },
          features: [{ type: "LABEL_DETECTION", maxResults }],
        },
      ],
    };

    const resp = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(visionReq),
      }
    );

    const json = await resp.json();
    if (!resp.ok) {
      // Devuelve el error de Google para que lo veas en la app
      return res.status(resp.status).json(json);
    }

    // Normaliza a { labels: [{description, score}] }
    const anns = json?.responses?.[0]?.labelAnnotations || [];
    const labels = anns.map((a: any) => ({
      description: a.description,
      score: a.score,
    }));

    return res.status(200).json({ labels });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
