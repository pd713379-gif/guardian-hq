// GuardianHQ - Main JS
const API_KEY = '8dde842300df4ffbae605b0f48cf43f9';
const BUNGIE_ROOT = 'https://www.bungie.net/Platform';

// ===== AUTH (Firebase sessionStorage) =====
const Auth = {
  isLoggedIn() {
    return !!sessionStorage.getItem('ghq_user');
  },
  getUser() {
    try { return JSON.parse(sessionStorage.getItem('ghq_user')); }
    catch { return null; }
  },
  logout() {
    sessionStorage.removeItem('ghq_user');
    window.location.href = 'index.html';
  }
};

// ===== TOAST =====
function showToast(type, title, body) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast'; t.className = 'toast';
    t.innerHTML = '<span class="toast-ico"></span><div><div class="toast-ttl"></div><div class="toast-body"></div></div>';
    document.body.appendChild(t);
  }
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  const cls   = { success:'toast-s', error:'toast-e', info:'toast-i' };
  t.className = 'toast ' + (cls[type]||'toast-i');
  t.querySelector('.toast-ico').textContent = icons[type]||'ℹ️';
  t.querySelector('.toast-ttl').textContent = title;
  t.querySelector('.toast-body').textContent = body;
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => t.classList.remove('show'), 4500);
}

// ===== LOADING =====
function initLoading() {
  const ov = document.getElementById('loading-overlay');
  if (!ov) return;
  window.addEventListener('load', () => {
    setTimeout(() => { ov.style.opacity='0'; setTimeout(() => ov.remove(), 500); }, 1800);
  });
}

// ===== NAV =====
function initNav() {
  const user = Auth.getUser();
  const nb = document.getElementById('nav-btns');
  if (!nb) return;
  if (user) {
    nb.innerHTML = `
      <span style="font-family:var(--fu);font-size:13px;color:var(--t2);letter-spacing:1px;padding:0 6px">${user.username}</span>
      <a href="profile.html" class="btn btn-p">👤 Profiel</a>
      <button class="btn btn-out" onclick="Auth.logout()">Uitloggen</button>`;
  } else {
    nb.innerHTML = `
      <a href="login.html" class="btn btn-out">Inloggen</a>
      <a href="register.html" class="btn btn-p">Account aanmaken</a>`;
  }
  const cur = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-a').forEach(a => {
    if (a.getAttribute('href') === cur) a.classList.add('active');
  });
}

// ===== SEARCH =====
function initSearch() {
  const inp = document.getElementById('main-search');
  if (!inp) return;
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && inp.value.trim()) {
      if (!Auth.isLoggedIn()) {
        showToast('error','Login Vereist','Log in om guardians te zoeken.');
        return;
      }
      window.location.href = `profile.html?gt=${encodeURIComponent(inp.value.trim())}`;
    }
  });
}

// ===== BUNGIE API =====
async function bungieGet(path) {
  try {
    const r = await fetch(BUNGIE_ROOT + path, { headers: { 'X-API-Key': API_KEY } });
    return await r.json();
  } catch(e) { console.warn('Bungie API:', e); return null; }
}

