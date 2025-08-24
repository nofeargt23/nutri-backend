import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url, base64 } = req.body;

  if (!url && !base64) {
    return res.status(400).json({ error: "Send either 'url' or 'base64'" });
  }

  try {
    const response = await fetch(
      "https://api.clarifai.com/v2/models/food-item-recognition/outputs",
      {
        method: "POST",
        headers: {
          "Authorization": `Key ${process.env.CLARIFAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_app_id: {
            user_id: process.env.CLARIFAI_USER_ID,
            app_id: process.env.CLARIFAI_APP_ID,
          },
          inputs: [
            {
              data: {
                image: url ? { url } : { base64 },
              },
            },
          ],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data });
    }

    const concepts = data?.outputs?.[0]?.data?.concepts || [];
    res.status(200).json({ concepts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
