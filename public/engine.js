const socket = io();

let currentUser = {
  username: "Guest_" + Math.floor(1000 + Math.random() * 9000),
  isGuest: true,
  avatar: { skin: "#fde047", shirt: "#3b82f6", pants: "#16a34a", hat: "none", face: "smile" }
};

async function submitAuth(mode) {
  const username = document.getElementById('auth-user').value.trim();
  const password = document.getElementById('auth-pass').value;
  const errBox = document.getElementById('auth-error');
  errBox.textContent = "";

  const res = await fetch(`/api/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) {
    errBox.textContent = data.error || "Authentication failed.";
    return;
  }

  currentUser = {
    username: data.user.username,
    isGuest: false,
    avatar: data.user.avatar
  };
  localStorage.setItem('dynobuild_user', JSON.stringify(currentUser));
  finishLogin();
}

function continueAsGuest() {
  finishLogin();
}

function logoutUser() {
  localStorage.removeItem('dynobuild_user');
  location.reload();
}

function finishLogin() {
  document.getElementById('auth-modal').style.display = 'none';
  document.getElementById('top-username').textContent = currentUser.username;
  document.getElementById('welcome-text').textContent = `Welcome back, ${currentUser.username}!`;
  document.getElementById('home-avatar-badge').style.background = currentUser.avatar.shirt;
  document.getElementById('home-avatar-badge').textContent = currentUser.username[0].toUpperCase();

  document.getElementById('av-skin').value = currentUser.avatar.skin;
  document.getElementById('av-shirt').value = currentUser.avatar.shirt;
  document.getElementById('av-pants').value = currentUser.avatar.pants;
  document.getElementById('av-hat').value = currentUser.avatar.hat;
  document.getElementById('av-face').value = currentUser.avatar.face;

  if (!currentUser.isGuest) {
    socket.emit('presence', { username: currentUser.username, avatar: currentUser.avatar });
  }
  switchTab('home');
}

const savedSession = localStorage.getItem('dynobuild_user');
if (savedSession) {
  try {
    currentUser = JSON.parse(savedSession);
    finishLogin();
  } catch (e) {}
}

function switchTab(tab) {
  ['home', 'discover', 'avatar'].forEach(t => {
    document.getElementById('nav-' + t).classList.toggle('active', t === tab);
  });
  document.getElementById('home-view').style.display = tab === 'home' ? 'block' : 'none';
  document.getElementById('discover-view').style.display = tab === 'discover' ? 'block' : 'none';
  document.getElementById('avatar-view').style.display = tab === 'avatar' ? 'flex' : 'none';

  if (tab === 'home') {
    loadFriends();
    loadGames();
  } else if (tab === 'discover') {
    loadGames();
  } else if (tab === 'avatar') {
    initAvatarPreview();
  }
}

async function loadFriends() {
  const strip = document.getElementById('friends-strip');
  if (currentUser.isGuest) {
    strip.innerHTML = `<p style="color:#94a3b8; font-size:0.9rem;">Log in with an account to add friends and join their servers!</p>`;
    return;
  }
  const res = await fetch(`/api/friends/${encodeURIComponent(currentUser.username)}`);
  const friends = await res.json();
  document.getElementById('friends-count-title').textContent = `Friends (${friends.length})`;

  if (friends.length === 0) {
    strip.innerHTML = `<p style="color:#64748b; font-size:0.9rem;">No friends added yet. Enter a username above to add one!</p>`;
    return;
  }

  strip.innerHTML = friends.map(f => {
    const dotClass = f.status === 'In-Game' ? 'ingame' : (f.online ? 'online' : '');
    const joinBtn = f.status === 'In-Game' && f.gameId
      ? `<button class="play-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="joinGame('${f.gameId}')">Join</button>`
      : '';
    return `
      <div class="friend-card">
        <div class="friend-avatar-head" style="background:${f.avatar?.skin || '#fde047'}">
          ${f.username[0].toUpperCase()}
          <span class="status-dot ${dotClass}"></span>
        </div>
        <div class="friend-name">${f.username}</div>
        <div class="friend-status-text">${f.status === 'In-Game' ? f.gameTitle : f.status}</div>
        ${joinBtn}
      </div>
    `;
  }).join('');
}

