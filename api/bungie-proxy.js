// ============================================================
// GUARDIANHQ — api/bungie-proxy.js  (v3 — geen manifest timeout)
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const API_KEY = process.env.BUNGIE_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'BUNGIE_API_KEY ontbreekt.' });

  const { action } = req.query;

  // ── Helper ─────────────────────────────────────────────────
  async function bFetch(url, token) {
    const h = { 'X-API-Key': API_KEY };
    if (token) h['Authorization'] = 'Bearer ' + token;
    const r = await fetch('https://www.bungie.net/Platform' + url, { headers: h });
    const d = await r.json();
    if (!r.ok || (d.ErrorCode && d.ErrorCode !== 1)) throw new Error(d.Message || 'Bungie ' + r.status);
    return d.Response;
  }

  // ── AVATAR — dynamisch via OAuth token of via naam zoeken ──
  if (action === 'avatar') {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();

    // Als OAuth token beschikbaar → gebruik dat (voor ingelogde gebruiker)
    if (token) {
      try {
        const user = await bFetch('/User/GetMembershipsForCurrentUser/', token);
        const mems = user?.destinyMemberships ?? [];
        let primary = mems[0];
        for (const m of mems) { if (m.crossSaveOverride === m.membershipType) { primary = m; break; } }
        if (primary) {
          const profile = await bFetch(`/Destiny2/${primary.membershipType}/Profile/${primary.membershipId}/?components=100`, token);
          const iconPath = profile?.profile?.data?.userInfo?.iconPath;
          const bungieUser = user?.bungieNetUser;
          const displayName = bungieUser
            ? (bungieUser.cachedBungieGlobalDisplayName || bungieUser.uniqueName || bungieUser.displayName) + (bungieUser.cachedBungieGlobalDisplayNameCode ? '#' + String(bungieUser.cachedBungieGlobalDisplayNameCode).padStart(4,'0') : '')
            : null;
          return res.status(200).json({
            avatarUrl:   iconPath ? 'https://www.bungie.net' + iconPath : null,
            displayName: displayName,
          });
        }
      } catch {}
      return res.status(200).json({ avatarUrl: null });
    }

    // Geen token → zoek op naam (publieke fallback, alleen als ?name= meegegeven)
    const searchName = req.query.name;
    if (searchName) {
      try {
        const sd = await fetch('https://www.bungie.net/Platform/User/Search/GlobalName/0/', {
          method: 'POST', headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayNamePrefix: searchName })
        }).then(r => r.json());
        const match = (sd?.Response?.searchResults ?? []).find(u => u.bungieGlobalDisplayName?.toLowerCase() === searchName.toLowerCase()) ?? sd?.Response?.searchResults?.[0];
        if (match?.destinyMemberships?.[0]) {
          const dm = match.destinyMemberships[0];
          const pd = await fetch(`https://www.bungie.net/Platform/Destiny2/${dm.membershipType}/Profile/${dm.membershipId}/?components=100`, { headers: { 'X-API-Key': API_KEY } }).then(r => r.json());
          const icon = pd?.Response?.profile?.data?.userInfo?.iconPath;
          if (icon) return res.status(200).json({
            avatarUrl: 'https://www.bungie.net' + icon,
            displayName: match.bungieGlobalDisplayName + '#' + String(match.bungieGlobalDisplayNameCode ?? '').padStart(4,'0'),
            membershipType: dm.membershipType,
            membershipId: dm.membershipId,
          });
        }
      } catch {}
    }
    return res.status(200).json({ avatarUrl: null });
  }

  // ── WEAPON ICONS (wishlist) ─────────────────────────────────
  if (action === 'weaponicons') {
    const HASHES = { palindrome:1912364120, igneous:2314610827, retrofit:3103325054, gjallarhorn:1363886209, fallingGuillotine:1815105249, messenger:3259167006, likelySuspect:1994645182 };
    const icons = {};
    await Promise.allSettled(Object.entries(HASHES).map(async ([k, h]) => {
      try {
        const r = await fetch(`https://www.bungie.net/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${h}/`, { headers: { 'X-API-Key': API_KEY } });
        const d = await r.json();
        icons[k] = d?.Response?.displayProperties?.icon ? 'https://www.bungie.net' + d.Response.displayProperties.icon : null;
      } catch { icons[k] = null; }
    }));
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).json(icons);
  }

  // ── CHARACTER GEAR ─────────────────────────────────────────
  if (action === 'charactergear') {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Token vereist' });

    try {
      // 1. Memberships
      const user = await bFetch('/User/GetMembershipsForCurrentUser/', token);
      const mems = user?.destinyMemberships ?? [];
      let primary = mems[0];
      for (const m of mems) { if (m.crossSaveOverride === m.membershipType) { primary = m; break; } }
      if (!primary) return res.status(404).json({ error: 'Geen Destiny membership' });

      const mType = primary.membershipType;
      const mId   = primary.membershipId;

      // 2. Profile: chars (200) + renders (204) + equipment (205) + instances (300) + sockets (302) + char stats (304) + plugs (309)
      const profile = await bFetch(`/Destiny2/${mType}/Profile/${mId}/?components=200,204,205,300,302,304,305,309`, token);

      const charsData      = profile?.characters?.data ?? {};
      const renderData     = profile?.characterRenderData?.data ?? {};
      const equipData      = profile?.characterEquipment?.data ?? {};
      const instanceData = profile?.itemComponents?.instances?.data ?? {};
      const plugsData    = profile?.itemComponents?.reusablePlugs?.data ?? {};
      const socketsData  = profile?.itemComponents?.sockets?.data ?? {};
      // Component 305 geeft per item alle socket states inclusief plugHash
      const plugStatesData = profile?.itemComponents?.plugStates?.data ?? {};
      // Component 304 = item-level stats (armor stats per item), accessed via itemComponents.stats
      const statsData    = profile?.itemComponents?.stats?.data ?? {};
      // Component 202 = character-level total stats (for character sheet)
      const charStatsData = profile?.characterStats?.data ?? {};

      // DEBUG: log wat Bungie teruggeeft voor stats (zie Vercel logs)
      console.log('[stats-debug] profile keys:', Object.keys(profile ?? {}));
      console.log('[stats-debug] characterStats aanwezig:', !!profile?.characterStats);
      console.log('[stats-debug] statsData keys:', Object.keys(statsData));
      const _firstChar = Object.keys(statsData)[0];
      if (_firstChar) {
        console.log('[stats-debug] rawStats sample:', JSON.stringify(statsData[_firstChar]?.stats ?? {}).slice(0, 400));
      }

      // 3. Verzamel relevante hashes
      const RELEVANT_BUCKETS = new Set([
        3284755031,                                                      // subclass
        1498876634, 2465295065, 953998645,                               // weapons
        3448274439, 3551918588, 14239492, 20886954, 1585787867,          // armor
        4023194814,                                                      // ghost shell
        284967655,                                                       // ship
        2025709351,                                                      // sparrow
      ]);
      const allHashes = new Set();
      const allPlugHashes = new Set();

      for (const charEquip of Object.values(equipData)) {
        for (const item of (charEquip.items ?? [])) {
          if (RELEVANT_BUCKETS.has(item.bucketHash)) {
            allHashes.add(item.itemHash);
            // Verzamel plug hashes voor mods via reusablePlugs (309)
            const plugs = plugsData[item.itemInstanceId]?.plugs ?? {};
            for (const plugArr of Object.values(plugs)) {
              for (const plug of plugArr) {
                if (plug.plugItemHash) allPlugHashes.add(plug.plugItemHash);
              }
            }
            // Verzamel socket plug hashes (302) — uitgeruste plugs
            const sockets = socketsData[item.itemInstanceId]?.sockets ?? [];
            for (const socket of sockets) {
              if (socket.plugHash) allPlugHashes.add(socket.plugHash);
              // Ook reusable plugs uit socket meenemen
              for (const rp of (socket.reusablePlugs ?? [])) {
                if (rp.plugItemHash) allPlugHashes.add(rp.plugItemHash);
              }
            }
            // Component 305 plug states
            for (const [plugHash] of Object.entries(plugStatesData)) {
              const h = parseInt(plugHash);
              if (h) allPlugHashes.add(h);
            }
          }
        }
      }

      // 4. Manifest ophalen — alle items + plugs tegelijk
      const defs = {};
      const allToFetch = [...new Set([...allHashes, ...allPlugHashes])];
      await Promise.allSettled(allToFetch.map(async hash => {
        try {
          const ctrl = new AbortController();
          const tid  = setTimeout(() => ctrl.abort(), 5000);
          const r = await fetch(
            `https://www.bungie.net/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`,
            { headers: { 'X-API-Key': API_KEY }, signal: ctrl.signal }
          );
          clearTimeout(tid);
          const d = await r.json();
          if (d?.Response) defs[hash] = d.Response;
        } catch {}
      }));

      // 5. Lookup tabellen
      const CLASS_NAMES   = { 0:'Titan', 1:'Hunter', 2:'Warlock' };
      const ELEMENT_MAP   = {
        2328211300:'arc',  3006627468:'arc',  1751782730:'arc',  2958378809:'arc',
        2240888816:'solar',3941205951:'solar',2550323932:'solar',
        2453351420:'void', 3887892656:'void', 2842471112:'void',
        873720784:'stasis',3291545503:'stasis',2842471113:'stasis',
        2932390016:'strand',613647897:'strand',242419885:'strand',
        3855807587:'prismatic',1216399026:'prismatic',3452049687:'prismatic',
        4282591831:'prismatic',3168997075:'arc',
      };
      const SUBCLASS_NAMES = {
        2328211300:'Arc Strider',  3006627468:'Stormcaller',       1751782730:'Striker',      2958378809:'Arc Striker',
        2240888816:'Gunslinger',   3941205951:'Dawnblade',          2550323932:'Sunbreaker',
        2453351420:'Nightstalker', 3887892656:'Voidwalker',         2842471112:'Sentinel',
        873720784:'Revenant',      3291645503:'Shadebinder',        2842471113:'Behemoth',
        2932390016:'Threadrunner', 613647897:'Broodweaver',         242419885:'Berserker',
        3855807587:'Prismatic',    1216399026:'Prismatic',          3452049687:'Prismatic',
        4282591831:'Prismatic',    3168997075:'Stormcaller',
      };
      const WEAPON_BUCKETS  = new Set([1498876634, 2465295065, 953998645]);
      const ARMOR_BUCKETS   = new Set([3448274439, 3551918588, 14239492, 20886954, 1585787867]);
      const SUBCLASS_BUCKET = 3284755031;
      const GHOST_BUCKET    = 4023194814;
      const SHIP_BUCKET     = 284967655;
      const SPARROW_BUCKET  = 2025709351;
      const SLOT_NAMES = {
        1498876634:'Kinetisch', 2465295065:'Energie', 953998645:'Zwaar',
        3448274439:'Helm', 3551918588:'Gauntlets', 14239492:'Borst', 20886954:'Benen', 1585787867:'Class Item',
        4023194814:'Ghost Shell', 284967655:'Ship', 2025709351:'Sparrow',
      };

      // Mod slot bucket hashes die we willen tonen (armor mods, niet intrinsics/perks)
      // Echte armor mods: plugCategoryIdentifier begint met 'enhancements.'
      // maar NIET cosmetics zoals shaders/ornaments (die hebben 'shader','ornaments','ghost_projections')
      const COSMETIC_PLUG_SKIP = ['shader','ornament','ghost_projection','transmat','emote','finisher'];
      function isRealArmorMod(plugDef) {
        const plugId = (plugDef.plug?.plugCategoryIdentifier ?? '').toLowerCase();
        if (!plugId.startsWith('enhancements.')) return false;
        // Skip cosmetische enhancements
        if (COSMETIC_PLUG_SKIP.some(s => plugId.includes(s))) return false;
        return true;
      }

      // Helper: haal armor mods EN cosmetics op per socket slot
      // Geeft { mods: [...], cosmetics: [...] }
      // mods = enhancements.* (geen cosmetics) — alle slots, geen maximum
      // cosmetics = shaders + ornaments
      function getArmorMods(itemInstanceId) {
        const mods = [];
        const cosmetics = [];
        const sockets = socketsData[itemInstanceId]?.sockets ?? [];

        for (const socket of sockets) {
          const hash = socket.plugHash;
          if (!hash) continue;
          const plugDef = defs[hash];
          if (!plugDef) continue;

          const plugId = (plugDef.plug?.plugCategoryIdentifier ?? '').toLowerCase();
          const name   = plugDef.displayProperties?.name ?? '';
          const icon   = plugDef.displayProperties?.icon ?? '';

          // COSMETICS: shaders, ornaments, universal ornaments (armor_skins)
          const isCosmeticPlug = plugId.includes('shader') || plugId.includes('ornament')
            || plugId.includes('transmat') || plugId.includes('armor_skins')
            || plugId.includes('armor_plug_one') || plugId === 'v400.plugs.armor.masterworks.trackers';
          if (isCosmeticPlug) {
            if (name && icon && !name.startsWith('Default') && !name.startsWith('Empty') && !name.startsWith('Deprecated')) {
              cosmetics.push({ name, icon: 'https://www.bungie.net' + icon, hash });
            } else {
              cosmetics.push(null);
            }
            continue;
          }

          // MODS: alle enhancements.* sockets (geen cosmetics)
          if (!plugId.startsWith('enhancements.')) continue;

          if (!name || name.startsWith('Empty') || name.startsWith('Default') || name.startsWith('Deprecated') || !icon) {
            mods.push(null); // lege mod slot
          } else {
            mods.push({ name, icon: 'https://www.bungie.net' + icon, hash });
          }
        }

        // Fallback via reusablePlugs als sockets leeg zijn
        if (mods.filter(Boolean).length === 0 && cosmetics.filter(Boolean).length === 0) {
          const plugs = plugsData[itemInstanceId]?.plugs ?? {};
          for (const plugArr of Object.values(plugs)) {
            const plug = plugArr?.[0];
            if (!plug?.plugItemHash) continue;
            const plugDef = defs[plug.plugItemHash];
            if (!plugDef) continue;
            const plugId = (plugDef.plug?.plugCategoryIdentifier ?? '').toLowerCase();
            const name   = plugDef.displayProperties?.name ?? '';
            const icon   = plugDef.displayProperties?.icon ?? '';
            const isCosmeticFallback = plugId.includes('shader') || plugId.includes('ornament')
              || plugId.includes('transmat') || plugId.includes('armor_skins') || plugId.includes('armor_plug_one');
            if (isCosmeticFallback) {
              if (name && icon && !name.startsWith('Default') && !name.startsWith('Empty'))
                cosmetics.push({ name, icon: 'https://www.bungie.net' + icon, hash: plug.plugItemHash });
              continue;
            }
            if (!plugId.startsWith('enhancements.')) continue;
            if (!name || name.startsWith('Empty') || name.startsWith('Default') || !icon) {
              mods.push(null);
            } else {
              mods.push({ name, icon: 'https://www.bungie.net' + icon, hash: plug.plugItemHash });
            }
          }
        }

        console.log('[mods]', itemInstanceId, '=> mods:', mods.length, 'cosmetics:', cosmetics.length);
        return { mods, cosmetics };
      }

      // Helper: haal weapon perks op via sockets (302) — betrouwbaarder dan plugsData
      function getWeaponPerks(itemInstanceId, itemHash) {
        const perks = [];
        const seen  = new Set();
        const SKIP_PLUGIDS = ['frames','magazines','barrels','scopes','batteries','guards','grips','stocks','tubes','intrinsic','enhancements','shader','ornament'];

        // Primair: sockets (302) — uitgeruste plugs in volgorde
        const sockets = socketsData[itemInstanceId]?.sockets ?? [];
        for (const socket of sockets) {
          const hash = socket.plugHash;
          if (!hash || seen.has(hash)) continue;
          seen.add(hash);
          const plugDef = defs[hash];
          if (!plugDef) continue;
          const name   = plugDef.displayProperties?.name ?? '';
          const icon   = plugDef.displayProperties?.icon ?? '';
          const desc   = plugDef.displayProperties?.description ?? '';
          const plugId = (plugDef.plug?.plugCategoryIdentifier ?? '').toLowerCase();
          if (!name || !icon) continue;
          if (name.startsWith('Empty') || name.startsWith('Default') || name.startsWith('Deprecated')) continue;
          // Skip frames/barrels/magazines/etc — die zijn geen perks
          if (SKIP_PLUGIDS.some(s => plugId.includes(s))) continue;
          perks.push({ name, icon: 'https://www.bungie.net' + icon, desc });
          if (perks.length >= 4) break;
        }

        // Fallback: reusablePlugs (309)
        if (perks.length === 0) {
          const plugs = plugsData[itemInstanceId]?.plugs ?? {};
          for (const [, plugArr] of Object.entries(plugs)) {
            for (const plug of (plugArr ?? [])) {
              const hash = plug.plugItemHash;
              if (!hash || seen.has(hash)) continue;
              seen.add(hash);
              const plugDef = defs[hash];
              if (!plugDef) continue;
              const name   = plugDef.displayProperties?.name ?? '';
              const icon   = plugDef.displayProperties?.icon ?? '';
              const desc   = plugDef.displayProperties?.description ?? '';
              const plugId = (plugDef.plug?.plugCategoryIdentifier ?? '').toLowerCase();
              if (!name || !icon) continue;
              if (name.startsWith('Empty') || name.startsWith('Default') || name.startsWith('Deprecated')) continue;
              if (SKIP_PLUGIDS.some(s => plugId.includes(s))) continue;
              const cats = plugDef.itemCategoryHashes ?? [];
              if (cats.includes(2237006975) || cats.includes(610365472)) {
                perks.push({ name, icon: 'https://www.bungie.net' + icon, desc });
                if (perks.length >= 4) break;
              }
            }
            if (perks.length >= 4) break;
          }
        }
        return perks;
      }

      // Helper: haal weapon stats op uit manifest definitie
      function getWeaponStats(itemHash) {
        const def = defs[itemHash] ?? {};
        const statsBlock = def.stats?.stats ?? {};
        const WEAPON_STAT_HASHES = {
          4284893193: 'RPM',
          209426660:  'Impact',
          1240592695: 'Range',
          155624089:  'Stability',
          943549884:  'Handling',
          1480404414: 'Handling',
          4188031367: 'Reload Speed',
          1931675085: 'Reload Speed',
          1591432999: 'Accuracy',
          1885944937: 'Zoom',
          2961396640: 'Zoom',
          1030428403: 'Blast Radius',
          3614673599: 'Blast Radius',
          2762071195: 'Velocity',
          2523465841: 'Velocity',
          3036656661: 'Charge Time',
          447667954:  'Draw Time',
          925767036:  'Ammo Cap',
          2714273498: 'Ammo Cap',
          3871231066: 'Magazine',
          1931675084: 'Inventory',
          3597844532: 'Aim Assist',
          1345609583: 'Aim Assist',
          3555269338: 'Recoil Dir',
          2715839340: 'Recoil Dir',
          2714457168: 'Shield Duration',
          1842278070: 'Guard Efficiency',
          3736848092: 'Guard Resistance',
          1305347063: 'Charge Rate',
          3022301683: 'Guard Endurance',
          2396949875: 'Swing Speed',
        };
        const result = [];
        for (const [hash, label] of Object.entries(WEAPON_STAT_HASHES)) {
          const entry = statsBlock[hash];
          if (entry && entry.value > 0) {
            result.push({ label, value: entry.value });
          }
        }
        return result;
      }

      // Helper: haal weapon mods op (barrel, magazine, perk1, perk2, masterwork, mod)
      // Wapen sockets in volgorde: barrel/scope | magazine/battery | perk1 | perk2 | masterwork | mod
      // Wij willen alleen de echte equipped "mod" socket — plugId bevat 'weapon_mods' of 'enhancements.weapons'
      function getWeaponMods(itemInstanceId) {
        const mods = [];
        const sockets = socketsData[itemInstanceId]?.sockets ?? [];

        for (const socket of sockets) {
          const hash = socket.plugHash;
          if (!hash) continue;
          const plugDef = defs[hash];
          if (!plugDef) continue;

          const plugId = (plugDef.plug?.plugCategoryIdentifier ?? '').toLowerCase();
          const name   = plugDef.displayProperties?.name ?? '';
          const icon   = plugDef.displayProperties?.icon ?? '';

          // Wapen mod sockets: enhancements.weapons.* of plugId bevat 'weapon_mod'
          const isWeaponMod = plugId.startsWith('enhancements.weapons') || plugId.includes('weapon_mod');
          if (!isWeaponMod) continue;
          if (!name || !icon) continue;
          if (name.startsWith('Empty') || name.startsWith('Default') || name.startsWith('Deprecated')) {
            mods.push(null);
            continue;
          }
          mods.push({ name, icon: 'https://www.bungie.net' + icon, hash });
        }

        // Fallback via reusablePlugs
        if (mods.filter(Boolean).length === 0) {
          const plugs = plugsData[itemInstanceId]?.plugs ?? {};
          for (const plugArr of Object.values(plugs)) {
            const plug = plugArr?.[0];
            if (!plug?.plugItemHash) continue;
            const plugDef = defs[plug.plugItemHash];
            if (!plugDef) continue;
            const plugId = (plugDef.plug?.plugCategoryIdentifier ?? '').toLowerCase();
            if (!plugId.startsWith('enhancements.weapons') && !plugId.includes('weapon_mod')) continue;
            const name = plugDef.displayProperties?.name ?? '';
            const icon = plugDef.displayProperties?.icon ?? '';
            if (!name || !icon) continue;
            if (name.startsWith('Empty') || name.startsWith('Default') || name.startsWith('Deprecated')) {
              mods.push(null);
              continue;
            }
            mods.push({ name, icon: 'https://www.bungie.net' + icon, hash: plug.plugItemHash });
          }
        }

        return mods;
      }

      // Helper: haal ghost/ship/sparrow perks op
      // Skip shaders, projections, cosmetics — pak alleen echte perks
      function getCollectiblePerks(itemInstanceId) {
        const sockets = socketsData[itemInstanceId]?.sockets ?? [];
        const perks   = [];
        const COLL_SKIP = ['shader','projection','transmat','ornament','ghost_mod_shader','ghost_mod_projection'];
        for (const socket of sockets) {
          const hash = socket.plugHash;
          if (!hash) continue;
          const plugDef = defs[hash];
          if (!plugDef) continue;
          const name   = plugDef.displayProperties?.name ?? '';
          const icon   = plugDef.displayProperties?.icon ?? '';
          const desc   = plugDef.displayProperties?.description ?? '';
          const plugId = (plugDef.plug?.plugCategoryIdentifier ?? '').toLowerCase();
          if (!name || !icon) continue;
          if (name.startsWith('Empty') || name.startsWith('Default') || name.startsWith('Deprecated') || name === 'Armor Perks') continue;
          if (COLL_SKIP.some(s => plugId.includes(s))) continue;
          perks.push({ name, icon: 'https://www.bungie.net' + icon, desc });
          if (perks.length >= 4) break;
        }
        return perks;
      }

      // Haal ALLEEN echte armor intrinsic/set-bonus perks op (niet de mods)
      // Echte armor perks: plugCategoryIdentifier is 'v400.plugs.armor.mods.armor_perks_intrinsic'
      // of bevat 'armor_perks' maar NIET 'enhancements' (dat zijn mods)
      function getArmorIntrinsicPerks(itemInstanceId) {
        const sockets = socketsData[itemInstanceId]?.sockets ?? [];
        const perks   = [];
        const seen    = new Set();
        for (const socket of sockets) {
          const hash = socket.plugHash;
          if (!hash || seen.has(hash)) continue;
          seen.add(hash);
          const plugDef = defs[hash];
          if (!plugDef) continue;
          const name   = plugDef.displayProperties?.name ?? '';
          const icon   = plugDef.displayProperties?.icon ?? '';
          const desc   = plugDef.displayProperties?.description ?? '';
          const plugId = (plugDef.plug?.plugCategoryIdentifier ?? '').toLowerCase();
          if (!name || !icon) continue;
          if (name.startsWith('Empty') || name.startsWith('Default') || name.startsWith('Deprecated')) continue;
          // Skip alles dat een mod is (enhancements.*)
          if (plugId.startsWith('enhancements.')) continue;
          // Skip cosmetics: shaders, ornaments, armor skins, plug_one (universal ornaments)
          if (plugId.includes('shader') || plugId.includes('ornament') || plugId.includes('transmat')
              || plugId.includes('armor_skins') || plugId.includes('armor_plug_one')
              || plugId.includes('plug_one')) continue;
          // Skip masterworks en trackers
          if (plugId.includes('masterwork') || plugId.includes('tracker')) continue;
          // Skip weapon/armor mod categories — die zijn mods, geen perks
          if (plugId.includes('mods.armor') || plugId.includes('mods.weapons')) continue;
          // Alleen echte intrinsic armor perks (set bonuses, exotic perks)
          // itemType 19 = intrinsic, of plugCategoryIdentifier bevat 'armor_perks' of 'intrinsic'
          const isIntrinsic = plugId.includes('armor_perks') || plugId.includes('intrinsic')
            || plugDef.itemType === 19;
          if (!isIntrinsic) continue;
          perks.push({ name, icon: 'https://www.bungie.net' + icon, desc });
        }
        return perks;
      }

      // 6. Bouw karakters op
      const characters = [];
      for (const [charId, char] of Object.entries(charsData)) {
        const items = equipData[charId]?.items ?? [];

        // Subclass
        const scRaw  = items.find(i => i.bucketHash === SUBCLASS_BUCKET);
        const scHash = scRaw?.itemHash;
        const scDef  = defs[scHash];
        const element = ELEMENT_MAP[scHash] ?? 'void';
        const subclass = {
          hash:    scHash,
          name:    SUBCLASS_NAMES[scHash] ?? scDef?.displayProperties?.name ?? 'Subclass',
          element: element,
          icon:    scDef?.displayProperties?.icon ? 'https://www.bungie.net' + scDef.displayProperties.icon : null,
          screenshot: scDef?.screenshot ? 'https://www.bungie.net' + scDef.screenshot : null,
        };

        // Wapens
        const weapons = items.filter(i => WEAPON_BUCKETS.has(i.bucketHash)).map(i => {
          const def = defs[i.itemHash] ?? {};
          const ins = instanceData[i.itemInstanceId] ?? {};
          const perks = getWeaponPerks(i.itemInstanceId, i.itemHash);
          const wStats = getWeaponStats(i.itemHash);
          const wMods  = getWeaponMods(i.itemInstanceId);
          return {
            bucketHash: i.bucketHash,
            slotName:   SLOT_NAMES[i.bucketHash] ?? 'Wapen',
            name:       def.displayProperties?.name ?? SLOT_NAMES[i.bucketHash] ?? 'Wapen',
            icon:       def.displayProperties?.icon ? 'https://www.bungie.net' + def.displayProperties.icon : null,
            flavorText: def.flavorText ?? '',
            typeName:   def.itemTypeDisplayName ?? '',
            tierType:   def.inventory?.tierType ?? 5,
            isExotic:   (def.inventory?.tierType ?? 5) === 6,
            power:      ins.primaryStat?.value ?? 0,
            perks,
            stats:      wStats,
            mods:       wMods,
          };
        });

        // Armor
        const armor = items.filter(i => ARMOR_BUCKETS.has(i.bucketHash)).map(i => {
          const def = defs[i.itemHash] ?? {};
          const ins = instanceData[i.itemInstanceId] ?? {};
          const { mods, cosmetics } = getArmorMods(i.itemInstanceId);
          const tierType = def.inventory?.tierType ?? 5;
          // Gebruik screenshot als primaire afbeelding (volledig gevuld), icon als fallback
          const screenshot = def.screenshot ? 'https://www.bungie.net' + def.screenshot : null;
          const icon = def.displayProperties?.icon ? 'https://www.bungie.net' + def.displayProperties.icon : null;
          const iconWatermark = def.iconWatermark ? 'https://www.bungie.net' + def.iconWatermark : null;
          // Echte intrinsic set-bonus perks (Reflex Action, Hotshot, etc.) — GEEN mods
          const armorPerks = getArmorIntrinsicPerks(i.itemInstanceId);

          // Armor stats per item (Mobility/Resilience/etc.)
          const itemStatMap2 = statsData[i.itemInstanceId]?.stats ?? {};
          const ARMOR_STAT_MAP2 = {
            2996146975: 'Mobility', 392767087: 'Resilience', 1943323491: 'Recovery',
            1735777505: 'Discipline', 144602215: 'Intellect', 4244567218: 'Strength',
          };
          const armorStatList2 = [];
          for (const [hashStr, stat] of Object.entries(itemStatMap2)) {
            const label = ARMOR_STAT_MAP2[parseInt(hashStr)];
            if (label) armorStatList2.push({ label, value: stat.value ?? 0 });
          }
          const armorTotal2 = armorStatList2.reduce((s, x) => s + x.value, 0);

          // Artifice detectie
          const socketsForArtifice = socketsData[i.itemInstanceId]?.sockets ?? [];
          let isArtifice2 = false;
          for (const socket of socketsForArtifice) {
            const plugDef2 = defs[socket.plugHash];
            const pType2 = plugDef2?.plug?.plugCategoryIdentifier ?? '';
            if (pType2.includes('artificer') || pType2.includes('artifice') || socket.socketType === 1516993267) {
              isArtifice2 = true; break;
            }
          }

          return {
            bucketHash: i.bucketHash,
            slotName:   SLOT_NAMES[i.bucketHash] ?? 'Armor',
            name:       def.displayProperties?.name ?? SLOT_NAMES[i.bucketHash] ?? 'Armor',
            icon,
            screenshot,
            iconWatermark,
            flavorText: def.flavorText ?? '',
            tierType,
            isExotic:   tierType === 6,
            isArmor:    true,
            isWeapon:   false,
            isArtifice: isArtifice2,
            power:      ins.primaryStat?.value ?? 0,
            mods,
            cosmetics,
            perks:      armorPerks,
            armorStatList: armorStatList2,
            armorTotal: armorTotal2,
          };
        });

        // Character stats: Bungie component 200 (characters.data) bevat al een 'stats' object
        // met de exacte hash->value mapping. Dit is betrouwbaarder dan component 304.
        // Hashes: https://data.destinysets.com/
        const STAT_HASHES = {
          2996146975: 'mobility',
          1943323491: 'resilience',
          1735777505: 'recovery',
          144602215:  'discipline',
          392767087:  'intellect',
          4244567218: 'strength',
        };

        // Primair: stats uit char object (component 200) — altijd beschikbaar
        const charRawStats = char.stats ?? {};
        // Fallback: component 202 als char.stats leeg is
        const c304RawStats = charStatsData[charId]?.stats ?? {};

        const stats = {};
        for (const [hash, key] of Object.entries(STAT_HASHES)) {
          const fromChar = charRawStats[hash]?.value ?? charRawStats[hash];
          const from304  = c304RawStats[hash]?.value;
          const val = (typeof fromChar === 'number') ? fromChar
                    : (typeof from304  === 'number') ? from304
                    : 0;
          stats[key] = Math.min(val, 200); // Stats kunnen tot 200 gaan met mods
        }
        console.log('[stats] charId', charId, 'char.stats keys:', Object.keys(charRawStats).join(','), '| final:', JSON.stringify(stats));

        // Ghost Shell, Ship, Sparrow
        function extractCollectible(bucketHash, slotLabel) {
          const raw = items.find(i => i.bucketHash === bucketHash);
          if (!raw) return null;
          const def = defs[raw.itemHash] ?? {};
          const perks = getCollectiblePerks(raw.itemInstanceId);
          return {
            bucketHash,
            slotName:   slotLabel,
            name:       def.displayProperties?.name ?? slotLabel,
            icon:       def.displayProperties?.icon ? 'https://www.bungie.net' + def.displayProperties.icon : null,
            screenshot: def.screenshot ? 'https://www.bungie.net' + def.screenshot : null,
            flavorText: def.flavorText ?? '',
            tierType:   def.inventory?.tierType ?? 4,
            isExotic:   (def.inventory?.tierType ?? 4) === 6,
            perks,
          };
        }
        const ghost   = extractCollectible(GHOST_BUCKET,   'Ghost Shell');
        const ship    = extractCollectible(SHIP_BUCKET,    'Ship');
        const sparrow = extractCollectible(SPARROW_BUCKET, 'Sparrow');

        // Bungie's echte karakter render is ALLEEN beschikbaar via hun eigen website renderer
        // De enige publiek toegankelijke afbeelding IS de emblemBackgroundPath
        // maar die is 474x96 panorama.
        // De subclass screenshot (groot, ~1920px breed) is de beste bron voor het portret.
        const charRenderData = renderData[charId];
        const portraitUrl = null; // Bungie portrait widget werkt niet zonder cookies/session

        characters.push({
          charId,
          mType,
          mId,
          className: CLASS_NAMES[char.classType] ?? 'Guardian',
          classType: char.classType,
          light:     char.light ?? 0,
          emblemBg:  char.emblemBackgroundPath ? 'https://www.bungie.net' + char.emblemBackgroundPath : null,
          emblemIcon: char.emblemPath ? 'https://www.bungie.net' + char.emblemPath : null,
          emblemHash: char.emblemHash ?? null,
          renderPath: char.emblemBackgroundPath ?? null,
          portraitUrl,
          subclass, weapons, armor, ghost, ship, sparrow, stats,
        });
      }

      const ORDER = ['Hunter','Warlock','Titan'];
      characters.sort((a,b) => ORDER.indexOf(a.className) - ORDER.indexOf(b.className));

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      return res.status(200).json({ characters });

    } catch(err) {
      console.error('[charactergear] FATAL:', err.message, err.stack);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── VAULT ITEMS ─────────────────────────────────────────────
  if (action === 'vault') {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Token vereist' });

    try {
      // 1. Membership ophalen
      const user = await bFetch('/User/GetMembershipsForCurrentUser/', token);
      const mems = user?.destinyMemberships ?? [];
      let primary = mems[0];
      for (const m of mems) { if (m.crossSaveOverride === m.membershipType) { primary = m; break; } }
      if (!primary) return res.status(404).json({ error: 'Geen Destiny membership' });

      const mType = primary.membershipType;
      const mId   = primary.membershipId;

      // 2. Profiel ophalen:
      //    102 = ProfileInventories (vault)
      //    201 = CharacterInventories (character bag)
      //    300 = ItemInstances (power, damage type)
      //    302 = ItemSockets (uitgeruste perks/mods per item)
      //    304 = ItemStats (weapon stats: RPM, Range, etc.)
      const profile = await bFetch(
        `/Destiny2/${mType}/Profile/${mId}/?components=102,201,300,302,304,305,309`,
        token
      );

      const vaultItems    = profile?.profileInventory?.data?.items ?? [];
      const charInventory = profile?.characterInventories?.data ?? {};
      const instanceData  = profile?.itemComponents?.instances?.data ?? {};
      const socketsData   = profile?.itemComponents?.sockets?.data ?? {};
      const statsData     = profile?.itemComponents?.stats?.data ?? {};
      const plugsData     = profile?.itemComponents?.reusablePlugs?.data ?? {};

      // Debug: hoeveel items hebben sockets?
      const socketCount = Object.keys(socketsData).length;
      const plugCount   = Object.keys(plugsData).length;
      console.log('[vault] socketsData items:', socketCount, '| plugsData items:', plugCount);

      // Vault bucket hash
      const VAULT_BUCKET = 138197802;

      // Weapon + armor bucket hashes
      const ITEM_BUCKETS = new Set([
        1498876634, 2465295065, 953998645,                         // wapens
        3448274439, 3551918588, 14239492, 20886954, 1585787867,    // armor
      ]);

      // Verzamel alle vault items
      const rawItems = [];

      // Vault items (bucket 138197802 = algemene vault)
      for (const item of vaultItems) {
        if (item.bucketHash === VAULT_BUCKET) {
          rawItems.push({ ...item, source: 'vault' });
        }
      }

      // Character bag items (niet equipped, wel in wapen/armor buckets)
      for (const [, charInv] of Object.entries(charInventory)) {
        for (const item of (charInv.items ?? [])) {
          if (ITEM_BUCKETS.has(item.bucketHash)) {
            rawItems.push({ ...item, source: 'character' });
          }
        }
      }

      // Haal alle unieke itemHashes op
      const hashSet = new Set(rawItems.map(i => i.itemHash));

      // Voeg ook alle socket plug hashes toe (sockets + reusablePlugs) zodat we perk/mod namen hebben
      const plugHashSet = new Set();
      for (const raw of rawItems) {
        // Uitgeruste sockets (302)
        const sockets = socketsData[raw.itemInstanceId]?.sockets ?? [];
        for (const s of sockets) {
          if (s.plugHash) plugHashSet.add(s.plugHash);
        }
        // Alle beschikbare plugs per socket (304 reusablePlugs) — voor wapen-traits
        const plugSlots = plugsData[raw.itemInstanceId]?.plugs ?? {};
        for (const plugArr of Object.values(plugSlots)) {
          for (const p of (plugArr ?? [])) {
            if (p?.plugItemHash) plugHashSet.add(p.plugItemHash);
          }
        }
      }

      const allHashes = [...new Set([...hashSet, ...plugHashSet])];

      // 3. Manifest ophalen voor alle hashes in chunks van 80
      const defs = {};
      const CHUNK = 80;
      for (let i = 0; i < allHashes.length; i += CHUNK) {
        const chunk = allHashes.slice(i, i + CHUNK);
        await Promise.allSettled(chunk.map(async hash => {
          try {
            const ctrl = new AbortController();
            const tid  = setTimeout(() => ctrl.abort(), 6000);
            const r = await fetch(
              `https://www.bungie.net/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`,
              { headers: { 'X-API-Key': API_KEY }, signal: ctrl.signal }
            );
            clearTimeout(tid);
            const d = await r.json();
            if (d?.Response) defs[hash] = d.Response;
          } catch {}
        }));
      }

      // 4. Items verrijken met manifest data
      const DAMAGE_COLORS = {
        1: null,           // Kinetic
        2: '#79c8f0',      // Arc
        3: '#f0a830',      // Solar
        4: '#b574de',      // Void
        6: '#4ec3e0',      // Stasis
        7: '#31c48d',      // Strand
      };

      const items = [];
      for (const raw of rawItems) {
        const def = defs[raw.itemHash];
        if (!def) continue;

        // Alleen wapens (itemType 3) en armor (itemType 2)
        if (def.itemType !== 3 && def.itemType !== 2) continue;

        const tierType    = def.inventory?.tierType ?? 0;
        // Alleen Exotic (6), Legendary (5), Rare (4)
        if (tierType < 4) continue;

        const instance    = instanceData[raw.itemInstanceId] ?? {};
        const damageType  = instance.damageType ?? def.defaultDamageType ?? 0;
        const bucketHash  = def.inventory?.bucketTypeHash ?? 0;

        // ── Perks via sockets of manifest definitie ──────────
        // Vault items zijn niet uitgerust → live sockets zijn leeg
        // Gebruik manifest sockets als primaire bron, live sockets als aanvulling
        const liveSockets = socketsData[raw.itemInstanceId]?.sockets ?? [];
        const manifestSockets = def.sockets?.socketEntries ?? [];

        // Combineer: haal plugHash uit live socket (uitgeruste perk) of manifest (default plug)
        const sockets = manifestSockets.map((entry, idx) => {
          const live = liveSockets[idx];
          return { plugHash: live?.plugHash ?? entry.singleInitialItemHash ?? null };
        }).filter(s => s.plugHash);

        const perks        = [];
        const intrinsicPerk = null;

        // Perk categorieën die we willen tonen
        // socketCategoryHash: 4241085061 = weapon perks, 2518956194 = armor perks,
        //                     3956125808 = armor mods, 590099826 = weapon mods
        // We lopen alle sockets langs en pakken alleen "echte" perks (geen cosmetics/mods)
        const SKIP_CATEGORIES = new Set([
          1742617626, // ghost projections
          2048875504, // shader
          3054711688, // ornament
          1093090108, // transmat
        ]);

        let exoticPerk = null;
        const regularPerks = [];
        const intrinsics   = [];
        const vaultMods    = [];
        const vaultCosmetics = [];
        const armorStats   = { energy: 0, mobility: 0, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 };

        for (const socket of sockets) {
          if (!socket.plugHash) continue;
          const plugDef = defs[socket.plugHash];
          if (!plugDef) continue;

          const pName = plugDef.displayProperties?.name ?? '';
          const pDesc = plugDef.displayProperties?.description ?? '';
          const pIcon = plugDef.displayProperties?.icon ? 'https://www.bungie.net' + plugDef.displayProperties.icon : null;
          const pType = plugDef.plug?.plugCategoryIdentifier ?? '';

          // Skip lege/default/tracker/masterwork items
          if (!pName) continue;
          const isBlank = pName.startsWith('Empty') || pName.startsWith('Default') || pName.startsWith('Deprecated');
          if (pType.includes('tracker') || pType.includes('masterwork') || pType.includes('transmat')) continue;

          // 1. Cosmetics: shaders en ornaments (EERSTE check, vóór perk checks)
          if (pType.includes('shader') || pType.includes('ornament')) {
            if (!isBlank && pIcon) vaultCosmetics.push({ name: pName, icon: pIcon });
            continue;
          }

          if (isBlank) continue;

          // 2. Armor/weapon mods (enhancements.*)
          if (pType.startsWith('enhancements.') || pType.includes('mods.armor') || pType.includes('mods.weapons')) {
            if (pIcon) vaultMods.push({ name: pName, icon: pIcon });
            continue;
          }

          // 3. Intrinsic perks: exotic trait, frame, origin perk
          if (plugDef.itemType === 19 || pType.includes('exotic_intrinsic') || pType.includes('intrinsics')
              || pType.includes('frames') || pType.includes('origin')) {
            intrinsics.push({ name: pName, desc: pDesc, icon: pIcon, isIntrinsic: true });
            continue;
          }

          // 4. Regular perks/traits
          // Weapon traits: pType contains 'traits' but NOT barrels/magazines/scopes/stocks/grips/tubes
          const isWeaponTrait = (pType.includes('traits') || pType.includes('perks'))
            && !pType.includes('barrels') && !pType.includes('magazines')
            && !pType.includes('scopes') && !pType.includes('stocks')
            && !pType.includes('grips') && !pType.includes('tubes')
            && !pType.includes('batteries') && !pType.includes('guards');
          // Armor set-bonus perks
          const isArmorPerk = pType.startsWith('v400.plugs.armor') && !pType.includes('mods');
          if (isWeaponTrait || isArmorPerk) {
            regularPerks.push({ name: pName, desc: pDesc, icon: pIcon });
          }
        }

        // ── Fallback: haal weapon traits op via reusablePlugs als socket loop weinig opleverde ──
        // Dit vangt traits op die niet in de uitgeruste socket zitten maar wel beschikbaar zijn
        if (def.itemType === 3 && regularPerks.length < 2) {
          const plugSlots = plugsData[raw.itemInstanceId]?.plugs ?? {};
          const seenFallback = new Set(regularPerks.map(p => p.name.toLowerCase()));
          for (const plugArr of Object.values(plugSlots)) {
            for (const plug of (plugArr ?? [])) {
              const hash = plug?.plugItemHash;
              if (!hash) continue;
              const pd = defs[hash];
              if (!pd) continue;
              const pt = (pd.plug?.plugCategoryIdentifier ?? '').toLowerCase();
              const pn = pd.displayProperties?.name ?? '';
              const pi = pd.displayProperties?.icon ? 'https://www.bungie.net' + pd.displayProperties.icon : null;
              const pd2 = pd.displayProperties?.description ?? '';
              if (!pn || !pi) continue;
              if (pn.startsWith('Empty') || pn.startsWith('Default') || pn.startsWith('Deprecated')) continue;
              if (pt.includes('masterwork') || pt.includes('tracker') || pt.startsWith('enhancements.')) continue;
              if (pt.includes('barrels') || pt.includes('magazines') || pt.includes('scopes')
                  || pt.includes('stocks') || pt.includes('grips') || pt.includes('tubes')
                  || pt.includes('batteries') || pt.includes('guards')) continue;
              if (!(pt.includes('traits') || pt.includes('perks'))) continue;
              const key = pn.toLowerCase();
              if (seenFallback.has(key)) continue;
              seenFallback.add(key);
              regularPerks.push({ name: pn, desc: pd2, icon: pi });
              if (regularPerks.length >= 4) break;
            }
            if (regularPerks.length >= 4) break;
          }
        }

        // ── Weapon stats ────────────────────────────────────────
        const itemStatMap  = statsData[raw.itemInstanceId]?.stats ?? {};
        const WEAPON_STATS = {
          4284893193: 'RPM',
          1480404414: 'Handling',
          155624089:  'Stability',
          943549884:  'Handling',
          1345609583: 'Aim Assist',
          3555269338: 'Recoil Dir',
          1591432999: 'Accuracy',
          1885944937: 'Zoom',
          3614673599: 'Blast Radius',
          2523465841: 'Velocity',
          3036656661: 'Charge Time',
          1240592695: 'Range',
          209426660:  'Impact',
          1931675084: 'Inventory',
          3871231066: 'Magazine',
          1931675085: 'Reload Speed',
          3555269338: 'Airborne Eff',
          2714273498: 'Ammo Cap',
          447667954:  'Draw Time',
          2714457168: 'Shield Duration',
          1842278070: 'Guard Efficiency',
          3736848092: 'Guard Resistance',
          1305347063: 'Charge Rate',
          3022301683: 'Guard Endurance',
          2396949875: 'Swing Speed',
        };

        const weaponStats = [];
        for (const [hashStr, stat] of Object.entries(itemStatMap)) {
          const label = WEAPON_STATS[parseInt(hashStr)];
          if (label && stat.value !== undefined) {
            weaponStats.push({ label, value: stat.value });
          }
        }

        // ── Armor stats (Energy) ─────────────────────────────────
        const armorEnergy = instance?.primaryStat?.value ?? 0;
        // Mobility/Resilience etc. vanuit stats component
        const ARMOR_STAT_MAP = {
          2996146975: 'Mobility',
          392767087:  'Resilience',
          1943323491: 'Recovery',
          1735777505: 'Discipline',
          144602215:  'Intellect',
          4244567218: 'Strength',
        };
        const armorStatList = [];
        for (const [hashStr, stat] of Object.entries(itemStatMap)) {
          const label = ARMOR_STAT_MAP[parseInt(hashStr)];
          if (label) armorStatList.push({ label, value: stat.value ?? 0 });
        }
        const armorTotal = armorStatList.reduce((s, x) => s + x.value, 0);

        // ── Bucket → wapen categorie ─────────────────────────────
        const BUCKET_NAMES = {
          1498876634: 'Kinetic', 2465295065: 'Energy', 953998645: 'Power',
          3448274439: 'Helmet', 3551918588: 'Gauntlets', 14239492: 'Chest',
          20886954: 'Legs', 1585787867: 'Class Item',
        };

        // classType: 0=Titan, 1=Hunter, 2=Warlock, 3=Unknown/All
        const classType = def.classType ?? 3;
        const CLASS_NAMES = { 0: 'Titan', 1: 'Hunter', 2: 'Warlock', 3: 'Any' };

        // Artifice armor detectie: heeft een extra mod socket (plugCategoryIdentifier bevat 'artificer')
        let isArtifice = false;
        for (const socket of sockets) {
          const plugDef = defs[socket.plugHash];
          const pType = plugDef?.plug?.plugCategoryIdentifier ?? '';
          if (pType.includes('artificer') || pType.includes('artifice')) {
            isArtifice = true;
            break;
          }
          // Ook checken op socketTypeHash voor artifice socket
          if (socket.socketType && (socket.socketType === 1516993267)) {
            isArtifice = true;
            break;
          }
        }

        items.push({
          itemHash:       raw.itemHash,
          itemInstanceId: raw.itemInstanceId ?? null,
          name:           def.displayProperties?.name ?? '—',
          typeName:       def.itemTypeDisplayName ?? '',
          icon:           def.displayProperties?.icon ? 'https://www.bungie.net' + def.displayProperties.icon : null,
          watermark:      def.iconWatermark ? 'https://www.bungie.net' + def.iconWatermark : null,
          tierType,
          isExotic:       tierType === 6,
          isLegendary:    tierType === 5,
          itemType:       def.itemType,
          isWeapon:       def.itemType === 3,
          isArmor:        def.itemType === 2,
          power:          instance.primaryStat?.value ?? 0,
          damageType,
          damageColor:    DAMAGE_COLORS[damageType] ?? null,
          bucketHash,
          bucketName:     BUCKET_NAMES[bucketHash] ?? '',
          classType,
          className:      CLASS_NAMES[classType] ?? 'Any',
          isArtifice,
          // perks
          intrinsics:     intrinsics.slice(0, 2),
          perks:          regularPerks.slice(0, 6),
          mods:           vaultMods.filter(Boolean),
          cosmetics:      vaultCosmetics,
          flavorText:     def.flavorText ?? '',
          slotName:       BUCKET_NAMES[bucketHash] ?? '',
          // stats
          stats:          weaponStats,
          weaponStats,
          armorStatList,
          armorTotal,
          armorEnergy,
        });
      }

      // Sorteer: wapens (Kinetic > Energy > Power) dan armor, Exotic voor Legendary, power desc
      const BUCKET_ORDER = {
        1498876634: 1, 2465295065: 2, 953998645: 3,          // wapens
        3448274439: 10, 3551918588: 11, 14239492: 12, 20886954: 13, 1585787867: 14, // armor
      };
      items.sort((a, b) => {
        const aBO = BUCKET_ORDER[a.bucketHash] ?? 99;
        const bBO = BUCKET_ORDER[b.bucketHash] ?? 99;
        if (aBO !== bBO) return aBO - bBO;
        if (b.tierType !== a.tierType) return b.tierType - a.tierType;
        return b.power - a.power;
      });

      console.log('[vault] totaal items:', items.length, '| vault raw:', rawItems.length);

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.status(200).json({ items, total: items.length });

    } catch(err) {
      console.error('[vault] FATAL:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // IMAGE PROXY — laadt Bungie afbeeldingen via eigen server (voorkomt CORB)
  if (action === 'manifest') {
    const hash = req.query.hash;
    const type = req.query.type || 'DestinyInventoryItemDefinition';
    if (!hash) return res.status(400).json({ error: 'hash required' });
    try {
      const r = await fetch(
        `https://www.bungie.net/Platform/Destiny2/Manifest/${type}/${hash}/`,
        { headers: { 'X-API-Key': API_KEY } }
      );
      const d = await r.json();
      res.setHeader('Cache-Control', 's-maxage=86400');
      return res.status(200).json(d);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === 'img') {
    const imgUrl = req.query.url;
    if (!imgUrl || !imgUrl.startsWith('https://www.bungie.net/')) {
      return res.status(400).json({ error: 'Ongeldige URL' });
    }
    try {
      const r = await fetch(imgUrl, { headers: { 'X-API-Key': API_KEY } });
      if (!r.ok) return res.status(r.status).end();
      const contentType = r.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 's-maxage=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const buf = await r.arrayBuffer();
      return res.status(200).send(Buffer.from(buf));
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Onbekende actie.' });
}
