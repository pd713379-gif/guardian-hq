// ============================================================
// GUARDIANHQ — api/bungie-news.js
// Vercel Serverless Function — Bungie Nieuws via RSS
//
// Gebruikt: https://www.bungie.net/en/rss/News
// Parseert RSS/XML zonder url.parse() (geen DeprecationWarning)
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── RSS Feed ophalen ──────────────────────────────────────
  try {
    const rssUrl = 'https://www.bungie.net/en/rss/News';
    console.log('[bungie-news] RSS ophalen:', rssUrl);

    const rssRes = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'GuardianHQ/1.0',
        'Accept': 'application/rss+xml, text/xml, */*'
      }
    });

    if (!rssRes.ok) {
      throw new Error('RSS HTTP ' + rssRes.status);
    }

    const text = await rssRes.text();
    console.log('[bungie-news] RSS ontvangen, lengte:', text.length);

    // ── XML helper: haal tag-inhoud op (CDATA + gewone tekst) ──
    const getTag = (xml, tag) => {
      const r = xml.match(
        new RegExp(
          '<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>|' +
          '<' + tag + '[^>]*>([^<]*)<\\/' + tag + '>',
          'i'
        )
      );
      return r ? (r[1] || r[2] || '').trim() : '';
    };

    // ── Alle <item> blokken pakken ──────────────────────────
    const items = [];
    const matches = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    for (const m of matches) {
      const block = m[1];

      const title       = getTag(block, 'title');
      const pubDate     = getTag(block, 'pubDate');
      const description = getTag(block, 'description');
      const rawLink     = getTag(block, 'link');

      // Afbeelding: probeer media:content, dan enclosure
      const mediaMatch = block.match(/<media:content[^>]+url="([^"]+)"/i);
      const encMatch   = block.match(/<enclosure[^>]+url="([^"]+)"/i);
      const image      = (mediaMatch && mediaMatch[1]) || (encMatch && encMatch[1]) || '';

      // URL: zorg altijd voor volledige absolute URL
      let articleUrl = 'https://www.bungie.net/7/en/News';
      if (rawLink) {
        articleUrl = rawLink.startsWith('http')
          ? rawLink
          : 'https://www.bungie.net' + rawLink;
      }

      // Beschrijving opschonen (strip HTML tags)
      const cleanDesc = description.replace(/<[^>]+>/g, '').trim().slice(0, 200);

      items.push({
        Subject:      title,
        CreationDate: pubDate,
        Url:          articleUrl,
        Image:        image,
        Subtitle:     cleanDesc,
        Content: {
          properties: { Title: title }
        }
      });
    }

    console.log('[bungie-news] Artikelen gevonden:', items.length);

    if (items.length === 0) {
      throw new Error('Geen items in RSS feed');
    }

    // Cache 5 minuten op Vercel Edge, stale nog 60 sec acceptabel
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({
      results: items.slice(0, 10),
      source: 'bungie-rss'
    });

  } catch (err) {
    console.error('[bungie-news] RSS mislukt:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
