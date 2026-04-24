// GuardianHQ - Main JS
const API_KEY = '8dde842300df4ffbae605b0f48cf43f9';
const BUNGIE_ROOT = 'https://www.bungie.net/Platform';

// ===== AUTH SYSTEM =====
const Auth = {
  isLoggedIn() { return !!localStorage.getItem('ghq_user'); },
  getUser() { try { return JSON.parse(localStorage.getItem('ghq_user')); } catch { return null; } },
  login(email, password) {
    const users = JSON.parse(localStorage.getItem('ghq_users') || '{}');
    const user = users[email];
    if (!user) return { ok: false, msg: 'Account niet gevonden.' };
    if (user.password !== password) return { ok: false, msg: 'Wachtwoord onjuist.' };
    localStorage.setItem('ghq_user', JSON.stringify({ email, username: user.username, gamertag: user.gamertag }));
    return { ok: true };
  },
  register(data) {
    const users = JSON.parse(localStorage.getItem('ghq_users') || '{}');
    if (users[data.email]) return { ok: false, msg: 'Dit e-mailadres is al geregistreerd.' };
    const tempPass = Math.random().toString(36).slice(-8).toUpperCase();
    users[data.email] = { username: data.username, gamertag: data.gamertag, password: tempPass, email: data.email };
    localStorage.setItem('ghq_users', JSON.stringify(users));
    return { ok: true, tempPass, email: data.email };
  },
  logout() { localStorage.removeItem('ghq_user'); window.location.href = 'index.html'; }
};

// ===== TOAST =====
function showToast(type, title, body) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.innerHTML = '<span class="toast-ico"></span><div><div class="toast-ttl"></div><div class="toast-body"></div></div>';
    document.body.appendChild(t);
  }
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const classes = { success: 'toast-s', error: 'toast-e', info: 'toast-i' };
  t.className = 'toast ' + (classes[type] || 'toast-i');
  t.querySelector('.toast-ico').textContent = icons[type] || 'ℹ️';
  t.querySelector('.toast-ttl').textContent = title;
  t.querySelector('.toast-body').textContent = body;
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => t.classList.remove('show'), 4000);
}

// ===== LOADING SCREEN =====
function initLoading() {
  const ov = document.getElementById('loading-overlay');
  if (!ov) return;
  window.addEventListener('load', () => {
    setTimeout(() => { ov.style.opacity = '0'; setTimeout(() => ov.remove(), 500); }, 1800);
  });
}

// ===== NAV =====
function initNav() {
  const user = Auth.getUser();
  const nb = document.getElementById('nav-btns');
  if (!nb) return;
  if (user) {
    nb.innerHTML = `<span style="font-family:var(--fu);font-size:13px;color:var(--t2);letter-spacing:1px">${user.username}</span>
      <a href="profile.html" class="btn btn-p">👤 Profiel</a>
      <button class="btn btn-out" onclick="Auth.logout()">Uitloggen</button>`;
  } else {
    nb.innerHTML = `<a href="login.html" class="btn btn-out">Inloggen</a>
      <a href="register.html" class="btn btn-p">Account aanmaken</a>`;
  }
  // Active link
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
      if (!Auth.isLoggedIn()) { showToast('error','Login Vereist','Log in om guardians te zoeken.'); return; }
      window.location.href = `profile.html?gt=${encodeURIComponent(inp.value.trim())}`;
    }
  });
}

// ===== BUNGIE API =====
async function bungieGet(path) {
  try {
    const r = await fetch(BUNGIE_ROOT + path, { headers: { 'X-API-Key': API_KEY } });
    return await r.json();
  } catch (e) { console.warn('Bungie API error:', e); return null; }
}

async function searchPlayer(gamertag) {
  const name = gamertag.replace('#', '%23');
  return await bungieGet(`/Destiny2/SearchDestinyPlayer/-1/${name}/`);
}

async function getProfile(membershipType, membershipId) {
  return await bungieGet(`/Destiny2/${membershipType}/Profile/${membershipId}/?components=100,200,204,205`);
}