// ===== PROFILE =====
async function initProfile() {
  const content = document.getElementById('profile-content');
  if (!content) return;

  if (!Auth.isLoggedIn()) {
    content.innerHTML = `
      <div style="text-align:center;padding:80px;color:var(--t3)">
        <div style="font-size:48px;margin-bottom:16px">🔒</div>
        <div style="font-family:var(--fd);font-size:26px;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">Login Vereist</div>
        <div style="font-size:14px;color:var(--t3);margin-bottom:24px">Je hebt een account nodig om Guardian-profielen te bekijken.</div>
        <div style="display:flex;gap:10px;justify-content:center">
          <a href="login.html" class="btn btn-p">🔑 Inloggen</a>
          <a href="register.html" class="btn btn-g">🚀 Account Aanmaken</a>
        </div>
      </div>`;
    return;
  }

  const params = new URLSearchParams(location.search);
  const user = Auth.getUser();
  const gt = params.get('gt') || user?.gamertag || '';

  if (document.getElementById('profile-gamertag'))
    document.getElementById('profile-gamertag').textContent = gt || user?.username || 'Guardian';

  if (!gt) {
    content.innerHTML = `
      <div style="text-align:center;padding:60px;color:var(--t3)">
        <div style="font-size:36px;margin-bottom:14px">🔍</div>
        <div style="font-family:var(--fd);font-size:20px;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">Zoek een Guardian</div>
        <div style="font-size:13px;margin-bottom:20px">Voer een Bungie gamertag in de zoekbalk in.</div>
      </div>`;
    return;
  }

  content.innerHTML = '<div style="text-align:center;padding:60px;color:var(--t2)"><span style="font-size:36px">🔍</span><br><br>Guardian ophalen...</div>';

  const search = await bungieGet(`/Destiny2/SearchDestinyPlayer/-1/${gt.replace('#','%23')}/`);
  if (!search?.Response?.length) {
    content.innerHTML = `<div style="text-align:center;padding:60px;color:var(--t3)">
      <span style="font-size:40px">⚠️</span><br><br>
      <b style="font-family:var(--fd);font-size:22px;letter-spacing:1px">GUARDIAN NIET GEVONDEN</b><br>
      <span style="font-size:13px">Controleer de gamertag.</span></div>`;
    return;
  }

  const p = search.Response[0];
  const profile = await bungieGet(`/Destiny2/${p.membershipType}/Profile/${p.membershipId}/?components=100,200`);
  if (!profile?.Response) {
    content.innerHTML = '<div style="text-align:center;padding:60px;color:var(--t3)">Profieldata kon niet worden geladen.</div>';
    return;
  }

  const chars = profile.Response.characters?.data;
  const clsName = { 0:'Titan', 1:'Hunter', 2:'Warlock' };
  const clsIco  = { 0:'🛡️', 1:'🗡️', 2:'📚' };
  const platName = { 1:'Xbox', 2:'PSN', 3:'Steam', 254:'BNet' };

  let html = `<div class="stats-ov">
    <div class="stcard hl"><div class="stcard-l">Gamertag</div><div class="stcard-v" style="font-size:16px">${gt}</div></div>
    <div class="stcard"><div class="stcard-l">Platform</div><div class="stcard-v" style="font-size:16px">${platName[p.membershipType]||'Onbekend'}</div></div>
    <div class="stcard"><div class="stcard-l">Characters</div><div class="stcard-v">${chars ? Object.keys(chars).length : 0}</div></div>
    <div class="stcard"><div class="stcard-l">Status</div><div class="stcard-v" style="color:var(--green);font-size:14px">✅ Gevonden</div></div>
  </div>`;

  if (chars) {
    html += `<div class="tbl-wrap"><div class="tbl-head"><span class="tbl-title">⚔️ Characters</span></div>
      <table><thead><tr><th>Class</th><th>Light Level</th><th>Race</th><th>Speeltijd</th></tr></thead><tbody>`;
    Object.values(chars).forEach(c => {
      const race = c.raceType===0?'Mens':c.raceType===1?'Awoken':'Exo';
      const hrs  = Math.floor((c.minutesPlayedTotal||0)/60);
      html += `<tr>
        <td><div class="iname"><div class="iico" style="background:rgba(79,195,247,.1)">${clsIco[c.classType]||'👤'}</div>
        <div><div class="inm">${clsName[c.classType]||'?'}</div><div class="ityp">${race}</div></div></div></td>
        <td><span style="font-family:var(--fd);font-size:22px;font-weight:700;color:var(--gold)">${c.light||'?'}</span></td>
        <td>${race}</td><td>${hrs} uur</td></tr>`;
    });
    html += '</tbody></table></div>';
  }
  content.innerHTML = html;
}

