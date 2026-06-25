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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-requested-with,x-clipai-device-id');
}

const TABLE = 'billing_profiles';
const CLAIMS_TABLE = 'trial_claims';
const FREE_EXPORTS_LIMIT = Number(process.env.CLIPAI_FREE_EXPORTS_LIMIT || 3);

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

async function hashGuardValue(value, salt) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(salt + ':' + clean).digest('hex');
}

function getRequestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || '').trim();
}

function getTrialGuardInputs(req, body = {}) {
  const headerDeviceId = req.headers['x-clipai-device-id'];
  const bodyDeviceId = body.deviceId || body.deviceFingerprint;
  return {
    deviceId: String(headerDeviceId || bodyDeviceId || '').slice(0, 300),
    ip: getRequestIp(req).slice(0, 120)
  };
}

async function fetchTrialClaimByHash({ supabaseUrl, serviceKey, column, hash }) {
  if (!hash) return null;
  const response = await fetch(
    supabaseUrl + `/rest/v1/${CLAIMS_TABLE}?${column}=eq.` + encodeURIComponent(hash) + '&select=*',
    { headers: billingHeaders(serviceKey) }
  );
  const data = await readJson(response);
  if (!response.ok) {
    const detail = typeof data?.message === 'string' ? data.message : JSON.stringify(data || {});
    throw new Error('Trial guard unavailable: ' + detail);
  }
  return Array.isArray(data) ? data[0] : null;
}

async function insertTrialClaim({ supabaseUrl, serviceKey, user, deviceHash, ipHash, provider }) {
  if (!deviceHash && !ipHash) return;
  const response = await fetch(supabaseUrl + `/rest/v1/${CLAIMS_TABLE}`, {
    method: 'POST',
    headers: billingHeaders(serviceKey, { Prefer: 'return=minimal' }),
    body: JSON.stringify({
      user_id: user.id,
      email: user.email || '',
      provider: provider || 'unknown',
      device_hash: deviceHash || null,
      ip_hash: ipHash || null,
      created_at: new Date().toISOString()
    })
  });
  if (!response.ok && response.status !== 409) {
    const data = await readJson(response);
    const detail = typeof data?.message === 'string' ? data.message : JSON.stringify(data || {});
    throw new Error('Trial guard could not be saved: ' + detail);
  }
}

async function patchProfileGuard({ supabaseUrl, serviceKey, userId, trialGuard, trialBlocked = false }) {
  if (!trialGuard?.deviceHash && !trialGuard?.ipHash) return null;
  const response = await fetch(supabaseUrl + `/rest/v1/${TABLE}?user_id=eq.` + encodeURIComponent(userId), {
    method: 'PATCH',
    headers: billingHeaders(serviceKey, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      trial_blocked: trialBlocked,
      trial_block_reason: trialBlocked ? trialGuard.reason || 'trial_already_used' : null,
      trial_device_hash: trialGuard.deviceHash || null,
      trial_ip_hash: trialGuard.ipHash || null,
      updated_at: new Date().toISOString()
    })
  });
  const data = await readJson(response);
  if (!response.ok) return null;
  return Array.isArray(data) ? data[0] : data;
}

async function buildTrialGuard({ supabaseUrl, serviceKey, user, deviceId, ip, salt }) {
  const deviceHash = await hashGuardValue(deviceId, salt);
  const ipHash = await hashGuardValue(ip, salt);
  const deviceClaim = await fetchTrialClaimByHash({ supabaseUrl, serviceKey, column: 'device_hash', hash: deviceHash });
  const ipClaim = await fetchTrialClaimByHash({ supabaseUrl, serviceKey, column: 'ip_hash', hash: ipHash });
  const blockingClaim = [deviceClaim, ipClaim].find(claim => claim?.user_id && claim.user_id !== user.id);

  return {
    deviceHash,
    ipHash,
    blocked: Boolean(blockingClaim),
    reason: blockingClaim?.device_hash === deviceHash ? 'device_trial_already_used' : 'network_trial_already_used'
  };
}

