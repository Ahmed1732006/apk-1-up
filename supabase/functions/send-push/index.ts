// Supabase Edge Function: send-push
// Sends real Android FCM notifications. Firebase Admin credentials remain server-side
// in the FCM_SERVICE_ACCOUNT secret and are never bundled into the Android app.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const FCM_PROJECT_ID = 'in-the-void-aebd7';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(new Uint8Array(signature))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function sendToToken(accessToken: string, token: string, payload: { title: string; body: string; url: string }) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: { url: payload.url },
        android: {
          priority: 'high',
          notification: { channel_id: 'in_the_void_notifications' },
        },
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function authorizeAdmin(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase server secrets are not configured.');
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Unauthorized');
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) throw new Error('Unauthorized');
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!['admin', 'super_admin'].includes(String(profile?.role || ''))) throw new Error('Forbidden');
  return admin;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = await authorizeAdmin(req);
    const serviceAccountRaw = Deno.env.get('FCM_SERVICE_ACCOUNT');
    if (!serviceAccountRaw) return json({ error: 'FCM_SERVICE_ACCOUNT secret not set' }, 500);
    const serviceAccount = JSON.parse(serviceAccountRaw);
    if (serviceAccount.project_id && serviceAccount.project_id !== FCM_PROJECT_ID) {
      return json({ error: `Firebase service account project mismatch: ${serviceAccount.project_id}` }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const title = String(body.title || 'IN THE VOID').slice(0, 120);
    const text = String(body.body || '').slice(0, 4000);
    const url = String(body.url || 'app/index.html?openNotifCenter=1');
    const targetType = String(body.target_type || 'all');
    const targetUserIds = Array.isArray(body.target_user_ids) ? body.target_user_ids.map(String).filter(Boolean) : [];
    const excludedUserIds = Array.isArray(body.excluded_user_ids) ? body.excluded_user_ids.map(String).filter(Boolean) : [];

    const accessToken = await getAccessToken(serviceAccount);
    const payload = { title, body: text, url };

    // Broadcasts use FCM topic delivery, which also works while the app is fully closed.
    if (targetType === 'all') {
      const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            topic: 'all_users',
            notification: { title, body: text },
            data: { url },
            android: { priority: 'high', notification: { channel_id: 'in_the_void_notifications' } },
          },
        }),
      });
      const fcmData = await fcmRes.json().catch(() => ({}));
      if (!fcmRes.ok) return json({ error: fcmData }, 502);
      return json({ ok: true, mode: 'topic', fcm: fcmData });
    }

    // Targeted delivery uses the token table. The service role bypasses RLS.
    let query = admin.from('device_push_tokens').select('user_id,token').eq('platform','android');
    if (targetType === 'selected') {
      if (!targetUserIds.length) return json({ ok: true, mode: 'tokens', sent: 0, total: 0 });
      query = query.in('user_id', targetUserIds);
    } else if (targetType === 'excluded') {
      // Supabase/PostgREST's not-in syntax lets us broadcast to everyone except the listed users.
      if (excludedUserIds.length) query = query.not('user_id', 'in', `(${excludedUserIds.join(',')})`);
    } else {
      query = query.in('user_id', targetUserIds);
    }
    const { data: rows, error: tokenError } = await query;
    if (tokenError) throw tokenError;

    const tokens = [...new Set((rows || []).map(r => String(r.token || '')).filter(Boolean))];
    let sent = 0;
    let failed = 0;
    const invalidTokens: string[] = [];
    for (let i = 0; i < tokens.length; i += 25) {
      const batch = tokens.slice(i, i + 25);
      const results = await Promise.all(batch.map(token => sendToToken(accessToken, token, payload)));
      results.forEach((r, idx) => {
        if (r.ok) sent++;
        else {
          failed++;
          const detail = JSON.stringify(r.data || {});
          if (/UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT/.test(detail)) invalidTokens.push(batch[idx]);
        }
      });
    }

    if (invalidTokens.length) {
      await admin.from('device_push_tokens').delete().in('token', invalidTokens);
    }
    return json({ ok: true, mode: 'tokens', sent, failed, total: tokens.length });
  } catch (err) {
    const message = String((err as any)?.message || err);
    const status = message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 500;
    return json({ error: message }, status);
  }
});
