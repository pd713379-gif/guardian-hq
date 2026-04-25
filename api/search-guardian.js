// /api/search-guardian.js - Vercel serverless function
// Proxies Bungie's new search endpoint to avoid CORS issues

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing name parameter' });

  const API_KEY = process.env.BUNGIE_API_KEY || '9ad034ae0ea641e6886c7c33f3911093';

  try {
    // Split name and code
    const parts = name.includes('#') ? name.split('#') : [name, null];
    const displayName = parts[0];
    const displayNameCode = parts[1] ? parseInt(parts[1]) : null;

    let result = null;

    // Try new ExactSearch endpoint first (POST)
    if (displayNameCode) {
      try {
        const exactRes = await fetch('https://www.bungie.net/Platform/Destiny2/SearchDestinyPlayerByBungieName/-1/', {
          method: 'POST',
          headers: {
            'X-API-Key': API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ displayName, displayNameCode })
        });
        const exactData = await exactRes.json();
        if (exactData?.Response?.length) {
          result = exactData.Response[0];
        }
      } catch(e) {
        console.warn('ExactSearch failed:', e.message);
      }
    }

    // Fallback: search by name only
    if (!result) {
      const searchRes = await fetch(
        `https://www.bungie.net/Platform/Destiny2/SearchDestinyPlayer/-1/${encodeURIComponent(displayName)}/`,
        { headers: { 'X-API-Key': API_KEY } }
      );
      const searchData = await searchRes.json();
      if (searchData?.Response?.length) {
        // Pick best match on code if provided
        if (displayNameCode) {
          result = searchData.Response.find(m => m.bungieGlobalDisplayNameCode === displayNameCode)
                   || searchData.Response[0];
        } else {
          result = searchData.Response[0];
        }
      }
    }

    if (!result) {
      return res.status(404).json({ error: 'Guardian not found' });
    }

    return res.status(200).json({ ok: true, member: result });

  } catch(err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
