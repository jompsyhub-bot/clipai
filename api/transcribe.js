async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl is required' });

  const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY;
  if (!ASSEMBLYAI_KEY) return res.status(500).json({ error: 'AssemblyAI key not configured' });

  try {
    const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'authorization': ASSEMBLYAI_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        audio_url: videoUrl,
        speech_models: ['universal-2'],
        speaker_labels: true,
        auto_highlights: true,
        sentiment_analysis: true
      })
    });

    const data = await submitRes.json();
    if (!submitRes.ok) {
      return res.status(500).json({ error: data.error || 'AssemblyAI submission failed' });
    }

    return res.status(200).json({ transcriptId: data.id, status: data.status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default handler;