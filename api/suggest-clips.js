async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { transcript, utterances, highlights, duration, customPrompt } = req.body;
  if (!transcript) return res.status(400).json({ error: 'Transcript required' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'Groq API key not configured' });

  // Send timestamps in SECONDS (not ms, not mm:ss) to avoid AI confusion
  const utteranceSummary = (utterances || []).slice(0, 60).map(u => {
    const startSec = Math.round((u.start || 0) / 1000);
    const endSec = Math.round((u.end || 0) / 1000);
    return `[${u.speaker || 'S'} ${startSec}s-${endSec}s]: ${u.text}`;
  }).join('\n');

  const totalDurationSec = Math.round(duration || 0);
  const highlightSummary = (highlights || []).slice(0, 8).map(h => {
    const ts = h.timestamps && h.timestamps[0];
    const sec = ts ? Math.round(ts.start / 1000) : 0;
    return '"' + h.text + '" at ' + sec + 's';
  }).join(', ');

  const userPromptExtra = customPrompt ? '\nAdditional user request: ' + customPrompt : '';

  const systemPrompt = 'You are ClipAI, a world-class short-form video strategist. You ALWAYS respond with valid JSON only — no markdown, no preamble.';

  const userPrompt = `Analyze this transcript and suggest the 5 best short clips (30-60 seconds each) for TikTok, Instagram Reels, and YouTube Shorts.

Video duration: ${totalDurationSec} seconds
Key highlights: ${highlightSummary}

Transcript (timestamps are in SECONDS from start of video):
${utteranceSummary}
${userPromptExtra}

IMPORTANT RULES:
- start_seconds and end_seconds must be actual seconds from the video (e.g. 45, 120, 300)
- end_seconds - start_seconds must be between 30 and 60
- Pick moments with strong emotional hooks, surprising facts, or funny moments

Return a JSON array of exactly 5 objects. Each must have:
- "title": catchy clip title (max 6 words)
- "hook": opening hook sentence (max 15 words)
- "start_seconds": start time in SECONDS (integer)
- "end_seconds": end time in SECONDS (integer)
- "speaker": speaker label (e.g. "A", "B")
- "duration_s": end_seconds minus start_seconds (30-60)
- "caption_lines": array of 3 short caption strings
- "why": one sentence why this will go viral
- "platform_fit": array like ["tiktok","reels","shorts"]
- "energy": "high" | "medium" | "calm"

Only return the JSON array. No other text.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + GROQ_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 2000,
        temperature: 0.5,
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

    // Convert seconds to milliseconds and validate duration
    clips = clips.map(c => {
      let startMs, endMs;

      // Handle both start_seconds and legacy start_ms
      if (c.start_seconds !== undefined) {
        startMs = Math.round(c.start_seconds * 1000);
        endMs = Math.round(c.end_seconds * 1000);
      } else {
        startMs = c.start_ms || 0;
        endMs = c.end_ms || 0;
        // If values look like seconds (under 10000), convert them
        if (startMs < 10000 && totalDurationSec > 60) {
          startMs = startMs * 1000;
          endMs = endMs * 1000;
        }
      }

      // Enforce minimum 30s and maximum 60s clip duration
      const durationMs = endMs - startMs;
      if (durationMs < 30000) endMs = startMs + 45000;
      if (durationMs > 60000) endMs = startMs + 60000;

      return {
        ...c,
        start_ms: startMs,
        end_ms: endMs,
        duration_s: Math.round((endMs - startMs) / 1000)
      };
    });

    return res.status(200).json({ clips });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default handler;