// ===== WEAPONS =====
const WEAPONS = [
  { name:'Gjallarhorn',        type:'Rocket Launcher',  rarity:'exotic',    range:68, stability:42, handling:55, icon:'🚀', bg:'rgba(245,200,66,.15)' },
  { name:'Fatebringer',        type:'Hand Cannon',      rarity:'legendary', range:54, stability:61, handling:72, icon:'🔫', bg:'rgba(156,107,255,.15)' },
  { name:'Icebreaker',         type:'Sniper Rifle',     rarity:'exotic',    range:88, stability:34, handling:48, icon:'🎯', bg:'rgba(79,195,247,.1)'  },
  { name:'Outbreak Perfected', type:'Pulse Rifle',      rarity:'exotic',    range:71, stability:67, handling:63, icon:'⚡', bg:'rgba(245,200,66,.15)' },
  { name:'Gnawing Hunger',     type:'Auto Rifle',       rarity:'legendary', range:46, stability:79, handling:68, icon:'🔥', bg:'rgba(156,107,255,.15)' },
  { name:'1000 Voices',        type:'Fusion Rifle',     rarity:'exotic',    range:55, stability:28, handling:39, icon:'💀', bg:'rgba(239,83,80,.1)'   },
  { name:'First In Last Out',  type:'Shotgun',          rarity:'legendary', range:29, stability:55, handling:84, icon:'💥', bg:'rgba(156,107,255,.15)' },
  { name:'The Chaperone',      type:'Shotgun',          rarity:'exotic',    range:62, stability:44, handling:66, icon:'🎩', bg:'rgba(245,200,66,.15)' },
  { name:'Recluse',            type:'SMG',              rarity:'legendary', range:38, stability:72, handling:76, icon:'🕷️', bg:'rgba(156,107,255,.15)' },
  { name:'Mountaintop',        type:'Grenade Launcher', rarity:'legendary', range:44, stability:58, handling:54, icon:'🏔️', bg:'rgba(79,195,247,.1)'  },
];

function renderWeapons(filter='all') {
  const tbody = document.getElementById('weapons-tbody');
  if (!tbody) return;
  const list = filter==='all' ? WEAPONS : WEAPONS.filter(w=>w.rarity===filter);
  tbody.innerHTML = list.map(w => {
    const rc = w.rarity==='exotic' ? 'r-exotic' : w.rarity==='legendary' ? 'r-leg' : 'r-rare';
    const rl = w.rarity.charAt(0).toUpperCase()+w.rarity.slice(1);
    return `<tr>
      <td><div class="iname"><div class="iico" style="background:${w.bg}">${w.icon}</div>
        <div><div class="inm">${w.name}</div><div class="ityp">${w.type}</div></div></div></td>
      <td><span class="rbadge ${rc}">${rl}</span></td>
      <td><div class="sbar"><div class="sbar-b"><div class="sbar-f" style="width:${w.range}%"></div></div><span class="sbar-v">${w.range}</span></div></td>
      <td><div class="sbar"><div class="sbar-b"><div class="sbar-f" style="width:${w.stability}%"></div></div><span class="sbar-v">${w.stability}</span></div></td>
      <td><div class="sbar"><div class="sbar-b"><div class="sbar-f" style="width:${w.handling}%"></div></div><span class="sbar-v">${w.handling}</span></div></td>
    </tr>`;
  }).join('');
}

function initWeapons() {
  renderWeapons();
  document.querySelectorAll('.ftab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ftab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      renderWeapons(tab.dataset.filter);
    });
  });
}

// ===== CONTACT =====
function initContact() {
  const form = document.getElementById('contact-form');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('c-name').value;
    showToast('success','Bericht Verzonden!',`Bedankt ${name}! We reageren zo snel mogelijk.`);
    form.reset();
  });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  initLoading();
  initNav();
  initSearch();
  initWeapons();
  initContact();
  initProfile();
});