async function addFriend() {
  if (currentUser.isGuest) return alert("Please create an account first to add friends!");
  const input = document.getElementById('add-friend-input');
  const friendUsername = input.value.trim();
  if (!friendUsername) return;

  const res = await fetch('/api/friends/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser.username, friendUsername })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  input.value = "";
  loadFriends();
}

async function loadGames() {
  const res = await fetch('/api/games');
  const games = await res.json();
  const cardsHTML = games.map(g => `
    <div class="game-card">
      <div class="game-thumb" style="background:${g.thumbColor}">🧱</div>
      <div class="game-info">
        <div class="game-title">${g.title}</div>
        <div class="game-meta">
          <span>By ${g.creator}</span>
          <span>👤 ${g.playerCount}</span>
        </div>
        <button class="play-btn" onclick="joinGame('${g.id}')">▶ Play</button>
      </div>
    </div>
  `).join('');

  document.getElementById('home-game-grid').innerHTML = cardsHTML;
  document.getElementById('discover-game-grid').innerHTML = cardsHTML;
}

function createFaceTexture(faceType, skinColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = skinColor;
  ctx.fillRect(0, 0, 128, 128);

  ctx.fillStyle = '#111827';
  if (faceType === 'shades') {
    ctx.fillRect(20, 42, 38, 22);
    ctx.fillRect(70, 42, 38, 22);
    ctx.fillRect(58, 48, 12, 6);
    ctx.beginPath();
    ctx.arc(64, 78, 18, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.lineWidth = 5;
    ctx.stroke();
  } else if (faceType === 'happy') {
    ctx.beginPath();
    ctx.arc(44, 48, 7, 0, Math.PI * 2);
    ctx.arc(84, 48, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(64, 72, 22, 0, Math.PI);
    ctx.fill();
  } else if (faceType === 'surprised') {
    ctx.beginPath();
    ctx.arc(44, 48, 7, 0, Math.PI * 2);
    ctx.arc(84, 48, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(64, 84, 12, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(44, 48, 7, 0, Math.PI * 2);
    ctx.arc(84, 48, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(64, 74, 20, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

function buildRobloxAvatar(av, username = null) {
  const cfg = av || currentUser.avatar;
  const group = new THREE.Group();

  const legMat = new THREE.MeshLambertMaterial({ color: cfg.pants });
  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.0, 0.6), legMat);
  leftLeg.position.set(-0.3, 0.5, 0);
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.0, 0.6), legMat);
  rightLeg.position.set(0.3, 0.5, 0);

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 0.65),
    new THREE.MeshLambertMaterial({ color: cfg.shirt })
  );
  torso.position.y = 1.6;

  const skinMat = new THREE.MeshLambertMaterial({ color: cfg.skin });
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.15, 0.55), skinMat);
  leftArm.position.set(-0.85, 1.6, 0);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.15, 0.55), skinMat);
  rightArm.position.set(0.85, 1.6, 0);

  const faceTex = createFaceTexture(cfg.face, cfg.skin);
  const headMats = [
    skinMat, skinMat, skinMat, skinMat, skinMat,
    new THREE.MeshLambertMaterial({ map: faceTex })
  ];
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), headMats);
  head.position.y = 2.65;

  group.add(leftLeg, rightLeg, torso, leftArm, rightArm, head);

  if (cfg.hat === 'tophat') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 16), new THREE.MeshLambertMaterial({ color: 0x111827 }));
    brim.position.y = 3.1;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.7, 16), new THREE.MeshLambertMaterial({ color: 0x111827 }));
    top.position.y = 3.45;
    group.add(brim, top);
  } else if (cfg.hat === 'cap') {
    const dome = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.9), new THREE.MeshLambertMaterial({ color: 0x2563eb }));
    dome.position.y = 3.15;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.1, 0.5), new THREE.MeshLambertMaterial({ color: 0x1d4ed8 }));
    visor.position.set(0, 3.05, -0.55);
    group.add(dome, visor);
  } else if (cfg.hat === 'crown') {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.42, 0.4, 8), new THREE.MeshLambertMaterial({ color: 0xfacc15 }));
    crown.position.y = 3.25;
    group.add(crown);
  } else if (cfg.hat === 'halo') {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 24), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 3.45;
    group.add(halo);
  }

  if (username) {
    const label = createOverheadSprite(username);
    label.name = "overheadLabel";
    group.add(label);
  }

  return group;
}

