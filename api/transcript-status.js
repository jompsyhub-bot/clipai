// api/transcript-status.js
// Poll AssemblyAI for transcript status and result

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Transcript ID required' });

  const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY;
  if (!ASSEMBLYAI_KEY) return res.status(500).json({ error: 'AssemblyAI key not configured' });

  try {
    const response = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { 'authorization': ASSEMBLYAI_KEY }
    });

    const data = await response.json();

    if (data.status === 'error') {
      return res.status(500).json({ error: data.error });
    }

    if (data.status !== 'completed') {
      return res.status(200).json({ status: data.status });
    }

    // Process speakers and utterances
    const utterances = (data.utterances || []).map(u => ({
      speaker: u.speaker,
      start: u.start,
      end: u.end,
      text: u.text,
      confidence: u.confidence
    }));

    // Get auto highlights (key moments)
    const highlights = (data.auto_highlights_result?.results || [])
      .filter(h => h.count > 1)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 12)
      .map(h => ({
        text: h.text,
        rank: h.rank,
        timestamps: h.timestamps
      }));

    // Sentiment peaks (most positive/negative = emotionally engaging)
    const sentiments = data.sentiment_analysis_results || [];
    const emotionalMoments = sentiments
      .filter(s => s.confidence > 0.8 && s.sentiment !== 'NEUTRAL')
      .slice(0, 20);

    return res.status(200).json({
      status: 'completed',
      text: data.text,
      duration: data.audio_duration,
      utterances,
      highlights,
      emotionalMoments,
      words: data.words || []
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default handler;
