// api/vision.ts
// @ts-nocheck
export const runtime = 'edge';

export default async function handler() {
  return new Response(
    JSON.stringify({ ok: false, error: 'endpoint disabled' }),
    { status: 410, headers: { 'content-type': 'application/json' } }
  );
}