let avScene, avCamera, avRenderer, avPreviewMesh;
function initAvatarPreview() {
  const box = document.getElementById('avatar-preview-box');
  if (!avRenderer) {
    avScene = new THREE.Scene();
    avScene.background = new THREE.Color(0x1e293b);
    avCamera = new THREE.PerspectiveCamera(50, box.clientWidth / box.clientHeight, 0.1, 100);
    avCamera.position.set(0, 2.2, 5.5);
    avCamera.lookAt(0, 1.8, 0);

    avRenderer = new THREE.WebGLRenderer({ antialias: true });
    avRenderer.setSize(box.clientWidth, box.clientHeight);
    box.appendChild(avRenderer.domElement);

    avScene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(5, 10, 7);
    avScene.add(dir);

    function renderAvLoop() {
      requestAnimationFrame(renderAvLoop);
      if (avPreviewMesh) avPreviewMesh.rotation.y += 0.015;
      avRenderer.render(avScene, avCamera);
    }
    renderAvLoop();
  }
  previewAvatarChange();
}

function previewAvatarChange() {
  const updated = {
    skin: document.getElementById('av-skin').value,
    shirt: document.getElementById('av-shirt').value,
    pants: document.getElementById('av-pants').value,
    hat: document.getElementById('av-hat').value,
    face: document.getElementById('av-face').value
  };
  currentUser.avatar = updated;
  if (avPreviewMesh) avScene.remove(avPreviewMesh);
  avPreviewMesh = buildRobloxAvatar(updated, null);
  avPreviewMesh.rotation.y = Math.PI;
  avScene.add(avPreviewMesh);
}

async function saveAvatarToAccount() {
  const msg = document.getElementById('avatar-save-msg');
  document.getElementById('home-avatar-badge').style.background = currentUser.avatar.shirt;
  localStorage.setItem('dynobuild_user', JSON.stringify(currentUser));

  if (!currentUser.isGuest) {
    await fetch('/api/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser.username, avatar: currentUser.avatar })
    });
    socket.emit('presence', { username: currentUser.username, avatar: currentUser.avatar });
  }
  msg.textContent = "✔ Avatar saved!";
  setTimeout(() => msg.textContent = "", 3000);
}

let scene, camera, renderer, transformControl, raycaster;
let isStudio = false;
let selfId = null;
let myAvatar = null;
let spawnPoint = { x: 0, y: 4, z: 0 };
let playersState = {};
let worldBlocks = [];
let selectedMesh = null;

const keys = {};
let velocityY = 0;
let isGrounded = false;
let speedMultiplier = 1;
let camYaw = 0, camPitch = 0.35;

function initThree() {
  if (renderer) return;
  const container = document.getElementById('viewport-container');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7dd3fc);

  camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.1, 600);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x475569, 0.95));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(25, 50, 25);
  scene.add(dir);

  transformControl = new THREE.TransformControls(camera, renderer.domElement);
  transformControl.addEventListener('objectChange', syncMeshToData);
  scene.add(transformControl);
  raycaster = new THREE.Raycaster();

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!isStudio || e.button !== 0 || transformControl.dragging) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(worldBlocks.map(b => b.mesh));
    if (hits.length > 0) selectStudioBlock(hits[0].object);
    else { transformControl.detach(); selectedMesh = null; }
  });

  let dragging = false;
  renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 2) dragging = true; });
  window.addEventListener('mouseup', () => dragging = false);
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    camYaw -= e.movementX * 0.006;
    camPitch = Math.max(0.1, Math.min(1.35, camPitch + e.movementY * 0.006));
  });
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    if (document.activeElement.tagName === 'INPUT') return;
    keys[e.code] = true;
  });
  window.addEventListener('keyup', e => keys[e.code] = false);

  animate();
}

