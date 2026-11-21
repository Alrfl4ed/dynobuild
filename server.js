<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DynoBuild - Retro 3D Platform</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    :root {
      --bg-dark: #0f172a;
      --card-dark: #1e293b;
      --border-dark: #334155;
      --accent: #38bdf8;
      --accent-hover: #0284c7;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    body { background: var(--bg-dark); color: var(--text-main); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

    /* Navbar */
    nav { background: #090d16; border-bottom: 1px solid var(--border-dark); padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; height: 60px; }
    .logo { font-size: 1.5rem; font-weight: bold; color: var(--accent); cursor: pointer; letter-spacing: 0.5px; }
    .nav-links { display: flex; gap: 15px; align-items: center; }
    button, .btn { background: var(--accent); color: #0f172a; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: background 0.2s; }
    button:hover { background: var(--accent-hover); color: white; }
    .currency-badge { background: #1e293b; padding: 6px 12px; border-radius: 20px; color: #facc15; font-weight: bold; border: 1px solid var(--border-dark); }

    /* Main Container */
    .app-container { flex: 1; display: flex; overflow: hidden; position: relative; }
    .sidebar { width: 240px; background: var(--card-dark); border-right: 1px solid var(--border-dark); padding: 20px; display: flex; flex-direction: column; gap: 10px; }
    .sidebar a { padding: 10px 12px; border-radius: 6px; text-decoration: none; color: var(--text-main); font-weight: 500; cursor: pointer; }
    .sidebar a:hover, .sidebar a.active { background: #334155; color: var(--accent); }

    .content-area { flex: 1; padding: 25px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; background: #111827; }

    /* Search & Categories */
    .search-bar-container input { width: 100%; padding: 10px 15px; background: var(--card-dark); border: 1px solid var(--border-dark); border-radius: 6px; color: white; font-size: 1rem; }
    .categories-row { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 5px; }
    .cat-chip { background: var(--card-dark); border: 1px solid var(--border-dark); color: var(--text-muted); padding: 6px 14px; border-radius: 20px; cursor: pointer; font-size: 0.9rem; font-weight: 500; white-space: nowrap; }
    .cat-chip.active { background: var(--accent); color: #0f172a; border-color: var(--accent); font-weight: bold; }

    /* Game Cards Grid */
    .section-title { font-size: 1.25rem; font-weight: bold; color: var(--text-main); margin-top: 10px; }
    .games-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; }
    .game-card { background: var(--card-dark); border: 1px solid var(--border-dark); border-radius: 8px; overflow: hidden; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; display: flex; flex-direction: column; }
    .game-card:hover { transform: translateY(-3px); box-shadow: 0 10px 25px -5px rgba(56, 189, 248, 0.15); border-color: var(--accent); }
    .game-thumb { height: 120px; width: 100%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 1.1rem; text-shadow: 0 2px 4px rgba(0,0,0,0.4); }
    .game-info { padding: 12px; display: flex; flex-direction: column; gap: 4px; }
    .game-title { font-weight: bold; font-size: 1rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .game-creator { font-size: 0.8rem; color: var(--text-muted); }
    .game-stats { font-size: 0.75rem; color: var(--text-muted); display: flex; justify-content: space-between; margin-top: 4px; }

    /* Roblox Studio Style Editor Layout */
    .studio-layout { display: grid; grid-template-columns: 220px 1fr 280px; height: 100%; gap: 1px; background: var(--border-dark); }
    .studio-panel { background: var(--card-dark); padding: 15px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
    .studio-canvas-area { background: #000; position: relative; display: flex; align-items: center; justify-content: center; }
    .studio-panel input, .studio-panel textarea, .studio-panel select { width: 100%; padding: 8px; background: #0f172a; border: 1px solid var(--border-dark); border-radius: 4px; color: white; }

    /* Modals */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; display: none; }
    .modal { background: var(--card-dark); border: 1px solid var(--border-dark); padding: 25px; border-radius: 10px; width: 400px; max-width: 90%; display: flex; flex-direction: column; gap: 15px; color: white; }
    .modal input { width: 100%; padding: 10px; background: #0f172a; border: 1px solid var(--border-dark); border-radius: 6px; color: white; }

    /* Viewport & HUD */
    #game-canvas-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: none; z-index: 50; background: #000; }
    .game-hud { position: absolute; top: 15px; left: 15px; z-index: 60; display: flex; gap: 10px; }
    .chat-box { position: absolute; bottom: 15px; left: 15px; width: 320px; height: 180px; background: rgba(15, 23, 42, 0.85); border: 1px solid var(--border-dark); border-radius: 8px; z-index: 60; display: flex; flex-direction: column; padding: 10px; color: white; }
    .chat-messages { flex: 1; overflow-y: auto; font-size: 0.85rem; display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
    .chat-input { display: flex; gap: 6px; }
    .chat-input input { flex: 1; padding: 6px; background: #0f172a; border: 1px solid var(--border-dark); border-radius: 4px; color: white; font-size: 0.85rem; }

    .mobile-controls { position: absolute; bottom: 20px; right: 20px; z-index: 60; display: none; gap: 10px; }
    .dpad-cluster { display: grid; grid-template-columns: repeat(3, 50px); grid-template-rows: repeat(3, 50px); gap: 5px; }
    .dpad-btn { background: rgba(30, 41, 59, 0.8); border: 2px solid var(--border-dark); color: white; font-weight: bold; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; }

    @media (max-width: 768px) {
      .sidebar { display: none; }
      .mobile-controls { display: flex; }
      .studio-layout { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

  <!-- Navbar -->
  <nav>
    <div class="logo" onclick="switchTab('home')">DynoBuild</div>
    <div class="nav-links">
      <div class="currency-badge" id="nav-dybux">💎 100 Dybux</div>
      <div id="auth-nav-area">
        <button onclick="openModal('login-modal')">Login</button>
      </div>
    </div>
  </nav>

  <!-- App Container -->
  <div class="app-container">
    <!-- Sidebar -->
    <div class="sidebar">
      <a class="active" onclick="switchTab('home', this)">🏠 Home</a>
      <a onclick="switchTab('games', this)">🎮 Discover Games</a>
      <a onclick="switchTab('studio', this)">🛠️ DynoStudio</a>
      <a onclick="switchTab('profile', this)">👤 My Profile</a>
      <a onclick="openModal('search-user-modal')">🔍 Search Profile</a>
    </div>

    <!-- Content Area -->
    <div class="content-area" id="main-content">
      <!-- Home Tab -->
      <div id="tab-home">
        <div class="search-bar-container">
          <input type="text" id="global-search" placeholder="Search games or players..." oninput="filterGames(this.value)">
        </div>

        <div class="categories-row">
          <div class="cat-chip active" onclick="setCategory('all', this)">All</div>
          <div class="cat-chip" onclick="setCategory('trending', this)">🔥 Trending</div>
          <div class="cat-chip" onclick="setCategory('popular', this)">⭐ Popular</div>
          <div class="cat-chip" onclick="setCategory('most-players', this)">👥 Most Players</div>
        </div>

        <div class="section-title">Recently Played</div>
        <div class="games-grid" id="recent-games-grid"></div>

        <div class="section-title">All Games</div>
        <div class="games-grid" id="all-games-grid"></div>
      </div>

      <!-- DynoStudio Tab (Roblox Studio Style) -->
      <div id="tab-studio" style="display:none; height: 100%;">
        <div class="studio-layout">
          <!-- Left Toolbox / Classic Editor Controls -->
          <div class="studio-panel">
            <h3>Toolbox</h3>
            <button onclick="addBlockToEditor('box')">+ Add Block</button>
            <button onclick="addBlockToEditor('jumppad')" style="background:#38bdf8; color:#0f172a;">+ Add JumpPad</button>
            <button onclick="addBlockToEditor('kill')" style="background:#ef4444; color:white;">+ Add Kill Brick</button>
            <hr style="border-color:var(--border-dark); margin: 5px 0;">
            <label style="font-size:0.85rem; color:var(--text-muted);">Game Title</label>
            <input type="text" id="studio-game-title" value="My Awesome Game">
            <label style="font-size:0.85rem; color:var(--text-muted);">Thumbnail Color</label>
            <input type="color" id="studio-thumb-color" value="#2563eb" style="height:35px; cursor:pointer;">
            <label style="font-size:0.85rem; color:var(--text-muted);">Custom Code (JS/HTML)</label>
            <textarea id="studio-custom-code" rows="5" placeholder="// Custom game logic"></textarea>
            <button onclick="publishGame()" style="margin-top: auto; background:#16a34a; color:white;">Save & Publish</button>
          </div>

          <!-- Center Visual Preview -->
          <div class="studio-canvas-area" id="studio-viewport">
            <span style="color:var(--text-muted);">3D Editor Canvas Preview</span>
          </div>

          <!-- Right Explorer / Properties Panel -->
          <div class="studio-panel">
            <h3>Explorer & Parts</h3>
            <p style="font-size:0.8rem; color:var(--text-muted);">Workspace Objects</p>
            <div id="studio-parts-list" style="display:flex; flex-direction:column; gap:6px; flex:1; overflow-y:auto;">
              <!-- Dynamically populated parts tree -->
            </div>
          </div>
        </div>
      </div>

      <!-- Profile Tab -->
      <div id="tab-profile" style="display:none;">
        <div id="profile-container" style="background:var(--card-dark); padding:20px; border-radius:8px; border:1px solid var(--border-dark);">
          <h2>Please login to view profile</h2>
        </div>
      </div>
    </div>
  </div>

  <!-- Game Play Viewport -->
  <div id="game-canvas-container">
    <div class="game-hud">
      <button onclick="leaveGame()" style="background:#ef4444; color:white;">Leave Game</button>
      <span id="game-hud-title" style="color:white; font-weight:bold; align-self:center;">Game Title</span>
    </div>
    <div class="chat-box">
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input">
        <input type="text" id="chat-input-field" placeholder="Safe Chatting..." onkeydown="if(event.key==='Enter') sendChat()">
        <button onclick="sendChat()">Send</button>
      </div>
    </div>
    <div class="mobile-controls">
      <div class="dpad-cluster">
        <div></div><div class="dpad-btn" ontouchstart="mobileMove('w', true)" ontouchend="mobileMove('w', false)">▲</div><div></div>
        <div class="dpad-btn" ontouchstart="mobileMove('a', true)" ontouchend="mobileMove('a', false)">◀</div>
        <div class="dpad-btn" ontouchstart="mobileMove('s', true)" ontouchend="mobileMove('s', false)">▼</div>
        <div class="dpad-btn" ontouchstart="mobileMove('d', true)" ontouchend="mobileMove('d', false)">▶</div>
      </div>
    </div>
  </div>

  <!-- Game Info Modal -->
  <div class="modal-overlay" id="game-info-modal">
    <div class="modal">
      <h3 id="modal-game-title">Game Title</h3>
      <p id="modal-game-creator">Creator: Builder</p>
      <p id="modal-game-visits">Visits: 0</p>
      <p id="modal-game-created">Created: Today</p>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button id="modal-play-btn" style="flex: 1;">Play</button>
        <button onclick="closeModal('game-info-modal')" style="background:#64748b; color:white;">Close</button>
      </div>
    </div>
  </div>

  <!-- Login Modal -->
  <div class="modal-overlay" id="login-modal">
    <div class="modal">
      <h3>Login to DynoBuild</h3>
      <input type="text" id="login-user" placeholder="Username">
      <input type="password" id="login-pass" placeholder="Password">
      <button onclick="loginUser()">Login</button>
      <p style="font-size:0.85rem; text-align:center;">Don't have an account? <a onclick="openModal('register-modal'); closeModal('login-modal');" style="color:var(--accent); cursor:pointer;">Register</a></p>
    </div>
  </div>

  <!-- Register Modal -->
  <div class="modal-overlay" id="register-modal">
    <div class="modal">
      <h3>Register Account</h3>
      <input type="text" id="reg-user" placeholder="Username">
      <input type="password" id="reg-pass" placeholder="Password (min 3 chars)">
      <button onclick="registerUser()">Create Account</button>
    </div>
  </div>

  <!-- Search Profile Modal -->
  <div class="modal-overlay" id="search-user-modal">
    <div class="modal">
      <h3>Search User Profile</h3>
      <input type="text" id="search-profile-input" placeholder="Enter username...">
      <button onclick="searchProfile()">View Profile</button>
      <button onclick="closeModal('search-user-modal')" style="background:#64748b; color:white;">Cancel</button>
    </div>
  </div>

  <script>
    let currentUser = JSON.parse(localStorage.getItem('dyno_user') || 'null');
    let allGames = [];
    let socket = null;
    let mobileKeys = { w: false, a: false, s: false, d: false };
    let studioBlocks = [
      { id: 'part-1', name: 'Baseplate', x: 0, y: -0.5, z: 0, w: 40, h: 1, d: 40, color: '#4ade80' }
    ];

    async function init() {
      updateAuthUI();
      await fetchGames();
      // Automatic daily reward check upon loading if logged in
      if (currentUser) {
        claimDailyAutomatic();
      }
    }

    function updateAuthUI() {
      const area = document.getElementById('auth-nav-area');
      if (currentUser) {
        area.innerHTML = `<span style="color:var(--accent); font-weight:bold; margin-right:10px;">${currentUser.username}</span> <button onclick="logout()" style="background:#ef4444; color:white; font-size:0.85rem;">Logout</button>`;
        document.getElementById('nav-dybux').innerText = `💎 ${currentUser.dybux || 100} Dybux`;
      } else {
        area.innerHTML = `<button onclick="openModal('login-modal')">Login</button>`;
      }
    }

    async function claimDailyAutomatic() {
      try {
        const res = await fetch('/api/daily-reward', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username: currentUser.username}) });
        const data = await res.json();
        if (data.success) {
          currentUser.dybux = data.dybux;
          localStorage.setItem('dyno_user', JSON.stringify(currentUser));
          updateAuthUI();
        }
      } catch (err) { /* Already claimed today or offline */ }
    }

    function switchTab(tab, el) {
      ['home', 'studio', 'profile'].forEach(t => {
        document.getElementById(`tab-${t}`).style.display = t === tab ? 'block' : 'none';
      });
      if (el) {
        document.querySelectorAll('.sidebar a').forEach(a => a.classList.remove('active'));
        el.classList.add('active');
      }
      if (tab === 'profile') renderProfile(currentUser);
      if (tab === 'studio') renderStudioExplorer();
    }

    function openModal(id) { document.getElementById(id).style.display = 'flex'; }
    function closeModal(id) { document.getElementById(id).style.display = 'none'; }

    async function fetchGames() {
      const res = await fetch('/api/games');
      allGames = await res.json();
      renderGames(allGames);
      renderRecentGames();
    }

    function renderGames(games) {
      const grid = document.getElementById('all-games-grid');
      grid.innerHTML = games.map(g => `
        <div class="game-card" onclick='openGameInfo(${JSON.stringify(g)})'>
          <div class="game-thumb" style="background: ${g.thumbColor}">${g.title}</div>
          <div class="game-info">
            <div class="game-title">${g.title}</div>
            <div class="game-creator">By ${g.creator}</div>
            <div class="game-stats">
              <span>👀 ${g.visits || 0} visits</span>
              <span>🟢 ${g.playerCount || 0}</span>
            </div>
          </div>
        </div>
      `).join('');
    }

    function renderRecentGames() {
      const recent = JSON.parse(localStorage.getItem('dyno_recent') || '[]');
      const grid = document.getElementById('recent-games-grid');
      const filtered = allGames.filter(g => recent.includes(g.id));
      grid.innerHTML = filtered.length ? filtered.map(g => `
        <div class="game-card" onclick='openGameInfo(${JSON.stringify(g)})'>
          <div class="game-thumb" style="background: ${g.thumbColor}">${g.title}</div>
          <div class="game-info">
            <div class="game-title">${g.title}</div>
            <div class="game-creator">By ${g.creator}</div>
          </div>
        </div>
      `).join('') : '<p style="color:var(--text-muted); font-size:0.9rem;">No recently played games yet.</p>';
    }

    function setCategory(cat, el) {
      document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      let sorted = [...allGames];
      if (cat === 'trending' || cat === 'popular') sorted.sort((a,b) => b.visits - a.visits);
      else if (cat === 'most-players') sorted.sort((a,b) => b.playerCount - a.playerCount);
      renderGames(sorted);
    }

    function filterGames(query) {
      const q = query.toLowerCase();
      renderGames(allGames.filter(g => g.title.toLowerCase().includes(q) || g.creator.toLowerCase().includes(q)));
    }

    function openGameInfo(game) {
      document.getElementById('modal-game-title').innerText = game.title;
      document.getElementById('modal-game-creator').innerText = `Creator: ${game.creator}`;
      document.getElementById('modal-game-visits').innerText = `Visits: ${game.visits || 0}`;
      document.getElementById('modal-game-created').innerText = `Created: ${new Date(game.createdAt || Date.now()).toLocaleDateString()}`;
      document.getElementById('modal-play-btn').onclick = () => { closeModal('game-info-modal'); joinGame(game.id); };
      openModal('game-info-modal');
    }

    // DynoStudio Explorer & Builder Logic
    function renderStudioExplorer() {
      const list = document.getElementById('studio-parts-list');
      list.innerHTML = studioBlocks.map((b, i) => `
        <div style="background:#0f172a; padding:8px; border-radius:4px; border:1px solid var(--border-dark); font-size:0.85rem; display:flex; justify-content:space-between; align-items:center;">
          <span>📦 ${b.name || 'Part ' + i}</span>
          <button onclick="removeStudioBlock(${i})" style="background:#ef4444; color:white; padding:2px 6px; font-size:0.75rem;">X</button>
        </div>
      `).join('');
    }

    function addBlockToEditor(type) {
      studioBlocks.push({
        id: 'part-' + Date.now(),
        name: type === 'jumppad' ? 'JumpPad' : type === 'kill' ? 'KillBrick' : 'Block',
        x: (Math.random() - 0.5) * 6,
        y: 1,
        z: (Math.random() - 0.5) * 6,
        w: 4, h: type === 'box' ? 2 : 1, d: 4,
        color: type === 'jumppad' ? '#38bdf8' : type === 'kill' ? '#ef4444' : '#2563eb'
      });
      renderStudioExplorer();
    }

    function removeStudioBlock(index) {
      studioBlocks.splice(index, 1);
      renderStudioExplorer();
    }

    async function loginUser() {
      const username = document.getElementById('login-user').value;
      const password = document.getElementById('login-pass').value;
      const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username, password}) });
      const data = await res.json();
      if (data.success) {
        currentUser = data.user;
        localStorage.setItem('dyno_user', JSON.stringify(currentUser));
        updateAuthUI();
        closeModal('login-modal');
        claimDailyAutomatic();
      } else { alert(data.error); }
    }

    async function registerUser() {
      const username = document.getElementById('reg-user').value;
      const password = document.getElementById('reg-pass').value;
      const res = await fetch('/api/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username, password}) });
      const data = await res.json();
      if (data.success) {
        currentUser = data.user;
        localStorage.setItem('dyno_user', JSON.stringify(currentUser));
        updateAuthUI();
        closeModal('register-modal');
      } else { alert(data.error); }
    }

    function logout() {
      currentUser = null;
      localStorage.removeItem('dyno_user');
      updateAuthUI();
    }

    async function searchProfile() {
      const username = document.getElementById('search-profile-input').value;
      const res = await fetch(`/api/profile/${username}`);
      if (res.ok) {
        const profile = await res.json();
        closeModal('search-user-modal');
        switchTab('profile');
        renderProfile(profile);
      } else { alert('User not found.'); }
    }

    function renderProfile(user) {
      const container = document.getElementById('profile-container');
      if (!user) {
        container.innerHTML = '<h2>Please login or search a profile</h2>';
        return;
      }
      const badgesHTML = (user.badges || []).map(b => `<span style="background:#334155; color:white; padding:4px 8px; border-radius:4px; font-size:0.8rem;">${b}</span>`).join(' ');
      container.innerHTML = `
        <h2>${user.username}'s Profile</h2>
        <p>💎 Dybux: ${user.dybux || 100}</p>
        <div style="margin-top:10px;"><strong>Badges:</strong> ${badgesHTML || 'None yet'}</div>
      `;
    }

    async function publishGame() {
      if (!currentUser) return alert('Login required to publish games.');
      const title = document.getElementById('studio-game-title').value;
      const customCode = document.getElementById('studio-custom-code').value;
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ title, creator: currentUser.username, blocks: studioBlocks, customCode })
      });
      const data = await res.json();
      if (data.success) {
        alert('Game published successfully!');
        fetchGames();
      }
    }

    // Multiplayer Game Viewport
    function joinGame(gameId) {
      document.getElementById('game-canvas-container').style.display = 'block';
      let recent = JSON.parse(localStorage.getItem('dyno_recent') || '[]');
      recent = [gameId, ...recent.filter(id => id !== gameId)].slice(0, 5);
      localStorage.setItem('dyno_recent', JSON.stringify(recent));

      socket = io();
      socket.emit('presence', { username: currentUser ? currentUser.username : 'Guest' });
      socket.emit('joinGame', { gameId, username: currentUser ? currentUser.username : 'Guest' });

      socket.on('initWorld', ({ game }) => {
        document.getElementById('game-hud-title').innerText = game.title;
        initThreeScene(game);
      });

      socket.on('chatMessage', ({ sender, msg }) => {
        const box = document.getElementById('chat-messages');
        box.innerHTML += `<div><strong>${sender}:</strong> ${msg}</div>`;
        box.scrollTop = box.scrollHeight;
      });
    }

    function leaveGame() {
      if (socket) socket.disconnect();
      document.getElementById('game-canvas-container').style.display = 'none';
      fetchGames();
    }

    function sendChat() {
      const input = document.getElementById('chat-input-field');
      const msg = input.value.trim();
      if (msg && socket) { socket.emit('chat', msg); input.value = ''; }
    }

    function initThreeScene(gameData) {
      const container = document.getElementById('game-canvas-container');
      const existing = container.querySelector('canvas');
      if (existing) existing.remove();

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0f172a);
      const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      container.appendChild(renderer.domElement);

      scene.add(new THREE.DirectionalLight(0xffffff, 1));
      scene.add(new THREE.AmbientLight(0x404040));

      (gameData.blocks || []).forEach(b => {
        const geo = new THREE.BoxGeometry(b.w || 2, b.h || 2, b.d || 2);
        const mat = new THREE.MeshLambertMaterial({ color: b.color || 0x2563eb });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(b.x || 0, b.y || 0, b.z || 0);
        scene.add(mesh);
      });

      const player = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshLambertMaterial({ color: 0x38bdf8 }));
      player.position.set(0, 1, 0);
      scene.add(player);

      camera.position.set(0, 5, 10);

      function animate() {
        requestAnimationFrame(animate);
        if (mobileKeys.w) player.position.z -= 0.1;
        if (mobileKeys.s) player.position.z += 0.1;
        if (mobileKeys.a) player.position.x -= 0.1;
        if (mobileKeys.d) player.position.x += 0.1;
        camera.position.x = player.position.x;
        camera.position.z = player.position.z + 8;
        camera.lookAt(player.position);
        renderer.render(scene, camera);
      }
      animate();
    }

    function mobileMove(key, state) { mobileKeys[key] = state; }

    window.onload = init;
  </script>
</body>
</html>
