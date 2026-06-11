function cleanLink(link) {
  return String(link || '').trim();
}

function isYoutubeLink(link) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)\//i.test(link);
}

function sourceIndex(source, index) {
  const value = Number(source?.index);
  return Number.isFinite(value) ? value : index;
}

function sourceLabel(source, index) {
  return source?.title || source?.originalUrl || source?.source || `Source ${index + 1}`;
}

function msToClock(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function toMs(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

function sourceExcerpt(source) {
  const transcript = String(source?.transcript || '').replace(/\s+/g, ' ').trim();
  if (transcript) return transcript.slice(0, 1800);
  const utterances = Array.isArray(source?.utterances) ? source.utterances : [];
  return utterances.slice(0, 18).map(u => String(u.text || '').trim()).filter(Boolean).join(' ').slice(0, 1800);
}

function normalizeUtterance(utterance) {
  const text = String(utterance?.text || '').replace(/\s+/g, ' ').trim();
  const start = toMs(utterance?.start ?? utterance?.start_ms ?? utterance?.startMs, -1);
  const end = toMs(utterance?.end ?? utterance?.end_ms ?? utterance?.endMs, -1);
  if (!text || start < 0 || end <= start + 500) return null;
  return { text, start_ms: start, end_ms: end };
}

function sourceMoments(source, index) {
  const utterances = Array.isArray(source?.utterances) ? source.utterances : [];
  const moments = utterances.map(normalizeUtterance).filter(Boolean);
  if (moments.length) {
    return moments
      .filter(moment => moment.text.length >= 24)
      .slice(0, 45)
      .map(moment => ({
        source_index: sourceIndex(source, index),
        source: sourceLabel(source, index),
        start_ms: moment.start_ms,
        end_ms: moment.end_ms,
        text: moment.text.slice(0, 260)
      }));
  }

  const words = Array.isArray(source?.words) ? source.words : [];
  const normalizedWords = words.map(word => {
    const text = String(word?.text || '').trim();
    const start = toMs(word?.start, -1);
    const end = toMs(word?.end, -1);
    return text && start >= 0 && end > start ? { text, start_ms: start, end_ms: end } : null;
  }).filter(Boolean);

  const chunks = [];
  for (let i = 0; i < normalizedWords.length; i += 55) {
    const chunk = normalizedWords.slice(i, i + 55);
    if (chunk.length < 8) continue;
    chunks.push({
      source_index: sourceIndex(source, index),
      source: sourceLabel(source, index),
      start_ms: chunk[0].start_ms,
      end_ms: chunk[chunk.length - 1].end_ms,
      text: chunk.map(word => word.text).join(' ').slice(0, 260)
    });
    if (chunks.length >= 24) break;
  }
  return chunks;
}

function timelineForPrompt(source, index) {
  const moments = sourceMoments(source, index);
  if (!moments.length) {
    return `Source ${sourceIndex(source, index)}: ${sourceLabel(source, index)}
Duration: ${source.duration || 'unknown'} seconds
Transcript excerpt: ${sourceExcerpt(source) || 'Transcript not available.'}`;
  }

  return `Source ${sourceIndex(source, index)}: ${sourceLabel(source, index)}
Duration: ${source.duration || 'unknown'} seconds
Timestamped transcript moments:
${moments.slice(0, 34).map(moment =>
  `- ${msToClock(moment.start_ms)}-${msToClock(moment.end_ms)} | ${moment.text}`
).join('\n')}`;
}

function fallbackSegmentsFromSources({ links, sources, targetMinutes, brief, style }) {
  const sourceList = Array.isArray(sources) && sources.length ? sources : links.map((link, index) => ({ originalUrl: link, index }));
  const targetSeconds = Math.max(300, Math.min(2700, Number(targetMinutes || 30) * 60));
  const maxSegments = Math.max(sourceList.length, Math.min(18, sourceList.length * 3));
  const perSegment = Math.max(35, Math.min(150, Math.round(targetSeconds / maxSegments)));
  const styleLabel = String(style || 'funniest').replace(/-/g, ' ');
  const segments = [];

  sourceList.forEach((source, index) => {
    const moments = sourceMoments(source, index);
    const chosen = moments.length
      ? moments.filter((_, momentIndex) => momentIndex % Math.max(1, Math.floor(moments.length / 3)) === 0).slice(0, 3)
      : [];

    if (!chosen.length) {
      segments.push({
        source: sourceLabel(source, index),
        source_index: sourceIndex(source, index),
        title: `Best moment from source ${index + 1}`,
        start_ms: 0,
        end_ms: Math.round(perSegment * 1000),
        target_seconds: perSegment,
        direction: `Find the strongest ${styleLabel} section. ${brief || 'Keep the pacing watchable.'}`,
        reason: 'Fallback segment because transcript timestamps were limited.',
        transition: 'Clean cut',
        energy: 'medium'
      });
      return;
    }

    chosen.forEach((moment, momentIndex) => {
      const durationMs = Math.max(20000, Math.min(perSegment * 1000, moment.end_ms - moment.start_ms + 25000));
      segments.push({
        source: sourceLabel(source, index),
        source_index: moment.source_index,
        title: momentIndex === 0 ? `Hook from source ${index + 1}` : `Strong moment from source ${index + 1}`,
        start_ms: moment.start_ms,
        end_ms: moment.start_ms + durationMs,
        target_seconds: Math.round(durationMs / 1000),
        direction: moment.text,
        reason: `Transcript-backed ${styleLabel} moment selected by Ghost Editor fallback.`,
        transition: momentIndex === 0 ? 'Cold open' : 'Clean cut',
        energy: momentIndex === 0 ? 'high' : 'medium'
      });
    });
  });

  return segments.slice(0, 18);
}

function fallbackPlan(context) {
  const styleLabel = String(context.style || 'funniest').replace(/-/g, ' ');
  const segments = fallbackSegmentsFromSources(context);
  const hasTimedSegments = segments.some(segment => Number.isFinite(Number(segment.start_ms)) && Number(segment.end_ms) > Number(segment.start_ms));
  return {
    mode: 'compilation',
    status: hasTimedSegments ? 'ghost_plan_ready' : 'planned',
    title: `${styleLabel.charAt(0).toUpperCase() + styleLabel.slice(1)} Compilation`,
    summary: context.sources?.length
      ? `Ghost Editor analyzed ${context.sources.length} transcribed sources and prepared a renderable ${styleLabel} timeline.`
      : `ClipAI prepared a ${styleLabel} compilation blueprint from ${context.links.length} YouTube sources.`,
    style: context.style || 'funniest',
    target_minutes: Number(context.targetMinutes) || 30,
    source_count: (context.sources?.length || context.links.length),
    renderer_ready: hasTimedSegments,
    sources_ready: Array.isArray(context.sources) && context.sources.length > 0,
    next_step: hasTimedSegments
      ? 'Build the final MP4 by cutting these timestamped segments and joining them with FFmpeg.'
      : 'Transcribe sources first, then Ghost Editor can create exact timestamps.',
    editor_notes: context.brief || 'Use the strongest self-contained moments.',
    segments
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

function normalizeSegment(segment, index, context, fallbackSegment) {
  const sourceList = context.sources.length ? context.sources : context.links.map((link, i) => ({ originalUrl: link, index: i }));
  let srcIndex = Number(segment?.source_index ?? segment?.sourceIndex ?? fallbackSegment?.source_index ?? index);
  if (!Number.isFinite(srcIndex)) srcIndex = index;
  const source = sourceList.find((item, i) => sourceIndex(item, i) === srcIndex) || sourceList[index % Math.max(sourceList.length, 1)];
  const repairedSourceIndex = source ? sourceIndex(source, sourceList.indexOf(source)) : 0;

  let startMs = segment?.start_ms ?? segment?.startMs;
  let endMs = segment?.end_ms ?? segment?.endMs;
  if (startMs === undefined && segment?.start_seconds !== undefined) startMs = Number(segment.start_seconds) * 1000;
  if (endMs === undefined && segment?.end_seconds !== undefined) endMs = Number(segment.end_seconds) * 1000;

  startMs = toMs(startMs, toMs(fallbackSegment?.start_ms, 0));
  endMs = toMs(endMs, toMs(fallbackSegment?.end_ms, startMs + 90000));

  const targetSeconds = Math.max(20, Math.min(240, Number(segment?.target_seconds ?? segment?.duration_seconds ?? fallbackSegment?.target_seconds ?? 90) || 90));
  if (!endMs || endMs <= startMs + 1000) endMs = startMs + targetSeconds * 1000;

  const sourceDurationMs = Number(source?.duration || 0) * 1000;
  if (sourceDurationMs > 0) {
    startMs = Math.min(startMs, Math.max(0, sourceDurationMs - 1000));
    endMs = Math.min(endMs, sourceDurationMs);
    if (endMs <= startMs + 1000) {
      startMs = Math.max(0, endMs - Math.min(targetSeconds * 1000, sourceDurationMs));
    }
  }

  const durationMs = Math.max(5000, endMs - startMs);
  return {
    source: sourceLabel(source, sourceList.indexOf(source)),
    source_index: repairedSourceIndex,
    title: String(segment?.title || fallbackSegment?.title || `Segment ${index + 1}`).slice(0, 90),
    start_ms: Math.round(startMs),
    end_ms: Math.round(startMs + durationMs),
    target_seconds: Math.round(durationMs / 1000),
    direction: String(segment?.direction || fallbackSegment?.direction || '').slice(0, 500),
    reason: String(segment?.reason || fallbackSegment?.reason || 'Selected from transcript timing.').slice(0, 300),
    transition: String(segment?.transition || fallbackSegment?.transition || 'Clean cut').slice(0, 80),
    energy: String(segment?.energy || fallbackSegment?.energy || 'medium').slice(0, 30)
  };
}

function normalizeGhostPlan(plan, context) {
  const fallback = fallbackPlan(context);
  const rawSegments = Array.isArray(plan?.segments) && plan.segments.length ? plan.segments : fallback.segments;
  const segments = rawSegments.slice(0, 18).map((segment, index) =>
    normalizeSegment(segment, index, context, fallback.segments[index % Math.max(fallback.segments.length, 1)])
  ).filter(segment => segment.end_ms > segment.start_ms);

  const rendererReady = context.sources.length > 0 && segments.length > 0;
  return {
    ...fallback,
    ...plan,
    mode: 'compilation',
    status: rendererReady ? 'ghost_plan_ready' : 'planned',
    renderer_ready: rendererReady,
    sources_ready: context.sources.length > 0,
    source_count: context.links.length,
    target_minutes: context.targetMinutes,
    next_step: rendererReady
      ? 'Build the final MP4 by cutting these timestamped segments and joining them with FFmpeg.'
      : fallback.next_step,
    segments
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const links = Array.isArray(body.links)
    ? body.links.map(cleanLink).filter(Boolean).filter((link, index, arr) => arr.indexOf(link) === index)
    : [];
  const sources = Array.isArray(body.sources)
    ? body.sources.map((source, index) => ({
        index: sourceIndex(source, index),
        originalUrl: cleanLink(source.originalUrl || source.source || links[index] || ''),
        transcript: String(source.transcript || '').slice(0, 16000),
        utterances: Array.isArray(source.utterances) ? source.utterances.slice(0, 120) : [],
        words: Array.isArray(source.words) ? source.words.slice(0, 1400) : [],
        duration: Number(source.duration) || 0
      })).filter(source => source.originalUrl || source.transcript || source.utterances.length)
    : [];
  const invalid = links.filter(link => !isYoutubeLink(link));
  if (links.length < 2) return res.status(400).json({ error: 'Paste at least two YouTube links.' });
  if (links.length > 8) return res.status(400).json({ error: 'Use 2 to 8 links for this first Compilation Studio version.' });
  if (invalid.length) return res.status(400).json({ error: 'Only YouTube links are supported for Compilation Studio right now.' });

  const context = {
    links,
    sources,
    style: body.style || 'funniest',
    targetMinutes: Math.max(5, Math.min(45, Number(body.targetMinutes) || 30)),
    brief: String(body.brief || '').slice(0, 700)
  };

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(200).json(fallbackPlan(context));

  try {
    const sourceTimelines = (context.sources.length ? context.sources : context.links.map((link, index) => ({ originalUrl: link, index })))
      .map(timelineForPrompt)
      .join('\n\n');

    const prompt = `You are Ghost Editor, a professional long-form compilation editor. Build a renderable edit timeline from transcript timestamps.

Inputs:
- Target length: ${context.targetMinutes} minutes
- Style: ${context.style}
- User instruction: ${context.brief || 'Use the strongest moments and make the pacing watchable.'}
- Source links:
${context.links.map((link, i) => `${i}. ${link}`).join('\n')}

Available timestamped transcript material:
${sourceTimelines}

Return JSON only:
{
  "mode": "compilation",
  "status": "ghost_plan_ready",
  "title": "short title",
  "summary": "what the final compilation will feel like",
  "style": "${context.style}",
  "target_minutes": ${context.targetMinutes},
  "source_count": ${context.links.length},
  "renderer_ready": true,
  "editor_notes": "pacing and structure notes",
  "segments": [
    {
      "source_index": 0,
      "source": "matching source label or URL",
      "title": "segment title",
      "start_ms": 12000,
      "end_ms": 76000,
      "target_seconds": 64,
      "direction": "what this moment contributes",
      "reason": "why this belongs in the compilation",
      "transition": "cold open, clean cut, J-cut, title card, etc",
      "energy": "high"
    }
  ]
}

Rules:
- Use only the source_index values shown above.
- Use real transcript timestamps from the available material. Do not invent timestamps outside the listed source duration.
- Prefer 45-180 second self-contained sections. Use shorter 20-45 second sections only for hooks, payoffs, or transitions.
- Create 6-18 segments, ordered like a real video: hook, build, strongest middle, payoff/end.
- Do not include any text outside JSON.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + GROQ_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.25,
        max_tokens: 2800,
        messages: [
          { role: 'system', content: 'You are Ghost Editor for ClipAI. Return valid JSON only, with renderable timestamped segments.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(200).json(fallbackPlan(context));
    const plan = parseJson(data.choices?.[0]?.message?.content || '{}');
    return res.status(200).json(normalizeGhostPlan(plan, context));
  } catch (err) {
    return res.status(200).json(fallbackPlan(context));
  }
}