function createOverheadSprite(username, chatText = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');

  if (chatText) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.beginPath();
    ctx.roundRect(36, 12, 440, 74, 18);
    ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    const displayMsg = chatText.length > 28 ? chatText.slice(0, 28) + '...' : chatText;
    ctx.fillText(displayMsg, 256, 58);
  }

  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
  ctx.beginPath();
  ctx.roundRect(126, 102, 260, 44, 12);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 24px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(username, 256, 132);

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
  sprite.scale.set(4.2, 1.6, 1);
  sprite.position.y = 4.1;
  return sprite;
}

function setPlayerChatBubble(playerId, message) {
  const p = playersState[playerId];
  if (!p || !p.mesh) return;

  const oldLabel = p.mesh.getObjectByName("overheadLabel");
  if (oldLabel) p.mesh.remove(oldLabel);

  const newLabel = createOverheadSprite(p.username, message);
  newLabel.name = "overheadLabel";
  p.mesh.add(newLabel);

  clearTimeout(p.chatTimer);
  p.chatTimer = setTimeout(() => {
    const expired = p.mesh.getObjectByName("overheadLabel");
    if (expired) p.mesh.remove(expired);
    const cleanLabel = createOverheadSprite(p.username, null);
    cleanLabel.name = "overheadLabel";
    p.mesh.add(cleanLabel);
  }, 6000);
}

function updateLeaderboardUI() {
  const list = document.getElementById('player-list');
  list.innerHTML = Object.values(playersState).map(p => {
    const canAdd = !currentUser.isGuest && p.username !== currentUser.username;
    const addBtn = canAdd
      ? `<button style="padding:2px 6px; font-size:0.7rem;" onclick="quickAddFriend('${p.username}')">+Add</button>`
      : '';
    return `<li class="player-entry"><span>${p.username}</span>${addBtn}</li>`;
  }).join('');
}

async function quickAddFriend(targetName) {
  await fetch('/api/friends/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser.username, friendUsername: targetName })
  });
  alert(`Added ${targetName} to your Friends list!`);
}

function clearWorld() {
  if (transformControl) transformControl.detach();
  selectedMesh = null;
  worldBlocks.forEach(b => scene.remove(b.mesh));
  worldBlocks = [];
}

function spawnBlockFromData(b) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: b.color })
  );
  mesh.position.set(b.x, b.y, b.z);
  mesh.scale.set(b.w, b.h, b.d);
  mesh.rotation.set(b.rx || 0, b.ry || 0, b.rz || 0);
  scene.add(mesh);
  worldBlocks.push({ mesh, data: { ...b } });
  return mesh;
}

function buildMap(blocks) {
  clearWorld();
  blocks.forEach(b => spawnBlockFromData(b));
}

function joinGame(gameId) {
  isStudio = false;
  spawnPoint = { x: 0, y: 4, z: 0 };
  document.getElementById('viewport-container').style.display = 'block';
  document.getElementById('studio-toolbar').style.display = 'none';
  document.getElementById('chat-box').style.display = 'flex';
  document.getElementById('leaderboard').style.display = 'block';
  initThree();

  socket.emit('joinGame', {
    gameId,
    username: currentUser.username,
    avatar: currentUser.avatar
  });
}

function exitWorldToHome() {
  socket.emit('leaveGame');
  document.getElementById('viewport-container').style.display = 'none';
  switchTab('home');
}

