async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const headers = {
    'content-type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + token,
    'Prefer': 'return=representation'
  };

  async function getUserId() {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token }
    });
    const data = await r.json();
    if (!r.ok || !data.id) throw new Error('Session expired. Please sign in again.');
    return data.id;
  }

  try {
    if (req.method === 'GET') {
      const userId = await getUserId();
      const r = await fetch(SUPABASE_URL + '/rest/v1/projects?user_id=eq.' + encodeURIComponent(userId) + '&select=*&order=created_at.desc', { headers });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (req.method === 'POST') {
      const { title, transcript, clips, videoFilename, duration } = req.body;
      const userId = await getUserId();

      // Check for duplicate — same title + same user in last 10 minutes
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const dupCheck = await fetch(
        SUPABASE_URL + '/rest/v1/projects?user_id=eq.' + userId +
        '&title=eq.' + encodeURIComponent(title || 'Untitled Project') +
        '&created_at=gte.' + tenMinAgo +
        '&select=id',
        { headers }
      );
      const dupData = await dupCheck.json();
      if (Array.isArray(dupData) && dupData.length > 0) {
        return res.status(409).json({ error: 'duplicate', message: 'This project was already saved recently.' });
      }

      // Save project
      const r = await fetch(SUPABASE_URL + '/rest/v1/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: userId,
          title: title || 'Untitled Project',
          transcript: (transcript || '').substring(0, 8000),
          clips: clips || [],
          utterances: (req.body.utterances || []).slice(0, 50),
          highlights: (req.body.highlights || []).slice(0, 12),
          video_filename: videoFilename || '',
          duration: duration || 0,
          created_at: new Date().toISOString()
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      console.log('[ClipAI] Project saved for user:', userId);
      return res.status(200).json({ success: true, data });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const userId = await getUserId();
      const r = await fetch(
        SUPABASE_URL + '/rest/v1/projects?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(userId),
        { method: 'DELETE', headers }
      );
      if (!r.ok) throw new Error(await r.text());
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch(err) {
    console.error('[ClipAI] projects error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export default handler;
