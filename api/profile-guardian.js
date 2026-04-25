// api/profile-guardian.js — Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { membershipType, membershipId } = req.query;
  if (!membershipType || !membershipId) {
    return res.status(400).json({ error: 'Missing membershipType or membershipId' });
  }

  const API_KEY = process.env.BUNGIE_API_KEY || '9ad034ae0ea641e6886c7c33f3911093';

  try {
    const r = await fetch(
      `https://www.bungie.net/Platform/Destiny2/${membershipType}/Profile/${membershipId}/?components=100,200`,
      { headers: { 'X-API-Key': API_KEY } }
    );
    const data = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