function openStudio() {
  isStudio = true;
  spawnPoint = { x: 0, y: 4, z: 0 };
  document.getElementById('viewport-container').style.display = 'block';
  document.getElementById('studio-toolbar').style.display = 'flex';
  document.getElementById('chat-box').style.display = 'none';
  document.getElementById('leaderboard').style.display = 'none';
  initThree();

  Object.values(playersState).forEach(p => scene.remove(p.mesh));
  playersState = {};
  if (myAvatar) scene.remove(myAvatar);

  myAvatar = buildRobloxAvatar(currentUser.avatar, currentUser.username);
  myAvatar.position.set(0, 3, 0);
  scene.add(myAvatar);

  buildMap([
    { x: 0, y: -0.5, z: 0, w: 40, h: 1, d: 40, rx: 0, ry: 0, rz: 0, color: "#4ade80", script: "solid" }
  ]);
}

function studioAddBlock() {
  const fx = Math.round(myAvatar.position.x - Math.sin(myAvatar.rotation.y) * 5);
  const fz = Math.round(myAvatar.position.z - Math.cos(myAvatar.rotation.y) * 5);
  const fy = Math.round(myAvatar.position.y + 1);

  const mesh = spawnBlockFromData({
    x: fx, y: fy, z: fz, w: 3, h: 1, d: 3, rx: 0, ry: 0, rz: 0,
    color: document.getElementById('blockColor').value,
    script: document.getElementById('blockScript').value
  });
  selectStudioBlock(mesh);
}

function selectStudioBlock(mesh) {
  selectedMesh = mesh;
  transformControl.attach(mesh);
  const item = worldBlocks.find(b => b.mesh === mesh);
  if (item) {
    document.getElementById('blockColor').value = item.data.color;
    document.getElementById('blockScript').value = item.data.script || "solid";
  }
}

function setGizmoMode(mode) {
  transformControl.setMode(mode);
  ['translate', 'scale', 'rotate'].forEach(m => {
    document.getElementById('btn-' + m).classList.toggle('active-tool', m === mode);
  });
}

function syncMeshToData() {
  if (!selectedMesh) return;
  const item = worldBlocks.find(b => b.mesh === selectedMesh);
  if (!item) return;
  item.data.x = selectedMesh.position.x;
  item.data.y = selectedMesh.position.y;
  item.data.z = selectedMesh.position.z;
  item.data.w = Math.abs(selectedMesh.scale.x);
  item.data.h = Math.abs(selectedMesh.scale.y);
  item.data.d = Math.abs(selectedMesh.scale.z);
  item.data.rx = selectedMesh.rotation.x;
  item.data.ry = selectedMesh.rotation.y;
  item.data.rz = selectedMesh.rotation.z;
}

function updateSelectedBlock() {
  if (!selectedMesh) return;
  const item = worldBlocks.find(b => b.mesh === selectedMesh);
  if (!item) return;
  item.data.color = document.getElementById('blockColor').value;
  item.data.script = document.getElementById('blockScript').value;
  selectedMesh.material.color.set(item.data.color);
}

function studioDeleteSelected() {
  if (!selectedMesh) return;
  transformControl.detach();
  scene.remove(selectedMesh);
  worldBlocks = worldBlocks.filter(b => b.mesh !== selectedMesh);
  selectedMesh = null;
}

async function publishGame() {
  const title = document.getElementById('gameTitle').value;
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, creator: currentUser.username, blocks: worldBlocks.map(b => b.data) })
  });
  const data = await res.json();
  if (data.success) joinGame(data.gameId);
}

socket.on('initWorld', ({ game, players, selfId: id }) => {
  selfId = id;
  Object.values(playersState).forEach(p => scene.remove(p.mesh));
  playersState = {};
  if (myAvatar) scene.remove(myAvatar);

  buildMap(game.blocks);

  Object.values(players).forEach(p => {
    const mesh = buildRobloxAvatar(p.avatar, p.username);
    mesh.position.set(p.x, p.y, p.z);
    scene.add(mesh);
    playersState[p.id] = { mesh, username: p.username, chatTimer: null };
    if (p.id === selfId) myAvatar = mesh;
  });
  updateLeaderboardUI();
});

