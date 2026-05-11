// api/caption-style.js
// Uses Groq (free) to generate caption style recommendations

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { clipText, words, stylePrompt, startMs } = req.body;

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'Groq API key not configured' });

  const clipWords = (words || []).filter(w => w.start >= startMs).slice(0, 30);

  const systemPrompt = `You are a caption designer for viral short-form video. You create word-level karaoke-style captions optimized for TikTok/Reels. Always respond with valid JSON only — no markdown, no preamble.`;

  const userPrompt = `Create caption config for this clip.

Clip text: "${clipText}"
Style request: "${stylePrompt || 'Bold, high contrast, modern viral style'}"
Word timestamps (ms): ${JSON.stringify(clipWords.slice(0, 20))}

Return JSON with:
- "style": { "fontFamily", "fontSize", "fontWeight", "color", "backgroundColor", "textShadow", "position", "animation" }
- "words": array of { "text", "start_ms", "end_ms", "emphasis": boolean } for first 20 words
- "preview_css": raw CSS string for the caption container
- "description": one line describing the style

JSON only, no markdown.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || data.error || 'Groq caption style failed' });
    }
    const text = data.choices?.[0]?.message?.content || '{}';

    let result;
    try {
      result = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      result = { error: 'Failed to parse caption config' };
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default handler;
