// ============================================================
// GUARDIANHQ — api/bungie-stats.js
// Vercel Serverless Function — Live stats + volledige activiteiten mix
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const API_KEY = process.env.BUNGIE_API_KEY;
  const result = {};

  // ── 1. STEAM LIVE PLAYERS ──
  try {
    const steamRes = await fetch('https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=1085660');
    result.steamPlayers = (await steamRes.json())?.response?.player_count ?? null;
  } catch { result.steamPlayers = null; }

  // ── 2. SERVER STATUS ──
  try {
    const alertRes = await fetch('https://www.bungie.net/Platform/GlobalAlerts/', { headers: { 'X-API-Key': API_KEY } });
    const alertData = await alertRes.json();
    const alerts = alertData?.Response ?? [];
    // Filter alleen echte maintenance alerts (niet info berichten)
    const maintenanceAlerts = alerts.filter(a => a.AlertType === 'GlobalAlert' || a.AlertType === 'maintenance');
    result.serverOnline = maintenanceAlerts.length === 0;
    result.alerts = alerts.map(a => a.AlertHtml || '').slice(0, 2);
  } catch { result.serverOnline = null; result.alerts = []; }

  // ── 3. POWER CAPS ──
  result.softCap = 200; result.powerCap = 550; result.pinnacleFloor = 550;

  // ── 4. RESET TIMERS ──
  const now = new Date();
  const weekly = new Date(now);
  weekly.setUTCHours(17, 0, 0, 0);
  weekly.setUTCDate(weekly.getUTCDate() + ((2 - weekly.getUTCDay() + 7) % 7 || 7));
  result.weeklyResetMs = weekly.getTime();
  const daily = new Date(now);
  daily.setUTCHours(17, 0, 0, 0);
  if (daily <= now) daily.setUTCDate(daily.getUTCDate() + 1);
  result.dailyResetMs = daily.getTime();

  // ── 5. ACTIVITEITEN: live Bungie milestones + altijd-actieve basis ──
  try {
    // Officiële Bungie type-iconen (stabiele CDN URLs uit DestinyActivityTypeDefinition)
    const TYPE_ICONS = {
      raid:       'https://www.bungie.net/img/misc/missing_icon_d2.png', // wordt overschreven door API
      dungeon:    'https://www.bungie.net/img/misc/missing_icon_d2.png',
      nightfall:  'https://www.bungie.net/common/destiny2_content/icons/DestinyMilestoneDefinition_NightfallOrdeal.png',
      strike:     'https://www.bungie.net/common/destiny2_content/icons/DestinyMilestoneDefinition_DailyVanguardModifier.png',
      crucible:   'https://www.bungie.net/common/destiny2_content/icons/DestinyActivityModeDefinition_Crucible.png',
      gambit:     'https://www.bungie.net/common/destiny2_content/icons/DestinyActivityModeDefinition_Gambit.png',
      trials:     'https://www.bungie.net/common/destiny2_content/icons/DestinyActivityModeDefinition_TrialsOfOsiris.png',
      ironbanner: 'https://www.bungie.net/common/destiny2_content/icons/DestinyActivityModeDefinition_IronBanner.png',
      lostsector: 'https://www.bungie.net/common/destiny2_content/icons/DestinyActivityTypeDefinition_LostSector.png',
      exotic:     'https://www.bungie.net/common/destiny2_content/icons/DestinyActivityTypeDefinition_ExoticMission.png',
      seasonal:   'https://www.bungie.net/common/destiny2_content/icons/DestinyActivityTypeDefinition_Seasonal.png',
    };

    const TYPE_BADGE = {
      raid:       { badge: 'Raid',          badgeClass: 'badge-hot'   },
      dungeon:    { badge: 'Dungeon',        badgeClass: 'badge-hot'   },
      nightfall:  { badge: 'Nightfall',      badgeClass: 'badge-live'  },
      trials:     { badge: 'Trials',         badgeClass: 'badge-event' },
      ironbanner: { badge: 'Iron Banner',    badgeClass: 'badge-event' },
      crucible:   { badge: 'Crucible',       badgeClass: 'badge-live'  },
      gambit:     { badge: 'Gambit',         badgeClass: 'badge-live'  },
      lostsector: { badge: 'Lost Sector',    badgeClass: 'badge-live'  },
      strike:     { badge: 'Vanguard',       badgeClass: 'badge-live'  },
      exotic:     { badge: 'Exotic Mission', badgeClass: 'badge-event' },
      seasonal:   { badge: 'Seizoen',        badgeClass: 'badge-live'  },
    };

    // Naam → type detectie
    function detectType(name) {
      const n = (name ?? '').toLowerCase();
      if (/(deep stone crypt|vault of glass|vow of the|king's fall|root of nightmare|crota's end|last wish|garden of salvation|salvation's edge|pantheon)/.test(n)) return 'raid';
      if (/(shattered throne|pit of heresy|grasp of avarice|spire of the watcher|warlord's ruin|ghosts of the deep|duality|prophecy)/.test(n)) return 'dungeon';
      if (/grandmaster/.test(n)) return 'nightfall';
      if (/nightfall/.test(n)) return 'nightfall';
      if (/(trials of osiris|trials)/.test(n)) return 'trials';
      if (/iron banner/.test(n)) return 'ironbanner';
      if (/(crucible|clash|control|survival|rumble|momentum|rift|showdown|competitive)/.test(n)) return 'crucible';
      if (/gambit/.test(n)) return 'gambit';
      if (/lost sector/.test(n)) return 'lostsector';
      if (/(battleground|onslaught|nether|court of blades|tomb of elders|breach|enigma)/.test(n)) return 'seasonal';
      if (/(zero hour|the whisper|exotic mission|node\.ovrd|starcrossed|derealize|kell's)/.test(n)) return 'exotic';
      if (/(vanguard ops|strike)/.test(n)) return 'strike';
      return null;
    }

    // Milestone hashes die we kennen
    const MILESTONE_HINTS = {
      '2171429505': { type: 'nightfall' },
      '1942283260': { type: 'nightfall', name: 'Grandmaster Nightfall' },
      '3847642514': { type: 'strike',    name: 'Vanguard Ops' },
      '2594202463': { type: 'strike',    name: 'Vanguard Ops' },
      '3173648095': { type: 'crucible',  name: 'Crucible' },
      '3427325023': { type: 'crucible' },
      '1437935683': { type: 'crucible' },
      '3172444947': { type: 'gambit',    name: 'Gambit' },
      '2985973691': { type: 'gambit',    name: 'Gambit' },
      '1365342439': { type: 'trials',    name: 'Trials of Osiris' },
      '3753505781': { type: 'ironbanner',name: 'Iron Banner' },
      '1714509342': { type: 'ironbanner',name: 'Iron Banner' },
      // Raids
      '2712317338': { type: 'raid' },
      '4253138191': { type: 'raid' },
      '541780856':  { type: 'raid' },
      '2122313384': { type: 'raid' },
      '3034186474': { type: 'raid' },
      '1485311587': { type: 'raid' },
      '2897305076': { type: 'raid' },
      '1551479837': { type: 'raid' },
      '1186140085': { type: 'raid' },
      // Dungeons
      '3603098564': { type: 'dungeon' },
      '66424225':   { type: 'dungeon' },
      '2712317340': { type: 'dungeon' },
      '3352500532': { type: 'dungeon' },
      '1077505350': { type: 'dungeon' },
      // Exotic missions
      '3899487295': { type: 'exotic' },
      '3464549905': { type: 'exotic' },
      '1648395561': { type: 'exotic' },
      '2029743966': { type: 'exotic' },
      // Seasonal
      '3789021730': { type: 'seasonal' },
      '1437935682': { type: 'seasonal' },
      '2594202464': { type: 'seasonal' },
    };

    // Haal live milestones op
    const milestoneRes = await fetch('https://www.bungie.net/Platform/Destiny2/Milestones/', { headers: { 'X-API-Key': API_KEY } });
    const milestones = (await milestoneRes.json())?.Response ?? {};

    const SKIP = ['artifact', 'season pass', 'seasonal artifact', 'weekly bounty', 'bright dust', 'guardian rank', 'xur', 'eververse', 'collect', 'seasonal rank'];

    // Verwerk milestones parallel
    const promises = Object.keys(milestones).map(async (hash) => {
      const data = milestones[hash];
      const hint = MILESTONE_HINTS[hash];
      if (!data.activities?.length && !hint) return null;

      let name = hint?.name ?? null;
      let sub = null;
      let type = hint?.type ?? null;
      let typeIconUrl = null;
      let pgcrImage = null;

      if (data.activities?.length) {
        try {
          const defRes = await fetch(
            `https://www.bungie.net/Platform/Destiny2/Manifest/DestinyActivityDefinition/${data.activities[0].activityHash}/`,
            { headers: { 'X-API-Key': API_KEY } }
          );
          const def = (await defRes.json())?.Response;
          if (def) {
            if (!name) name = def.displayProperties?.name;
            sub = def.displayProperties?.description ?? null;
            if (!type) type = detectType(name);

            // pgcrImage = mooie achtergrondafbeelding van de activiteit
            if (def.pgcrImage) pgcrImage = 'https://www.bungie.net' + def.pgcrImage;

            // Bestemming als subtitle
            if (def.destinationHash) {
              try {
                const destRes = await fetch(
                  `https://www.bungie.net/Platform/Destiny2/Manifest/DestinyDestinationDefinition/${def.destinationHash}/`,
                  { headers: { 'X-API-Key': API_KEY } }
                );
                const dest = (await destRes.json())?.Response;
                if (dest?.displayProperties?.name) sub = dest.displayProperties.name;
              } catch {}
            }

            // Officieel type-icoon via DestinyActivityTypeDefinition
            if (def.activityTypeHash) {
              try {
                const typeRes = await fetch(
                  `https://www.bungie.net/Platform/Destiny2/Manifest/DestinyActivityTypeDefinition/${def.activityTypeHash}/`,
                  { headers: { 'X-API-Key': API_KEY } }
                );
                const typeDef = (await typeRes.json())?.Response;
                const tp = typeDef?.displayProperties?.icon;
                if (tp && !tp.includes('missing_icon')) typeIconUrl = 'https://www.bungie.net' + tp;
              } catch {}
            }
          }
        } catch {}
      }

      if (!name) return null;
      if (SKIP.some(s => name.toLowerCase().includes(s))) return null;
      if (!type) type = detectType(name);
      if (!type) return null;

      const tb = TYPE_BADGE[type] ?? { badge: 'Actief', badgeClass: 'badge-live' };
      return { name, sub: sub ?? 'Beschikbaar deze week', type, typeIconUrl, pgcrImage, badge: tb.badge, badgeClass: tb.badgeClass, isLive: true };
    });

    const settled = await Promise.allSettled(promises);
    const liveActivities = settled.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);

    // Dedupliceer
    const seen = new Set();
    const unique = liveActivities.filter(a => {
      const key = a.name.toLowerCase().replace(/[:\s\-\.\(\)]+/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sorteer: events > raids/dungeons > nightfall > rest
    const ORDER = { ironbanner:0, trials:1, exotic:2, raid:3, dungeon:4, nightfall:5, crucible:6, gambit:7, strike:8, seasonal:9, lostsector:10 };
    unique.sort((a, b) => (ORDER[a.type] ?? 99) - (ORDER[b.type] ?? 99));

    result.activities = unique.length > 0 ? unique : null;

  } catch (e) {
    console.error('[activities]', e.message);
    result.activities = null;
  }

  // ── 6. XUR FEATURED WAPENS ──
      const STAT_DEFS = {
        4284893193:'RPM', 2523465841:'Range', 1240592695:'Impact',
        155624089:'Stability', 1345609583:'Handling', 943549884:'Reload Speed',
        1931675084:'Magazine', 3555269338:'Aim Assist', 2714457168:'Recoil Dir',
        1885944937:'Accuracy', 3871231066:'Charge Time', 2961396640:'Blast Radius',
        3461344188:'Velocity', 4043523819:'Swing Speed', 2837207746:'Guard Resistance',
      };
      function getStats(def) {
        if (!def.stats?.stats) return [];
        return Object.entries(def.stats.stats)
          .map(([k,v]) => ({ label: STAT_DEFS[k], value: v.value }))
          .filter(s => s.label && s.value > 0)
          .sort((a,b) => b.value - a.value)
          .slice(0,9);
      }
      // Exotic perk lookup — hardcoded voor bekende Xur armor items
      // Bron: xurtracker.com + Bungie manifest
      const EXOTIC_PERKS = {
        "Caliban's Hand":          { name: "Roast 'Em",           desc: "Your Proximity Knife scorches targets it damages with its explosions, or ignites targets on final blow." },
        "Mechaneer's Tricksleeves":{ name: "Spring-Loaded Mounting", desc: "Increases Sidearm airborne effectiveness, ready speed, and reload speed." },
        "Rain of Fire":            { name: "Soaring Fusilier",    desc: "Air dodge reloads all of your weapons and improves the airborne effectiveness of Fusion Rifles and Linear Fusion Rifles; final blows with these weapons make you radiant." },
        "Ophidian Aspect":         { name: "Cobra Totemic",       desc: "Improves melee range as well as ready speed and reload for weapons." },
        "Hoarfrost-Z":             { name: "Glacial Fortification", desc: "While you have a Stasis Super equipped, your Barricade becomes a wall of Stasis crystals that slows nearby targets when created." },
        "Eternal Warrior":         { name: "Resolute",            desc: "Arc final blows grant an escalating damage bonus with Arc weapons." },
        "Getaway Artist":          { name: "Eletromagnetic Capacitor", desc: "Consume your grenade energy to supercharge your Arc Soul, causing it to fly alongside you and fire more rapidly." },
        "Smoke Jumper Vest":       { name: "Smoke and Mirrors",   desc: "Adds an extra charge to your Smoke Bomb. Defeating targets with Smoke Bomb increases your airborne effectiveness for a brief time." },
        "Wild Anthem Boots":       { name: "Overland Motion",     desc: "Sprinting on the ground increases your airborne effectiveness and handling when you next go airborne." },
        "Ferropotent Bond":        { name: "Harmonic Resonance",  desc: "Collecting an Orb of Power or using your class ability significantly improves your weapon handling and reload speed for a brief time." },
        "Ferropotent Cover":       { name: "Iron Palisade",       desc: "Gain bonus armor while using your class ability. Bonus is greater on harder difficulties." },
        "Relativism":              { name: "Relativistic Stride", desc: "Dodging near enemies allows you to blink short distances. Using this ability or your dodge reloads your equipped weapon." },
        "Stoicism":                { name: "Bulwark Charge",      desc: "While Rallying to your Barricade, you gain a temporary overshield. Using your class ability fully reloads your equipped weapons." },
        "Solipsism":               { name: "Void Recursion",      desc: "Finishers and picking up Void Breach allow you to cast your Rift faster and without interruption." },
        // Voeg hier wekelijks nieuwe Xur armor toe
      };

      async function getPerks(def) {
        const itemName = def.displayProperties?.name ?? '';
        // Probeer eerst hardcoded exotic perk
        if (EXOTIC_PERKS[itemName]) {
          const ep = EXOTIC_PERKS[itemName];
          // Haal icoon op via intrinsic socket hash
          let icon = null;
          try {
            const intrinsicHash = def.sockets?.socketEntries?.find(s =>
              s.socketTypeHash && s.singleInitialItemHash
            )?.singleInitialItemHash;
            if (intrinsicHash) {
              const r = await fetch(`https://www.bungie.net/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${intrinsicHash}/`, { headers: { 'X-API-Key': API_KEY } });
              const d = await r.json();
              if (d?.Response?.displayProperties?.icon) {
                icon = 'https://www.bungie.net' + d.Response.displayProperties.icon;
              }
            }
          } catch {}
          return [{ name: ep.name, desc: ep.desc, icon }];
        }
        // Fallback: haal perks op via manifest sockets (voor wapens)
        if (!def.sockets?.socketEntries) return [];
        const hashes = def.sockets.socketEntries
          .slice(0,10).map(s => s.singleInitialItemHash).filter(Boolean);
        const perks = [];
        await Promise.allSettled(hashes.map(async h => {
          try {
            const r = await fetch(`https://www.bungie.net/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${h}/`, { headers: { 'X-API-Key': API_KEY } });
            const d = await r.json();
            const pd = d?.Response;
            if (!pd?.displayProperties?.name) return;
            const pt = pd.plug?.plugCategoryIdentifier ?? '';
            if (pt.includes('tracker') || pt.includes('masterwork') || pt.includes('shader') || pt.includes('ornament') || pt.includes('transmat')) return;
            if (pt.startsWith('enhancements.') || pt.includes('armor.mods')) return;
            if (pt.includes('barrels') || pt.includes('magazines') || pt.includes('scopes') || pt.includes('stocks') || pt.includes('grips') || pt.includes('batteries') || pt.includes('guards') || pt.includes('tubes')) return;
            const name = pd.displayProperties.name;
            const desc = pd.displayProperties.description ?? '';
            if (!name || name.startsWith('Empty') || name.startsWith('Default') || name.startsWith('Deprecated')) return;
            if (desc.includes('No mod currently selected') || desc.includes('not currently selected')) return;
            perks.push({ name, desc, icon: pd.displayProperties.icon ? 'https://www.bungie.net' + pd.displayProperties.icon : null });
          } catch {}
        }));
        return perks.filter(p => p.name.length > 1).slice(0, 4);
      }
  // Stap 1: probeer live items via GetPublicVendors (armor werkt, wapens soms niet)
  // Stap 2: vul aan met bekende wapen hashes van deze week via Bungie Manifest
  try {
    const XUR_HASH = 2190858386;

    // ── Bekende item hashes voor Xur items deze week ──
    // Wapens + class items + catalysts die niet via publieke API binnenkomen
    // Update deze lijst elke vrijdag handmatig
    const KNOWN_EXTRA_HASHES = [
      3856705927, // Hawkmoon - Exotic Hand Cannon
      3844694310, // The Jade Rabbit - Exotic Scout Rifle
      3549153978, // Fighting Lion - Exotic Grenade Launcher
      3899270607, // The Colony - Exotic Grenade Launcher
      1380383475, // Cerberus+1 Catalyst
      3708505013, // Ace of Spades Catalyst
      2809120022, // Relativism - Exotic Hunter Cloak
      2362430352, // Stoicism - Exotic Titan Mark
      2273643087, // Solipsism - Exotic Warlock Bond
    ];
    // Items die NIET in de lijst horen (Legendary rommel die API soms meestuurt)
    const EXCLUDE_NAMES = ['Stochastic Variable', 'Crown-Splitter'];

    // Haal live armor op via GetPublicVendors
    let liveItems = [];
    try {
      const pubRes = await fetch(
        'https://www.bungie.net/Platform/Destiny2/Vendors/?components=402',
        { headers: { 'X-API-Key': API_KEY } }
      );
      const pubData = await pubRes.json();
      const xurVendor = pubData?.Response?.sales?.data?.[XUR_HASH]
                     ?? pubData?.Response?.vendors?.data?.[XUR_HASH];
      const saleItems = xurVendor?.saleItems ?? {};
      console.log('[xur] live saleItems count:', Object.keys(saleItems).length);

      const liveHashes = Object.values(saleItems).map(i => i.itemHash).filter(Boolean);
      await Promise.allSettled(liveHashes.map(async hash => {
        try {
          const r = await fetch(
            `https://www.bungie.net/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`,
            { headers: { 'X-API-Key': API_KEY } }
          );
          const d = await r.json();
          const def = d?.Response;
          if (!def) return;
          if (def.itemType !== 2 && def.itemType !== 3) return; // armor + wapens
          const tierType = def.inventory?.tierType ?? 5;
          const iconPath = def.displayProperties?.icon ?? null;
          const watermark = def.iconWatermark || def.iconWatermarkShelved || null;
          const itemStats  = getStats(def);
          const itemPerks  = await getPerks(def);
          liveItems.push({
            hash, name: def.displayProperties?.name ?? '—',
            typeName: def.itemTypeDisplayName ?? '',
            flavorText: def.flavorText ?? '',
            icon: iconPath ? 'https://www.bungie.net' + iconPath : null,
            iconOverlay: watermark ? 'https://www.bungie.net' + watermark : null,
            tierType, isExotic: tierType === 6,
            itemType: def.itemType,
            stats: itemStats,
            perks: itemPerks,
          });
        } catch {}
      }));
    } catch(e) {
      console.log('[xur] live fetch fout:', e.message);
    }

    // Verwijder ongewenste Legendary items
    liveItems = liveItems.filter(i => !EXCLUDE_NAMES.includes(i.name));

    // Haal bekende extra hashes op via manifest
    const liveHashes = liveItems.map(i => i.hash);
    const missingHashes = KNOWN_EXTRA_HASHES.filter(h => !liveHashes.includes(h));
    await Promise.allSettled(missingHashes.map(async hash => {
      try {
        const r = await fetch(
          `https://www.bungie.net/Platform/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`,
          { headers: { 'X-API-Key': API_KEY } }
        );
        const d = await r.json();
        const def = d?.Response;
        if (!def) return;
        if (EXCLUDE_NAMES.includes(def.displayProperties?.name)) return;
        // wapens=3, armor=2, class items (Hunter Cloak/Titan Mark/Warlock Bond)=19
        if (def.itemType !== 3 && def.itemType !== 2 && def.itemType !== 19) return;
        const tierType = def.inventory?.tierType ?? 5;
        const iconPath = def.displayProperties?.icon ?? null;
        const watermark = def.iconWatermark || def.iconWatermarkShelved || null;
        const itemStats2 = getStats(def);
        const itemPerks2 = await getPerks(def);
        liveItems.push({
          hash, name: def.displayProperties?.name ?? '—',
          typeName: def.itemTypeDisplayName ?? '',
          flavorText: def.flavorText ?? '',
          icon: iconPath ? 'https://www.bungie.net' + iconPath : null,
          iconOverlay: watermark ? 'https://www.bungie.net' + watermark : null,
          tierType, isExotic: tierType === 6,
          itemType: def.itemType,
          stats: itemStats2,
          perks: itemPerks2,
        });
        console.log('[xur] wapen toegevoegd via hash:', def.displayProperties?.name);
      } catch {}
    }));

    // Sorteer: Hunter armor → Titan armor → Warlock armor → Wapens → Catalysts
    const sortOrder = (item) => {
      const t = (item.typeName || '').toLowerCase();
      const n = (item.name || '').toLowerCase();
      // Catalysts
      if (n.includes('catalyst')) return 50;
      // Wapens (geen armor)
      if (item.itemType === 3) return 40;
      // Warlock armor/bond/class item
      if (t.includes('warlock') || t.includes('bond')) return 30;
      // Titan armor/mark/class item
      if (t.includes('titan') || t.includes('mark')) return 20;
      // Hunter armor/cloak/class item
      if (t.includes('hunter') || t.includes('cloak')) return 10;
      // Overige armor (itemType 2 of 19) → Hunter groep
      if (item.itemType === 2 || item.itemType === 19) return 10;
      return 10;
    };
    liveItems.sort((a, b) => sortOrder(a) - sortOrder(b));

    result.featuredWeapons = liveItems.length > 0 ? liveItems : null;
    console.log('[xur] totaal items:', liveItems.length);
  } catch(e) {
    console.error('[xur] crash:', e.message);
    result.featuredWeapons = null;
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  return res.status(200).json(result);
}
