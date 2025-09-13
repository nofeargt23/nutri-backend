// api/vision-labels.ts
// @ts-nocheck
export const runtime = 'edge';

export default async function handler(req: Request) {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
        status: 405, headers: { 'content-type': 'application/json' }
      });
    }

    const { imageBase64 } = await req.json().catch(() => ({} as any));
    if (!imageBase64) {
      return new Response(JSON.stringify({ ok: false, error: 'imageBase64 is required' }), {
        status: 400, headers: { 'content-type': 'application/json' }
      });
    }

    const key = process.env.GOOGLE_VISION_KEY || process.env.VISION_API_KEY;
    if (!key) {
      return new Response(JSON.stringify({ ok: false, error: 'VISION_API_KEY missing' }), {
        status: 500, headers: { 'content-type': 'application/json' }
      });
    }

    const gRes = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: [
          { image: { content: imageBase64 }, features: [{ type: 'LABEL_DETECTION', maxResults: 10 }] }
        ]
      })
    });

    const data = await gRes.json();
    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}
