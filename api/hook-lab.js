// api/hook-lab.js
// Generates alternate short-form openings for selected clips.

function stripFence(text) {
  return String(text || '').replace(/```json|```/g, '').trim();
}

function parseJsonLoose(text) {
  const cleaned = stripFence(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) throw err;
    return JSON.parse(match[0]);
  }
}

function fallbackVariants(clips) {
  const angles = ['curiosity gap', 'contrarian', 'pain point', 'story', 'comment magnet'];
  return (clips || []).slice(0, 3).flatMap(item => {
    const clip = item.clip || item;
    const idx = item.index ?? clip.index ?? 0;
    const base = clip.hook || clip.title || 'This moment changes everything';
    return angles.map(angle => ({
      clip_index: idx,
      angle,
      title: base.slice(0, 64),
      hook: angle === 'contrarian' ? 'Most people get this completely wrong.' :
        angle === 'pain point' ? 'If this keeps happening to you, watch this.' :
        angle === 'story' ? 'I did not expect this lesson to matter so much.' :
        angle === 'comment magnet' ? 'Would you agree with this take?' :
        'The part nobody talks about is this.',
      first_caption: angle === 'comment magnet' ? 'Agree or disagree?' : base.slice(0, 42),
      why: `Uses a ${angle} opening to make the clip feel more clickable.`,
      predicted_reaction: 'more retention',
      energy: angle === 'story' ? 'medium' : 'high'
    }));
  }).slice(0, 12);
}

function normalizeVariants(rawVariants, clips) {
  const maxClipIndex = Math.max(0, ...clips.map(c => Number(c.index) || 0));
  const variants = Array.isArray(rawVariants) ? rawVariants : rawVariants?.variants;
  const list = Array.isArray(variants) && variants.length ? variants : fallbackVariants(clips);

  return list.slice(0, 18).map((v, i) => {
    const clipIndex = Math.max(0, Math.min(maxClipIndex, Number(v.clip_index ?? v.clipIndex ?? clips[i % clips.length]?.index ?? 0)));
    const hook = String(v.hook || v.opening || v.title || 'This is the moment to watch.').trim().slice(0, 120);
    return {
      clip_index: clipIndex,
      angle: String(v.angle || v.type || 'curiosity gap').slice(0, 40),
      title: String(v.title || hook).slice(0, 80),
      hook,
      first_caption: String(v.first_caption || v.caption || hook).slice(0, 80),
      why: String(v.why || v.reason || 'This hook gives the clip a stronger opening.').slice(0, 220),
      predicted_reaction: String(v.predicted_reaction || v.reaction || 'higher retention').slice(0, 80),
      energy: ['high', 'medium', 'calm'].includes(v.energy) ? v.energy : 'high'
    };
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { clips = [], transcript = '', words = [] } = req.body || {};
  if (!Array.isArray(clips) || !clips.length) return res.status(400).json({ error: 'Clips required' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'Groq API key not configured' });

  const clipSummary = clips.slice(0, 5).map(item => {
    const captionText = (item.caption_lines || []).join(' ');
    return `Clip index ${item.index}
Title: ${item.title || ''}
Current hook: ${item.hook || ''}
Why: ${item.why || ''}
Time: ${Math.round((item.start_ms || 0) / 1000)}s-${Math.round((item.end_ms || 0) / 1000)}s
Captions: ${captionText}`;
  }).join('\n\n');

  const wordContext = (words || []).slice(0, 160).map(w => w.text).filter(Boolean).join(' ');

  const prompt = `You are Hook Lab, a short-form retention strategist.

Create multiple alternate opening hooks for each selected clip. These hooks should be used as first caption lines, clip titles, and first-frame overlays.

Selected clips:
${clipSummary}

Transcript context:
${wordContext || String(transcript || '').slice(0, 4500)}

Return JSON only:
{
  "variants": [
    {
      "clip_index": 0,
      "angle": "curiosity gap|contrarian|pain point|story|comment magnet|direct promise",
      "title": "short title, max 8 words",
      "hook": "first 1-2 seconds overlay, max 14 words",
      "first_caption": "caption line to put first",
      "why": "why this angle should improve performance",
      "predicted_reaction": "what viewers will feel/do",
      "energy": "high|medium|calm"
    }
  ]
}

Rules:
- Generate 4-5 variants per clip.
- Hooks must sound natural, not spammy.
- Do not invent facts that are not implied by the clip.
- Make each angle meaningfully different.
- JSON only.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + GROQ_KEY
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        max_tokens: 2200,
        temperature: 0.65,
        messages: [
          { role: 'system', content: 'Return valid JSON only. You are a world-class short-form hook strategist.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || data.error || 'Groq Hook Lab failed' });
    }

    let parsed;
    try {
      parsed = parseJsonLoose(data.choices?.[0]?.message?.content || '{}');
    } catch (err) {
      parsed = { variants: fallbackVariants(clips) };
    }

    return res.status(200).json({ variants: normalizeVariants(parsed, clips) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default handler;
