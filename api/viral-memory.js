// api/viral-memory.js
// Learns from saved creator performance and scores current clips against that memory.

function performanceScore(item) {
  const views = Math.max(1, Number(item.views) || 0);
  const likes = Number(item.likes) || 0;
  const comments = Number(item.comments) || 0;
  const shares = Number(item.shares) || 0;
  return Math.round(((likes + comments * 3 + shares * 4) / views) * 10000) / 100;
}

function stripFence(text) {
  return String(text || '').replace(/```json|```/g, '').trim();
}

function parseJsonLoose(text) {
  const cleaned = stripFence(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw err;
    return JSON.parse(match[0]);
  }
}

function fallbackProfile(memory, clips) {
  const sorted = memory.slice().sort((a, b) => performanceScore(b) - performanceScore(a));
  const top = sorted.slice(0, 5);
  const topWords = top.flatMap(item => String(item.title || '').toLowerCase().split(/\W+/)).filter(w => w.length > 3);
  const wordSet = new Set(topWords);

  return {
    summary: top.length ? 'Your strongest saved clips share recognizable topic and hook patterns. Current clips were scored against those saved winners.' : 'Add past performance to improve future clip scoring.',
    audience_patterns: [
      top[0] ? `Best saved result: ${top[0].title} on ${top[0].platform || 'unknown'}` : 'No strong pattern yet',
      'Clips with clear hooks and comment-worthy angles should be prioritized',
      'Keep adding results after posting to make this memory sharper'
    ],
    recommendations: [
      'Apply Hook Lab to the highest memory-fit clip',
      'Export one high-energy and one educational variant for comparison',
      'Save performance after posting so ClipAI learns your audience'
    ],
    clip_scores: clips.map((clip, index) => {
      const text = `${clip.title || ''} ${clip.hook || ''} ${(clip.caption_lines || []).join(' ')}`.toLowerCase();
      const overlap = Array.from(wordSet).filter(word => text.includes(word)).length;
      const score = Math.max(45, Math.min(92, 55 + overlap * 8 + (clip.hook ? 8 : 0)));
      return {
        clip_index: Number(clip.index ?? index),
        score,
        reason: overlap ? 'Matches language from your stronger saved results.' : 'Usable baseline, but not strongly tied to saved winners yet.',
        suggested_hook: clip.hook || clip.title || ''
      };
    })
  };
}

function normalizeProfile(profile, memory, clips) {
  const fallback = fallbackProfile(memory, clips);
  const scores = Array.isArray(profile.clip_scores) && profile.clip_scores.length ? profile.clip_scores : fallback.clip_scores;
  return {
    summary: String(profile.summary || fallback.summary).slice(0, 300),
    audience_patterns: (Array.isArray(profile.audience_patterns) ? profile.audience_patterns : fallback.audience_patterns).slice(0, 5).map(x => String(x).slice(0, 180)),
    recommendations: (Array.isArray(profile.recommendations) ? profile.recommendations : fallback.recommendations).slice(0, 5).map(x => String(x).slice(0, 180)),
    clip_scores: scores.slice(0, clips.length).map((score, i) => ({
      clip_index: Math.max(0, Math.min(clips.length - 1, Number(score.clip_index ?? clips[i]?.index ?? i))),
      score: Math.max(0, Math.min(100, Number(score.score) || 50)),
      reason: String(score.reason || 'Scored against your saved audience memory.').slice(0, 180),
      suggested_hook: String(score.suggested_hook || '').slice(0, 110)
    }))
  };
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { memory = [], clips = [] } = req.body || {};
  if (!Array.isArray(memory) || !memory.length) return res.status(400).json({ error: 'Saved memory required' });
  if (!Array.isArray(clips) || !clips.length) return res.status(400).json({ error: 'Clips required' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'Groq API key not configured' });

  const memorySummary = memory.slice(-40).map(item => ({
    title: item.title,
    platform: item.platform,
    views: Number(item.views) || 0,
    likes: Number(item.likes) || 0,
    comments: Number(item.comments) || 0,
    shares: Number(item.shares) || 0,
    performance_score: performanceScore(item)
  }));

  const clipSummary = clips.slice(0, 8).map(clip => ({
    index: clip.index,
    title: clip.title,
    hook: clip.hook,
    why: clip.why,
    captions: clip.caption_lines,
    platforms: clip.platform_fit,
    energy: clip.energy,
    duration_s: clip.duration_s
  }));

  const prompt = `You are Viral Memory Engine for ClipAI.

You are given a creator's saved past clip performance and their current generated clips. Learn what this creator's audience responds to, then score current clips for audience fit.

Past performance memory:
${JSON.stringify(memorySummary)}

Current clips:
${JSON.stringify(clipSummary)}

Return JSON only:
{
  "summary": "one concise profile insight",
  "audience_patterns": ["pattern 1", "pattern 2", "pattern 3"],
  "recommendations": ["edit recommendation 1", "posting recommendation 2"],
  "clip_scores": [
    {
      "clip_index": 0,
      "score": 85,
      "reason": "why this clip matches the creator's memory",
      "suggested_hook": "optional stronger hook based on memory"
    }
  ]
}

Rules:
- Scores must be 0-100.
- Be specific to this creator's saved results, not generic.
- Prefer clips that resemble high-engagement saved examples.
- If data is thin, say that and give cautious recommendations.
- JSON only.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + GROQ_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1800,
        temperature: 0.35,
        messages: [
          { role: 'system', content: 'Return valid JSON only. You are a creator analytics strategist.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || data.error || 'Groq Viral Memory failed' });
    }

    let parsed;
    try {
      parsed = parseJsonLoose(data.choices?.[0]?.message?.content || '{}');
    } catch (err) {
      parsed = fallbackProfile(memory, clips);
    }

    return res.status(200).json(normalizeProfile(parsed, memory, clips));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default handler;
