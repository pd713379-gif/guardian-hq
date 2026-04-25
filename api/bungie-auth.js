// ============================================================
// GUARDIANHQ — api/bungie-auth.js
// Vercel Serverless Function — Bungie OAuth + API proxy
// ============================================================

export default async function handler(req, res) {
  // ── CORS & Headers ────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Configuratie ──────────────────────────────────────────
  const CLIENT_ID     = process.env.BUNGIE_CLIENT_ID;
  const CLIENT_SECRET = process.env.BUNGIE_CLIENT_SECRET;
  const API_KEY       = process.env.BUNGIE_API_KEY;

  if (!CLIENT_ID || !CLIENT_SECRET || !API_KEY) {
    return res.status(500).json({ error: 'Server niet geconfigureerd. Omgevingsvariabelen ontbreken.' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Ongeldige JSON in request body.' }); }
    }
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body ontbreekt of is ongeldig.' });
    }

    const { code, refresh_token, grant_type, action, endpoint, access_token, post_body } = body;

    // ── API PROXY ─────────────────────────────────────────────
    if (action === 'api') {
      if (!endpoint) return res.status(400).json({ error: 'Endpoint is verplicht voor api-actie.' });
      if (!access_token) return res.status(400).json({ error: 'access_token is verplicht voor api-actie.' });

      const url = 'https://www.bungie.net/Platform' + endpoint;
      const isPost = !!post_body;
      console.log('[bungie-auth] API proxy:', isPost ? 'POST' : 'GET', url);

      const apiRes = await fetch(url, {
        method:  isPost ? 'POST' : 'GET',
        headers: {
          'X-API-Key':     API_KEY,
          'Authorization': 'Bearer ' + access_token,
          ...(isPost ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(isPost ? { body: JSON.stringify(post_body) } : {}),
      });

      const ct = apiRes.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const text = await apiRes.text();
        console.error('[bungie-auth] Geen JSON terug. Status:', apiRes.status, text.slice(0, 300));
        return res.status(500).json({ error: 'Bungie API stuurde geen geldige JSON terug.' });
      }

      const data = await apiRes.json();
      if (!apiRes.ok) {
        console.error('[bungie-auth] Bungie API fout:', apiRes.status, data);
        return res.status(apiRes.status).json({ error: 'Bungie API fout.', detail: data });
      }
      return res.status(200).json(data);
    }

    // ── TOKEN EXCHANGE ────────────────────────────────────────
    let tokenBody;
    if (grant_type === 'refresh_token' && refresh_token) {
      tokenBody = new URLSearchParams({ grant_type: 'refresh_token', refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    } else if (code) {
      tokenBody = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    } else {
      return res.status(400).json({ error: 'Geen geldige actie, code of refresh_token meegestuurd.' });
    }

    const tokenRes  = await fetch('https://www.bungie.net/Platform/app/oauth/token/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody.toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) return res.status(tokenRes.status).json({ error: tokenData.error_description || 'Token exchange mislukt.' });

    return res.status(200).json({
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in:    tokenData.expires_in,
      membership_id: tokenData.membership_id,
    });

  } catch (err) {
    console.error('[bungie-auth] Onverwachte fout:', err);
    return res.status(500).json({ error: 'Onverwachte server fout: ' + err.message });
  }
}
