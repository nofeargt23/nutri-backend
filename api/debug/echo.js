// api/debug/echo.js
export default function handler(req, res) {
  const expected = process.env.BACKEND_API_KEY || "";
  const provided = req.headers["x-api-key"] || "";
  return res.status(200).json({
    method: req.method,
    providedLen: provided.length,
    expectedLen: expected.length,
    match: Boolean(expected) && provided === expected,
    sampleHeaders: {
      "content-type": req.headers["content-type"] || null,
      "x-api-key": provided ? "[present]" : null
    }
  });
}