// ===== PROFILE PAGE =====
async function initProfile() {
  if (!document.getElementById('profile-content')) return;
  const params = new URLSearchParams(location.search);
  const gt = params.get('gt') || (Auth.getUser()?.gamertag || '');
  if (!gt) { document.getElementById('profile-content').innerHTML = '<div style="text-align:center;padding:60px;color:var(--t3)">Geen Guardian opgegeven.</div>'; return; }

  document.getElementById('profile-gamertag').textContent = gt;
  document.getElementById('profile-content').innerHTML = '<div style="text-align:center;padding:60px;color:var(--t2)"><span style="font-size:32px">🔍</span><br><br>Guardian ophalen...</div>';

  const search = await searchPlayer(gt);
  if (!search || !search.Response || !search.Response.length) {
    document.getElementById('profile-content').innerHTML = `<div style="text-align:center;padding:60px;color:var(--t3)"><span style="font-size:40px">⚠️</span><br><br><b style="font-family:var(--fd);font-size:22px;letter-spacing:1px">GUARDIAN NIET GEVONDEN</b><br><span style="color:var(--t3);font-size:13px">Controleer de gamertag en probeer opnieuw.</span></div>`;
    return;
  }

  const p = search.Response[0];
  const profile = await getProfile(p.membershipType, p.membershipId);

  if (!profile || !profile.Response) {
    document.getElementById('profile-content').innerHTML = '<div style="text-align:center;padding:60px;color:var(--t3)">Profieldata kon niet worden geladen.</div>';
    return;
  }

  const chars = profile.Response.characters?.data;
  const classNames = { 0: 'Titan', 1: 'Hunter', 2: 'Warlock' };
  const classIcons = { 0: '🛡️', 1: '🗡️', 2: '📚' };

  let html = `<div class="stats-ov">
    <div class="stcard hl"><div class="stcard-l">Gamertag</div><div class="stcard-v" style="font-size:18px">${gt}</div></div>
    <div class="stcard"><div class="stcard-l">Platform</div><div class="stcard-v" style="font-size:18px">${p.membershipType === 1 ? 'Xbox' : p.membershipType === 2 ? 'PSN' : p.membershipType === 3 ? 'Steam' : 'BNet'}</div></div>
    <div class="stcard"><div class="stcard-l">Characters</div><div class="stcard-v">${chars ? Object.keys(chars).length : 0}</div></div>
    <div class="stcard"><div class="stcard-l">Status</div><div class="stcard-v" style="color:var(--green);font-size:16px">✅ Actief</div></div>
  </div>`;

  if (chars) {
    html += '<div class="tbl-wrap"><div class="tbl-head"><span class="tbl-title">⚔️ Characters</span></div><table><thead><tr><th>Class</th><th>Light Level</th><th>Race</th><th>Speeltijd</th></tr></thead><tbody>';
    Object.values(chars).forEach(c => {
      const cls = classNames[c.classType] || 'Unknown';
      const ico = classIcons[c.classType] || '👤';
      const race = c.raceType === 0 ? 'Mens' : c.raceType === 1 ? 'Awoken' : 'Exo';
      const hrs = Math.floor((c.minutesPlayedTotal || 0) / 60);
      html += `<tr><td><div class="iname"><div class="iico" style="background:rgba(79,195,247,.1)">${ico}</div><div><div class="inm">${cls}</div><div class="ityp">${race}</div></div></div></td>
        <td><span style="font-family:var(--fd);font-size:22px;font-weight:700;color:var(--gold)">${c.light || '?'}</span></td>
        <td>${race}</td><td>${hrs} uur</td></tr>`;
    });
    html += '</tbody></table></div>';
  }

  document.getElementById('profile-content').innerHTML = html;
}

// ===== WEAPONS PAGE =====
const WEAPONS_DEMO = [
  { name: 'Gjallarhorn', type: 'Rocket Launcher', rarity: 'exotic', range: 68, stability: 42, handling: 55, icon: '🚀', bg: 'rgba(245,200,66,.15)' },
  { name: 'Fatebringer', type: 'Hand Cannon', rarity: 'legendary', range: 54, stability: 61, handling: 72, icon: '🔫', bg: 'rgba(156,107,255,.15)' },
  { name: 'Icebreaker', type: 'Sniper Rifle', rarity: 'exotic', range: 88, stability: 34, handling: 48, icon: '🎯', bg: 'rgba(79,195,247,.1)' },
  { name: 'Outbreak Perfected', type: 'Pulse Rifle', rarity: 'exotic', range: 71, stability: 67, handling: 63, icon: '⚡', bg: 'rgba(245,200,66,.15)' },
  { name: 'Gnawing Hunger', type: 'Auto Rifle', rarity: 'legendary', range: 46, stability: 79, handling: 68, icon: '🔥', bg: 'rgba(156,107,255,.15)' },
  { name: 'One Thousand Voices', type: 'Fusion Rifle', rarity: 'exotic', range: 55, stability: 28, handling: 39, icon: '💀', bg: 'rgba(239,83,80,.1)' },
  { name: 'First In, Last Out', type: 'Shotgun', rarity: 'legendary', range: 29, stability: 55, handling: 84, icon: '💥', bg: 'rgba(156,107,255,.15)' },
  { name: 'The Chaperone', type: 'Shotgun', rarity: 'exotic', range: 62, stability: 44, handling: 66, icon: '🎩', bg: 'rgba(245,200,66,.15)' },
];

