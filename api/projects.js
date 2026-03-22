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

  // Get user ID from token
  async function getUserId() {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token }
    });
    const data = await r.json();
    if (!r.ok || !data.id) throw new Error('Could not get user — token may be expired. Please sign in again.');
    return data.id;
  }

  try {
    if (req.method === 'GET') {
      const r = await fetch(SUPABASE_URL + '/rest/v1/projects?select=*&order=created_at.desc', { headers });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      return res.status(200).json(Array.isArray(data) ? data : []);
    }

    if (req.method === 'POST') {
      const { title, transcript, clips, videoFilename, duration } = req.body;
      const userId = await getUserId();
      console.log('[ClipAI] Saving project for user:', userId, 'title:', title);

      const r = await fetch(SUPABASE_URL + '/rest/v1/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: userId,
          title: title || 'Untitled Project',
          transcript: transcript || '',
          clips: clips || [],
          video_filename: videoFilename || '',
          duration: duration || 0,
          created_at: new Date().toISOString()
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(data));
      console.log('[ClipAI] Project saved:', data);
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      await fetch(SUPABASE_URL + '/rest/v1/projects?id=eq.' + id, { method: 'DELETE', headers });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch(err) {
    console.error('[ClipAI] projects error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export default handler;
