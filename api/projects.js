// api/projects.js — save and load user projects via Supabase
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

  if (req.method === 'GET') {
    // Get user's projects
    const r = await fetch(SUPABASE_URL + '/rest/v1/projects?select=*&order=created_at.desc', { headers });
    const data = await r.json();
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    // Save a new project
    const { title, transcript, clips, videoFilename, duration } = req.body;
    const r = await fetch(SUPABASE_URL + '/rest/v1/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title, transcript, clips, video_filename: videoFilename, duration, created_at: new Date().toISOString() })
    });
    const data = await r.json();
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    await fetch(SUPABASE_URL + '/rest/v1/projects?id=eq.' + id, { method: 'DELETE', headers });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default handler;
