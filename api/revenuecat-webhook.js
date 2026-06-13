const TABLE = 'billing_profiles';

function jsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch (err) {
    return { raw: text };
  }
}

function supabaseHeaders(serviceKey, extra = {}) {
  return {
    'content-type': 'application/json',
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey,
    ...extra
  };
}

function findUserId(event) {
  const candidates = [
    event?.app_user_id,
    event?.original_app_user_id,
    ...(Array.isArray(event?.aliases) ? event.aliases : [])
  ].filter(Boolean);

  return candidates.find(value =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value))
  ) || null;
}

function normalizeRevenueCatEvent(body) {
  return body?.event || body || {};
}

function isProEvent(event) {
  const entitlements = Array.isArray(event.entitlement_ids) ? event.entitlement_ids : [];
  return entitlements.includes('pro') || event.entitlement_id === 'pro';
}

function eventExpiration(event) {
  const expirationMs = Number(event.expiration_at_ms || event.expiration_at || 0);
  if (Number.isFinite(expirationMs) && expirationMs > 0) {
    return new Date(expirationMs).toISOString();
  }
  return null;
}

function subscriptionActiveFromEvent(event) {
  const type = String(event.type || '').toUpperCase();
  if (type === 'TEST') return false;
  if (type === 'EXPIRATION') return false;
  const expiresAt = eventExpiration(event);
  if (expiresAt) return isProEvent(event) && Date.parse(expiresAt) > Date.now();
  return isProEvent(event) && !['CANCELLATION', 'BILLING_ISSUE'].includes(type);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');

  const webhookAuth = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (webhookAuth) {
    const received = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (received !== webhookAuth) return jsonError(res, 401, 'Unauthorized webhook');
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return jsonError(res, 500, 'Supabase service role is not configured');
  }

  const event = normalizeRevenueCatEvent(req.body || {});
  if (String(event.type || '').toUpperCase() === 'TEST') {
    return res.status(200).json({ received: true, test: true });
  }

  const userId = findUserId(event);
  if (!userId) return jsonError(res, 400, 'RevenueCat app_user_id must be the Supabase user id');

  const active = subscriptionActiveFromEvent(event);
  const expiresAt = eventExpiration(event);
  const payload = {
    user_id: userId,
    revenuecat_app_user_id: event.app_user_id || userId,
    entitlement: active ? 'pro' : 'free',
    subscription_active: active,
    subscription_expires_at: expiresAt,
    last_revenuecat_event_id: event.id || event.event_timestamp_ms || null,
    updated_at: new Date().toISOString()
  };

  const response = await fetch(supabaseUrl + `/rest/v1/${TABLE}?on_conflict=user_id`, {
    method: 'POST',
    headers: supabaseHeaders(serviceKey, { Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(payload)
  });
  const data = await readJson(response);
  if (!response.ok) {
    console.error('[ClipAI] RevenueCat webhook Supabase error:', data);
    return jsonError(res, 500, 'Could not update billing profile');
  }

  return res.status(200).json({ received: true, subscriptionActive: active });
}
