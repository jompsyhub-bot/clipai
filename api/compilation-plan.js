function cleanLink(link) {
  return String(link || '').trim();
}

function isYoutubeLink(link) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)\//i.test(link);
}

function fallbackPlan({ links, style, targetMinutes, brief }) {
  const perSource = Math.max(45, Math.round((Number(targetMinutes) || 30) * 60 / Math.max(links.length, 1)));
  const styleLabel = String(style || 'funniest').replace(/-/g, ' ');
  return {
    mode: 'compilation',
    status: 'planned',
    title: `${styleLabel.charAt(0).toUpperCase() + styleLabel.slice(1)} Compilation`,
    summary: `ClipAI will build a ${targetMinutes || 30}-minute ${styleLabel} compilation from ${links.length} YouTube sources. The renderer will download, transcribe, pick the strongest moments, then stitch the final MP4.`,
    style: style || 'funniest',
    target_minutes: Number(targetMinutes) || 30,
    source_count: links.length,
    renderer_ready: false,
    next_step: 'Connect downloader rendering endpoint for download, transcription, segment cutting, and FFmpeg concat.',
    segments: links.map((link, index) => ({
      source: link,
      title: `Source ${index + 1}`,
      target_seconds: perSource,
      direction: `Find the strongest ${styleLabel} moment from this source. ${brief || 'Keep only the most watchable section.'}`
    }))
  };
}

function stripFence(text) {
  return String(text || '').replace(/```json|```/g, '').trim();
}

function parseJson(text) {
  const cleaned = stripFence(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw err;
    return JSON.parse(match[0]);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const links = Array.isArray(body.links)
    ? body.links.map(cleanLink).filter(Boolean).filter((link, index, arr) => arr.indexOf(link) === index)
    : [];
  const invalid = links.filter(link => !isYoutubeLink(link));
  if (links.length < 2) return res.status(400).json({ error: 'Paste at least two YouTube links.' });
  if (links.length > 8) return res.status(400).json({ error: 'Use 2 to 8 links for this first Compilation Studio version.' });
  if (invalid.length) return res.status(400).json({ error: 'Only YouTube links are supported for Compilation Studio right now.' });

  const context = {
    links,
    style: body.style || 'funniest',
    targetMinutes: Math.max(5, Math.min(45, Number(body.targetMinutes) || 30)),
    brief: String(body.brief || '').slice(0, 500)
  };

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(200).json(fallbackPlan(context));

  try {
    const prompt = `Create a JSON-only edit blueprint for a long-form YouTube compilation.

Inputs:
- Target length: ${context.targetMinutes} minutes
- Style: ${context.style}
- User instruction: ${context.brief || 'Use the strongest moments and make the pacing watchable.'}
- Links:
${context.links.map((link, i) => `${i + 1}. ${link}`).join('\n')}

Return this JSON shape:
{
  "mode": "compilation",
  "status": "planned",
  "title": "short title",
  "summary": "what the compilation will become",
  "style": "style",
  "target_minutes": 30,
  "source_count": 3,
  "renderer_ready": false,
  "next_step": "download/transcribe/cut/concat",
  "segments": [
    {
      "source": "original link",
      "title": "segment role",
      "target_seconds": 120,
      "direction": "what Ghost Editor should look for in this source"
    }
  ]
}

Rules:
- Include one segment direction per link.
- Allocate enough seconds to reach the target length.
- Do not invent timestamps yet because transcripts are not available.
- JSON only.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + GROQ_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.35,
        max_tokens: 1800,
        messages: [
          { role: 'system', content: 'You are ClipAI Compilation Studio. Return valid JSON only.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(200).json(fallbackPlan(context));
    const plan = parseJson(data.choices?.[0]?.message?.content || '{}');
    return res.status(200).json({
      ...fallbackPlan(context),
      ...plan,
      mode: 'compilation',
      status: 'planned',
      renderer_ready: false,
      source_count: context.links.length,
      target_minutes: context.targetMinutes
    });
  } catch (err) {
    return res.status(200).json(fallbackPlan(context));
  }
}
