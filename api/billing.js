function setCors(req, res) {
  const allowed = new Set([
    'https://clipai-ten.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost',
    'https://localhost',
    'capacitor://localhost',
    'ionic://localhost',
    'null'
  ]);
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', allowed.has(origin) ? origin : 'https://clipai-ten.vercel.app');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-requested-with');
}

const TABLE = 'billing_profiles';
const FREE_EXPORTS_LIMIT = 3;

function jsonError(res, status, message, extra = {}) {
  return res.status(status).json({ error: message, ...extra });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch (err) {
    return { raw: text };
  }
}

function billingHeaders(key, extra = {}) {
  return {
    'content-type': 'application/json',
    apikey: key,
    Authorization: 'Bearer ' + key,
    ...extra
  };
}

async function getUser({ supabaseUrl, anonKey, token }) {
  const response = await fetch(supabaseUrl + '/auth/v1/user', {
    headers: {
      apikey: anonKey,
      Authorization: 'Bearer ' + token
    }
  });
  const data = await readJson(response);
  if (!response.ok || !data?.id) throw new Error('Session expired');
  return data;
}

function normalizeProfile(profile, userId) {
  const now = Date.now();
  const expiresAt = profile?.subscription_expires_at ? Date.parse(profile.subscription_expires_at) : 0;
  const subscriptionActive = Boolean(profile?.subscription_active) && (!expiresAt || expiresAt > now);
  const exportsUsed = Math.max(0, Number(profile?.exports_used || 0));
  const freeExportsLimit = Math.max(0, Number(profile?.free_exports_limit || FREE_EXPORTS_LIMIT));
  const exportsRemaining = subscriptionActive ? null : Math.max(0, freeExportsLimit - exportsUsed);

  return {
    userId,
    entitlement: profile?.entitlement || 'pro',
    isSubscribed: subscriptionActive,
    subscriptionActive,
    subscriptionExpiresAt: profile?.subscription_expires_at || null,
    exportsUsed,
    freeExportsLimit,
    exportsRemaining,
    canExport: subscriptionActive || exportsUsed < freeExportsLimit,
    requiresPayment: !subscriptionActive && exportsUsed >= freeExportsLimit,
    revenuecatAppUserId: profile?.revenuecat_app_user_id || userId
  };
}

async function fetchProfile({ supabaseUrl, serviceKey, userId }) {
  const response = await fetch(
    supabaseUrl + `/rest/v1/${TABLE}?user_id=eq.` + encodeURIComponent(userId) + '&select=*',
    { headers: billingHeaders(serviceKey) }
  );
  const data = await readJson(response);
  if (!response.ok) throw new Error('Billing profile unavailable');
  return Array.isArray(data) ? data[0] : null;
}

async function upsertProfile({ supabaseUrl, serviceKey, user }) {
  const existing = await fetchProfile({ supabaseUrl, serviceKey, userId: user.id });
  if (existing) return existing;

  const response = await fetch(supabaseUrl + `/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: billingHeaders(serviceKey, { Prefer: 'return=representation,resolution=merge-duplicates' }),
    body: JSON.stringify({
      user_id: user.id,
      email: user.email || '',
      exports_used: 0,
      free_exports_limit: FREE_EXPORTS_LIMIT,
      revenuecat_app_user_id: user.id,
      entitlement: 'pro',
      subscription_active: false,
      subscription_expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error('Billing profile could not be created');
  return Array.isArray(data) ? data[0] : data;
}

async function updateExportsUsed({ supabaseUrl, serviceKey, userId, nextCount }) {
  const response = await fetch(supabaseUrl + `/rest/v1/${TABLE}?user_id=eq.` + encodeURIComponent(userId), {
    method: 'PATCH',
    headers: billingHeaders(serviceKey, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      exports_used: nextCount,
      updated_at: new Date().toISOString()
    })
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error('Export usage could not be updated');
  return Array.isArray(data) ? data[0] : data;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return jsonError(res, 405, 'Method not allowed');

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonError(res, 500, 'Billing is not configured yet');
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonError(res, 401, 'Please sign in again');

  try {
    const user = await getUser({ supabaseUrl, anonKey, token });
    let profile = await upsertProfile({ supabaseUrl, serviceKey, user });
    let status = normalizeProfile(profile, user.id);

    if (req.method === 'GET') return res.status(200).json(status);

    const { action } = req.body || {};
    if (action === 'check_export') {
      return res.status(status.canExport ? 200 : 402).json(status);
    }

    if (action === 'record_export') {
      if (!status.canExport) return res.status(402).json(status);
      if (!status.isSubscribed) {
        profile = await updateExportsUsed({
          supabaseUrl,
          serviceKey,
          userId: user.id,
          nextCount: status.exportsUsed + 1
        });
        status = normalizeProfile(profile, user.id);
      }
      return res.status(200).json({ ...status, recorded: true });
    }

    return jsonError(res, 400, 'Unsupported billing action');
  } catch (err) {
    return jsonError(res, 500, 'Billing could not be checked');
  }
}