socket.on('playerJoined', (p) => {
  const mesh = buildRobloxAvatar(p.avatar, p.username);
  mesh.position.set(p.x, p.y, p.z);
  scene.add(mesh);
  playersState[p.id] = { mesh, username: p.username, chatTimer: null };
  updateLeaderboardUI();
});

socket.on('playerMoved', (p) => {
  if (playersState[p.id]) {
    playersState[p.id].mesh.position.set(p.x, p.y, p.z);
    playersState[p.id].mesh.rotation.y = p.rotY;
  }
});

socket.on('playerLeft', (id) => {
  if (playersState[id]) {
    scene.remove(playersState[id].mesh);
    delete playersState[id];
    updateLeaderboardUI();
  }
});

document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    socket.emit('chat', e.target.value);
    e.target.value = '';
  }
});

socket.on('chatMessage', ({ id, sender, msg }) => {
  const box = document.getElementById('chat-messages');
  box.innerHTML += `<div><strong>${sender}:</strong> ${msg}</div>`;
  box.scrollTop = box.scrollHeight;
  setPlayerChatBubble(id, msg);
});

function animate() {
  requestAnimationFrame(animate);
  if (!myAvatar) return;

  const speed = 0.18 * speedMultiplier;
  let dx = 0, dz = 0;
  if (keys['KeyW']) dz -= 1;
  if (keys['KeyS']) dz += 1;
  if (keys['KeyA']) dx -= 1;
  if (keys['KeyD']) dx += 1;

  if (dx !== 0 || dz !== 0) {
    const moveAngle = Math.atan2(dx, dz) + camYaw;
    myAvatar.position.x += Math.sin(moveAngle) * speed;
    myAvatar.position.z += Math.cos(moveAngle) * speed;
    myAvatar.rotation.y = moveAngle + Math.PI;
  }

  if (keys['Space'] && isGrounded) {
    velocityY = 0.34;
    isGrounded = false;
  }

  velocityY -= 0.016;
  myAvatar.position.y += velocityY;
  isGrounded = false;
  speedMultiplier = 1;

  for (const b of worldBlocks) {
    const d = b.data;
    const withinX = Math.abs(myAvatar.position.x - d.x) < (d.w / 2 + 0.5);
    const withinZ = Math.abs(myAvatar.position.z - d.z) < (d.d / 2 + 0.5);
    const topY = d.y + d.h / 2;

    if (withinX && withinZ && myAvatar.position.y <= topY && myAvatar.position.y >= topY - 1.1 && velocityY <= 0) {
      if (d.script === 'kill') {
        myAvatar.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
        velocityY = 0;
      } else if (d.script === 'jumppad') {
        myAvatar.position.y = topY;
        velocityY = 0.65;
        isGrounded = false;
      } else if (d.script === 'speed') {
        myAvatar.position.y = topY;
        velocityY = 0;
        isGrounded = true;
        speedMultiplier = 2.2;
      } else if (d.script === 'checkpoint') {
        myAvatar.position.y = topY;
        velocityY = 0;
        isGrounded = true;
        spawnPoint = { x: d.x, y: topY + 2, z: d.z };
      } else {
        myAvatar.position.y = topY;
        velocityY = 0;
        isGrounded = true;
      }
    }
  }

  if (myAvatar.position.y < -25) {
    myAvatar.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    velocityY = 0;
  }

  if (!isStudio) {
    socket.emit('move', {
      x: myAvatar.position.x,
      y: myAvatar.position.y,
      z: myAvatar.position.z,
      rotY: myAvatar.rotation.y
    });
  }

  const dist = 11;
  camera.position.set(
    myAvatar.position.x + Math.sin(camYaw) * Math.cos(camPitch) * dist,
    myAvatar.position.y + 2.2 + Math.sin(camPitch) * dist,
    myAvatar.position.z + Math.cos(camYaw) * Math.cos(camPitch) * dist
  );
  camera.lookAt(myAvatar.position.x, myAvatar.position.y + 1.8, myAvatar.position.z);

  renderer.render(scene, camera);
}

loadGames();