function normalizeProfile(profile, userId) {
  const now = Date.now();
  const expiresAt = profile?.subscription_expires_at ? Date.parse(profile.subscription_expires_at) : 0;
  const subscriptionActive = Boolean(profile?.subscription_active) && (!expiresAt || expiresAt > now);
  const exportsUsed = Math.max(0, Number(profile?.exports_used || 0));
  const storedLimit = Number(profile?.free_exports_limit);
  const trialBlocked = Boolean(profile?.trial_blocked);
  const freeExportsLimit = trialBlocked
    ? 0
    : Math.max(0, Number.isFinite(storedLimit) ? Math.min(storedLimit, FREE_EXPORTS_LIMIT) : FREE_EXPORTS_LIMIT);
  const exportsRemaining = subscriptionActive ? null : Math.max(0, freeExportsLimit - exportsUsed);

  return {
    userId,
    entitlement: subscriptionActive ? (profile?.entitlement || 'pro') : (profile?.entitlement || 'free'),
    isSubscribed: subscriptionActive,
    subscriptionActive,
    subscriptionExpiresAt: profile?.subscription_expires_at || null,
    exportsUsed,
    freeExportsLimit,
    exportsRemaining,
    canExport: subscriptionActive || exportsUsed < freeExportsLimit,
    requiresPayment: !subscriptionActive && exportsUsed >= freeExportsLimit,
    trialBlocked,
    trialBlockReason: profile?.trial_block_reason || null,
    revenuecatAppUserId: profile?.revenuecat_app_user_id || userId
  };
}

async function fetchProfile({ supabaseUrl, serviceKey, userId }) {
  const response = await fetch(
    supabaseUrl + `/rest/v1/${TABLE}?user_id=eq.` + encodeURIComponent(userId) + '&select=*',
    { headers: billingHeaders(serviceKey) }
  );
  const data = await readJson(response);
  if (!response.ok) {
    const detail = typeof data?.message === 'string' ? data.message : JSON.stringify(data || {});
    throw new Error('Billing profile unavailable: ' + detail);
  }
  return Array.isArray(data) ? data[0] : null;
}

async function upsertProfile({ supabaseUrl, serviceKey, user, trialGuard }) {
  const existing = await fetchProfile({ supabaseUrl, serviceKey, userId: user.id });
  if (existing) {
    if (!existing.trial_device_hash && !existing.trial_ip_hash && !existing.trial_blocked) {
      await insertTrialClaim({
        supabaseUrl,
        serviceKey,
        user,
        deviceHash: trialGuard?.deviceHash || '',
        ipHash: trialGuard?.ipHash || '',
        provider: user.app_metadata?.provider || 'email'
      });
      const patched = await patchProfileGuard({ supabaseUrl, serviceKey, userId: user.id, trialGuard });
      return patched || existing;
    }
    return existing;
  }

  const trialBlocked = Boolean(trialGuard?.blocked);
  if (!trialBlocked) {
    await insertTrialClaim({
      supabaseUrl,
      serviceKey,
      user,
      deviceHash: trialGuard?.deviceHash || '',
      ipHash: trialGuard?.ipHash || '',
      provider: user.app_metadata?.provider || 'email'
    });
  }

  const response = await fetch(supabaseUrl + `/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: billingHeaders(serviceKey, { Prefer: 'return=representation,resolution=merge-duplicates' }),
    body: JSON.stringify({
      user_id: user.id,
      email: user.email || '',
      exports_used: 0,
      free_exports_limit: trialBlocked ? 0 : FREE_EXPORTS_LIMIT,
      revenuecat_app_user_id: user.id,
      entitlement: 'free',
      subscription_active: false,
      subscription_expires_at: null,
      trial_blocked: trialBlocked,
      trial_block_reason: trialBlocked ? trialGuard?.reason || 'trial_already_used' : null,
      trial_device_hash: trialGuard?.deviceHash || null,
      trial_ip_hash: trialGuard?.ipHash || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });
  const data = await readJson(response);
  if (!response.ok) {
    const detail = typeof data?.message === 'string' ? data.message : JSON.stringify(data || {});
    throw new Error('Billing profile could not be created: ' + detail);
  }
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
  if (!response.ok) {
    const detail = typeof data?.message === 'string' ? data.message : JSON.stringify(data || {});
    throw new Error('Export usage could not be updated: ' + detail);
  }
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
    const body = req.method === 'POST' ? req.body || {} : {};
    const guardInputs = getTrialGuardInputs(req, body);
    const guardSalt = process.env.TRIAL_GUARD_SECRET || serviceKey.slice(0, 32);
    const trialGuard = await buildTrialGuard({
      supabaseUrl,
      serviceKey,
      user,
      deviceId: guardInputs.deviceId,
      ip: guardInputs.ip,
      salt: guardSalt
    });
    let profile = await upsertProfile({ supabaseUrl, serviceKey, user, trialGuard });
    let status = normalizeProfile(profile, user.id);

    if (req.method === 'GET') return res.status(200).json(status);

    const { action } = body;
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
    console.error('[ClipAI] billing error:', err.message);
    if (/session expired|jwt|invalid token|not authenticated/i.test(err.message || '')) {
      return jsonError(res, 401, 'Please sign in again');
    }
    return jsonError(res, 500, 'Billing could not be checked');
  }
}
