// api/auth.js — handles signup, login, logout via Supabase
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const { action, email, password } = req.body;

  const endpoints = {
    signup: '/auth/v1/signup',
    login: '/auth/v1/token?grant_type=password',
    logout: '/auth/v1/logout'
  };

  const endpoint = endpoints[action];
  if (!endpoint) return res.status(400).json({ error: 'Invalid action' });

  try {
    const r = await fetch(SUPABASE_URL + endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY
      },
      body: JSON.stringify({ email, password })
    });

    const data = await r.json();
    if (!r.ok) return res.status(400).json({ error: data.error_description || data.msg || 'Auth failed' });

    return res.status(200).json({
      user: data.user,
      token: data.access_token,
      message: action === 'signup' ? 'Account created! Check your email to confirm.' : 'Logged in!'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export default handler;
