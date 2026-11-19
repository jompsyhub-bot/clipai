// api/ghost-edit.js
// Converts a plain-English editing brief into ready-to-export ClipAI clips.

const CAPTION_PRESETS = new Set([
  'tiktok-bold',
  'yellow-pop',
  'minimal-white',
  'karaoke',
  'neon',
  'subtitle'
]);

const PRESET_TO_STYLE = {
  'tiktok-bold': 'tiktok',
  'yellow-pop': 'mrbeast',
  'minimal-white': 'minimal',
  karaoke: 'karaoke',
  neon: 'neon',
  subtitle: 'subtitle'
};

function stripCodeFence(text) {
  return String(text || '').replace(/```json|```/g, '').trim();
}

function parseJsonLoose(text) {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw err;
    return JSON.parse(match[0]);
  }
}

function clamp(num, min, max) {
  return Math.min(max, Math.max(min, Number(num) || 0));
}

function normalizePreset(value, brief) {
  const raw = String(value || '').toLowerCase().trim();
  if (CAPTION_PRESETS.has(raw)) return raw;
  const b = String(brief || '').toLowerCase();
  if (b.includes('yellow') || b.includes('mrbeast')) return 'yellow-pop';
  if (b.includes('minimal') || b.includes('clean') || b.includes('white')) return 'minimal-white';
  if (b.includes('karaoke') || b.includes('word by word')) return 'karaoke';
  if (b.includes('neon') || b.includes('glow')) return 'neon';
  if (b.includes('subtitle')) return 'subtitle';
  return 'tiktok-bold';
}

function wordsAround(words, startMs, endMs, maxWords) {
  return (words || [])
    .filter(w => (w.start || 0) >= startMs && (w.start || 0) <= endMs)
    .slice(0, maxWords)
    .map(w => w.text)
    .filter(Boolean);
}

function fallbackPlan({ brief, utterances, highlights, words, duration }) {
  const durationSec = Number(duration) || 0;
  const requested = String(brief || '').match(/(\d+)\s*(sec|second|seconds|s)\b/i);
  const clipLen = clamp(requested ? Number(requested[1]) : 30, 20, 60);
  const source = (utterances || []).find(u => String(u.text || '').length > 80) || (utterances || [])[0] || {};
  let startMs = Math.max(0, Number(source.start) || 0);
  let endMs = startMs + clipLen * 1000;
  const maxMs = durationSec > 0 ? durationSec * 1000 : endMs;
  if (endMs > maxMs) {
    endMs = maxMs;
    startMs = Math.max(0, endMs - clipLen * 1000);
  }
  const preset = normalizePreset('', brief);
  const captionWords = wordsAround(words, startMs, endMs, 18);
  const text = captionWords.length ? captionWords.join(' ') : String(source.text || 'Ghost edit').slice(0, 140);

  return {
    mode: 'ghost',
    plan_summary: 'Fallback Ghost edit created from the strongest available transcript segment.',
    platform: /shorts/i.test(brief) ? 'shorts' : /reels|instagram/i.test(brief) ? 'reels' : 'tiktok',
    caption_preset: preset,
    caption_style: PRESET_TO_STYLE[preset],
    caption_settings: { size: preset === 'minimal-white' ? 92 : 108, position: 78, words: 3 },
    clips: [{
      title: 'Ghost Edit',
      hook: text.split(/[.!?]/)[0].slice(0, 90),
      start_ms: Math.round(startMs),
      end_ms: Math.round(endMs),
      duration_s: Math.round((endMs - startMs) / 1000),
      speaker: source.speaker || '?',
      caption_lines: [text.slice(0, 42), text.slice(42, 84), text.slice(84, 126)].filter(Boolean),
      why: 'This segment is clear, self-contained, and closest to the Ghost brief.',
      platform_fit: ['tiktok', 'reels', 'shorts'],
      energy: /calm|educational|minimal/i.test(brief) ? 'calm' : 'high'
    }]
  };
}

