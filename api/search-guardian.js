// api/search-guardian.js — Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing name' });

  const API_KEY = process.env.BUNGIE_API_KEY || '9ad034ae0ea641e6886c7c33f3911093';

  const displayName = name.includes('#') ? name.split('#')[0] : name;
  const displayNameCode = name.includes('#') ? parseInt(name.split('#')[1]) : null;

  try {
    // Use GlobalName search — works server-side without CORS issues
    const r = await fetch('https://www.bungie.net/Platform/User/Search/GlobalName/0/', {
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayNamePrefix: displayName })
    });
    const data = await r.json();
    const results = data?.Response?.searchResults ?? [];

    if (!results.length) return res.status(404).json({ error: 'Guardian not found' });

    // Find best match
    let match = results.find(u =>
      u.bungieGlobalDisplayName?.toLowerCase() === displayName.toLowerCase() &&
      (!displayNameCode || u.bungieGlobalDisplayNameCode === displayNameCode)
    ) || results.find(u =>
      u.bungieGlobalDisplayName?.toLowerCase() === displayName.toLowerCase()
    ) || results[0];

    if (!match?.destinyMemberships?.length) {
      return res.status(404).json({ error: 'No Destiny profile found' });
    }

    // Pick primary membership (prefer crossSaveOverride)
    let membership = match.destinyMemberships[0];
    for (const m of match.destinyMemberships) {
      if (m.crossSaveOverride === m.membershipType) { membership = m; break; }
    }

    return res.status(200).json({
      ok: true,
      member: {
        membershipType: membership.membershipType,
        membershipId:   membership.membershipId,
        bungieGlobalDisplayName: match.bungieGlobalDisplayName,
        bungieGlobalDisplayNameCode: match.bungieGlobalDisplayNameCode,
      }
    });

  } catch(err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
