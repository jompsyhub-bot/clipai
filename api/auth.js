// api/auth.js — handles signup, login, logout, and Google OAuth via Supabase.
// Also enforces one-free-account-per-device using a device fingerprint
// sent from the browser (see login.html).
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // needed for fingerprint table writes

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const { action, email, password, deviceFingerprint, provider, supabaseAccessToken } = req.body;

  // ─── Helper: look up the fingerprint row ────────────────────────────────
  async function findFingerprint(fingerprint) {
    if (!SUPABASE_SERVICE_KEY || !fingerprint) return null;
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/device_fingerprints?fingerprint=eq.${encodeURIComponent(fingerprint)}&select=*`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY
        }
      }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return rows[0] || null;
  }

  // ─── Helper: record a fingerprint against a new user ────────────────────
  async function recordFingerprint(fingerprint, userId, userEmail, providerName) {
    if (!SUPABASE_SERVICE_KEY || !fingerprint) return;
    await fetch(`${SUPABASE_URL}/rest/v1/device_fingerprints`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        fingerprint,
        user_id: userId,
        email: userEmail,
        provider: providerName || 'email'
      })
    });
  }

  // ─── SIGNUP (email/password) ─────────────────────────────────────────────
  if (action === 'signup') {
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    if (deviceFingerprint) {
      const existing = await findFingerprint(deviceFingerprint);
      if (existing) {
        return res.status(409).json({
          error: 'An account already exists on this device. Please sign in instead, or contact support if you believe this is a mistake.'
        });
      }
    }

    try {
      const r = await fetch(SUPABASE_URL + '/auth/v1/signup', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: data.error_description || data.msg || 'Auth failed' });

      // Record the fingerprint now that the account exists.
      if (deviceFingerprint && data.user?.id) {
        await recordFingerprint(deviceFingerprint, data.user.id, email, 'email');
      }

      return res.status(200).json({
        user: data.user,
        token: data.access_token,
        message: 'Account created! Check your email to confirm.'
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── LOGIN (email/password) ──────────────────────────────────────────────
  if (action === 'login') {
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
      const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: data.error_description || data.msg || 'Auth failed' });
      return res.status(200).json({ user: data.user, token: data.access_token, message: 'Logged in!' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── OAUTH (Google, via Supabase session handoff) ────────────────────────
  // The browser already completed the Google OAuth flow with Supabase directly
  // and has a Supabase access token. We verify that token here, then apply
  // the same one-account-per-device check before issuing a ClipAI session.
  if (action === 'oauth') {
    if (!supabaseAccessToken) return res.status(400).json({ error: 'Missing Supabase access token' });

    try {
      // Verify the token and get the authenticated user from Supabase.
      const userRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + supabaseAccessToken
        }
      });
      const user = await userRes.json();
      if (!userRes.ok || !user?.id) {
        return res.status(401).json({ error: 'Could not verify Google sign-in' });
      }

      const userEmail = user.email || email;

      if (deviceFingerprint) {
        const existing = await findFingerprint(deviceFingerprint);
        // Block only if the device is already linked to a DIFFERENT account.
        if (existing && existing.user_id !== user.id) {
          return res.status(409).json({
            error: 'An account already exists on this device. Please sign in with that account instead.'
          });
        }
        if (!existing) {
          await recordFingerprint(deviceFingerprint, user.id, userEmail, provider || 'google');
        }
      }

      return res.status(200).json({
        user,
        token: supabaseAccessToken,
        message: 'Logged in with Google!'
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── LOGOUT ───────────────────────────────────────────────────────────────
  if (action === 'logout') {
    try {
      await fetch(SUPABASE_URL + '/auth/v1/logout', {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + SUPABASE_ANON_KEY
        }
      });
      return res.status(200).json({ message: 'Logged out' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
}

export default handler;