function renderWeapons(filter = 'all') {
  const tbody = document.getElementById('weapons-tbody');
  if (!tbody) return;
  const list = filter === 'all' ? WEAPONS_DEMO : WEAPONS_DEMO.filter(w => w.rarity === filter);
  tbody.innerHTML = list.map(w => `
    <tr>
      <td><div class="iname"><div class="iico" style="background:${w.bg}">${w.icon}</div>
        <div><div class="inm">${w.name}</div><div class="ityp">${w.type}</div></div></div></td>
      <td><span class="rbadge r-${w.rarity === 'exotic' ? 'exotic' : w.rarity === 'legendary' ? 'leg' : 'rare'}">${w.rarity.charAt(0).toUpperCase()+w.rarity.slice(1)}</span></td>
      <td><div class="sbar"><div class="sbar-b"><div class="sbar-f" style="width:${w.range}%"></div></div><span class="sbar-v">${w.range}</span></div></td>
      <td><div class="sbar"><div class="sbar-b"><div class="sbar-f" style="width:${w.stability}%"></div></div><span class="sbar-v">${w.stability}</span></div></td>
      <td><div class="sbar"><div class="sbar-b"><div class="sbar-f" style="width:${w.handling}%"></div></div><span class="sbar-v">${w.handling}</span></div></td>
    </tr>`).join('');
}

function initWeapons() {
  renderWeapons();
  document.querySelectorAll('.ftab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderWeapons(tab.dataset.filter);
    });
  });
}

// ===== CONTACT FORM =====
function initContact() {
  const form = document.getElementById('contact-form');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('c-name').value;
    showToast('success', 'Bericht Verzonden', `Bedankt ${name}! We nemen zo snel mogelijk contact op.`);
    form.reset();
  });
}

// ===== LOGIN FORM =====
function initLogin() {
  const form = document.getElementById('login-form');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const email = document.getElementById('l-email').value;
    const pass = document.getElementById('l-pass').value;
    const res = Auth.login(email, pass);
    const err = document.getElementById('login-error');
    if (!res.ok) { err.style.display = 'flex'; err.querySelector('span').textContent = res.msg; return; }
    err.style.display = 'none';
    showToast('success', 'Welkom Terug!', 'Je bent ingelogd als Guardian.');
    setTimeout(() => window.location.href = 'index.html', 1200);
  });
}

// ===== REGISTER FORM =====
function initRegister() {
  const form = document.getElementById('register-form');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      username: document.getElementById('r-username').value,
      gamertag: document.getElementById('r-gamertag').value,
      email: document.getElementById('r-email').value,
      password: document.getElementById('r-pass').value
    };
    const confirm = document.getElementById('r-confirm').value;
    const err = document.getElementById('register-error');
    const succ = document.getElementById('register-success');
    if (data.password !== confirm) {
      err.style.display = 'flex'; err.querySelector('span').textContent = 'Wachtwoorden komen niet overeen.'; return;
    }
    const res = Auth.register(data);
    if (!res.ok) { err.style.display = 'flex'; err.querySelector('span').textContent = res.msg; return; }
    err.style.display = 'none';
    succ.style.display = 'flex';
    succ.querySelector('span').textContent = `Account aangemaakt! Je tijdelijke wachtwoord is: ${res.tempPass} — bewaar dit goed.`;
    showToast('success', 'Account Aangemaakt!', `Tijdelijk wachtwoord: ${res.tempPass}`);
    form.reset();
    setTimeout(() => window.location.href = 'login.html', 4000);
  });
}

// ===== PROTECT PAGES =====
function requireAuth() {
  if (!Auth.isLoggedIn()) {
    window.location.href = 'login.html?redirect=' + encodeURIComponent(location.pathname);
  }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  initLoading();
  initNav();
  initSearch();
  initWeapons();
  initContact();
  initLogin();
  initRegister();
  initProfile();
});
