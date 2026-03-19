// api/suggest-clips.js
// Uses Groq (free, no credit card needed) to suggest the best short clips

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { transcript, utterances, highlights, duration, customPrompt } = req.body;
  if (!transcript) return res.status(400).json({ error: 'Transcript required' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'Groq API key not configured' });

  const utteranceSummary = (utterances || []).slice(0, 60).map(u => {
    const start = formatTime(u.start / 1000);
    const end = formatTime(u.end / 1000);
    return `[${u.speaker || 'S'} ${start}-${end}]: ${u.text}`;
  }).join('\n');

  const highlightSummary = (highlights || []).slice(0, 8).map(h =>
    `"${h.text}" (rank: ${(h.rank * 100).toFixed(0)}%)`
  ).join(', ');

  const userPromptExtra = customPrompt ? `\nAdditional user request: ${customPrompt}` : '';

  const systemPrompt = `You are ClipAI, a world-class short-form video strategist. You analyze long-form video transcripts and identify the highest-performing clips for TikTok, Instagram Reels, and YouTube Shorts. You ALWAYS respond with valid JSON only — no markdown, no preamble, no explanation.`;

  const userPrompt = `Analyze this transcript and suggest the 5 best short clips (15-60 seconds each) that would perform well on short-form video platforms.

Video duration: ${formatTime(duration || 0)}
Auto-detected highlights: ${highlightSummary}

Transcript (speaker-labeled):
${utteranceSummary}
${userPromptExtra}

Return a JSON array of exactly 5 clip objects. Each object must have:
- "title": catchy clip title (max 6 words)
- "hook": opening hook sentence (max 15 words)
- "start_ms": start time in milliseconds
- "end_ms": end time in milliseconds
- "speaker": speaker label (e.g. "A", "B")
- "duration_s": duration in seconds (15-60)
- "caption_lines": array of 3 short caption strings for the clip
- "why": one sentence explaining why this will go viral
- "platform_fit": array of platforms ["tiktok","reels","shorts"]
- "energy": "high" | "medium" | "calm"

Only return the JSON array. No other text.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 2000,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '[]';

    let clips;
    try {
      clips = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      clips = [];
    }

    return res.status(200).json({ clips });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