function normalizePlan(plan, context) {
  const totalMs = Math.max(0, (Number(context.duration) || 0) * 1000);
  const preset = normalizePreset(plan.caption_preset || plan.captionStyle, context.brief);
  const clipCount = clamp(Number(plan.clip_count || (plan.clips || []).length || 1), 1, 5);

  let clips = Array.isArray(plan.clips) ? plan.clips.slice(0, clipCount) : [];
  if (!clips.length) clips = fallbackPlan(context).clips;

  clips = clips.map((clip, i) => {
    let startMs = clip.start_ms;
    let endMs = clip.end_ms;
    if (startMs === undefined && clip.start_seconds !== undefined) startMs = Number(clip.start_seconds) * 1000;
    if (endMs === undefined && clip.end_seconds !== undefined) endMs = Number(clip.end_seconds) * 1000;
    startMs = Math.max(0, Math.round(Number(startMs) || 0));

    const requestedDur = Number(clip.duration_s || plan.duration_seconds || 30);
    const targetMs = clamp(requestedDur, 20, 60) * 1000;
    endMs = Math.round(Number(endMs) || (startMs + targetMs));
    if (endMs <= startMs) endMs = startMs + targetMs;
    if ((endMs - startMs) < 15000) endMs = startMs + targetMs;
    if ((endMs - startMs) > 65000) endMs = startMs + 60000;
    if (totalMs && endMs > totalMs) {
      endMs = totalMs;
      startMs = Math.max(0, endMs - targetMs);
    }

    const captionLines = Array.isArray(clip.caption_lines) && clip.caption_lines.length
      ? clip.caption_lines.slice(0, 5).map(line => String(line).slice(0, 70))
      : wordsAround(context.words, startMs, endMs, 18).join(' ').match(/.{1,42}(\s|$)/g) || [clip.title || 'Ghost edit'];

    return {
      title: String(clip.title || `Ghost Edit ${i + 1}`).slice(0, 80),
      hook: String(clip.hook || clip.title || '').slice(0, 120),
      start_ms: startMs,
      end_ms: endMs,
      duration_s: Math.round((endMs - startMs) / 1000),
      speaker: String(clip.speaker || '?').slice(0, 12),
      caption_lines: captionLines.map(line => String(line).trim()).filter(Boolean).slice(0, 5),
      why: String(clip.why || 'Selected by Ghost Editor from your brief.').slice(0, 240),
      platform_fit: Array.isArray(clip.platform_fit) && clip.platform_fit.length ? clip.platform_fit.slice(0, 4) : ['tiktok', 'reels', 'shorts'],
      energy: ['high', 'medium', 'calm'].includes(clip.energy) ? clip.energy : 'high'
    };
  });

  return {
    mode: 'ghost',
    brief: context.brief,
    plan_summary: String(plan.plan_summary || plan.summary || 'Ghost Editor created a ready-to-export edit from your brief.').slice(0, 300),
    platform: String(plan.platform || 'tiktok').toLowerCase(),
    caption_preset: preset,
    caption_style: PRESET_TO_STYLE[preset],
    caption_settings: {
      size: clamp(plan.caption_settings?.size || (preset === 'yellow-pop' ? 112 : 100), 80, 125),
      position: clamp(plan.caption_settings?.position || 78, 62, 88),
      words: clamp(plan.caption_settings?.words || 3, 2, 4)
    },
    clips
  };
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { brief, transcript, utterances = [], highlights = [], words = [], duration = 0 } = req.body || {};
  if (!brief) return res.status(400).json({ error: 'Ghost brief required' });
  if (!transcript && !utterances.length) return res.status(400).json({ error: 'Transcript required' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'Groq API key not configured' });

  const utteranceSummary = (utterances || []).slice(0, 90).map(u => {
    const startSec = Math.round((u.start || 0) / 1000);
    const endSec = Math.round((u.end || 0) / 1000);
    return `[${u.speaker || 'S'} ${startSec}s-${endSec}s]: ${String(u.text || '').slice(0, 260)}`;
  }).join('\n');

  const highlightSummary = (highlights || []).slice(0, 12).map(h => {
    const ts = h.timestamps && h.timestamps[0];
    const sec = ts ? Math.round(ts.start / 1000) : Math.round((h.start_ms || 0) / 1000);
    return `"${String(h.text || '').slice(0, 140)}" at ${sec}s`;
  }).join('\n');

  const systemPrompt = 'You are Ghost Editor, a world-class short-form video editor. Convert natural language editing briefs into precise JSON edit plans. Return valid JSON only.';
  const userPrompt = `User brief:
"${brief}"

Video duration: ${Math.round(Number(duration) || 0)} seconds

Highlights:
${highlightSummary || 'None'}

Transcript with timestamps in seconds:
${utteranceSummary || String(transcript).slice(0, 9000)}

Interpret instructions like "funniest", "controversial", "emotional", "educational", "start with the punchline", "best quote", platform, clip count, duration, and caption style.

Return one JSON object:
{
  "plan_summary": "short explanation",
  "clip_count": 1,
  "duration_seconds": 30,
  "platform": "tiktok|reels|shorts|linkedin",
  "caption_preset": "tiktok-bold|yellow-pop|minimal-white|karaoke|neon|subtitle",
  "caption_settings": { "size": 100, "position": 78, "words": 3 },
  "clips": [
    {
      "title": "max 8 words",
      "hook": "opening hook",
      "start_seconds": 0,
      "end_seconds": 30,
      "speaker": "A",
      "caption_lines": ["short", "caption", "lines"],
      "why": "why this matches the brief",
      "platform_fit": ["tiktok", "reels", "shorts"],
      "energy": "high|medium|calm"
    }
  ]
}

Rules:
- start_seconds and end_seconds must be real video timestamps.
- Honor requested duration when possible, 20-60 seconds per clip.
- If asked to start with the punchline, begin at the strongest payoff line, not the earlier setup.
- Pick self-contained moments that make sense without the full video.
- JSON only.`;

  const context = { brief, transcript, utterances, highlights, words, duration };

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + GROQ_KEY
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        max_tokens: 2400,
        temperature: 0.35,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || data.error || 'Groq Ghost Editor failed' });
    }

    const raw = data.choices?.[0]?.message?.content || '{}';
    let plan;
    try {
      plan = parseJsonLoose(raw);
    } catch (err) {
      plan = fallbackPlan(context);
    }

    return res.status(200).json(normalizePlan(plan, context));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default handler;
