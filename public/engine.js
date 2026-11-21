const socket = io();
let scene, camera, renderer, transformControl, raycaster;
let isStudio = false;
let selfId = null;
let myAvatar = null;
let spawnPoint = { x: 0, y: 4, z: 0 };

// Store active players: { id: { mesh, username, color, chatTimer } }
let playersState = {};
let worldBlocks = []; // { mesh, data }
let selectedMesh = null;

// Physics state
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

  const hemi = new THREE.HemisphereLight(0xffffff, 0x475569, 0.95);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(25, 50, 25);
  scene.add(dir);

  // Studio TransformControls (Move, Scale, Rotate Gizmos)
  transformControl = new THREE.TransformControls(camera, renderer.domElement);
  transformControl.addEventListener('objectChange', syncMeshToData);
  scene.add(transformControl);

  raycaster = new THREE.Raycaster();

  // Click to select parts in Studio
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!isStudio || e.button !== 0 || transformControl.dragging) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);
    const meshes = worldBlocks.map(b => b.mesh);
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length > 0) {
      selectStudioBlock(hits[0].object);
    } else {
      transformControl.detach();
      selectedMesh = null;
    }
  });

  // Right-click camera orbit
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

// --- 3D Overhead Nameplate & Chat Bubble Generator ---
function createOverheadSprite(username, chatText = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');

  // Draw floating speech bubble if player recently chatted
  if (chatText) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
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

  // Draw player username pill
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.beginPath();
  ctx.roundRect(126, 102, 260, 44, 12);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 24px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(username, 256, 132);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(4.2, 1.6, 1);
  sprite.position.y = 3.6;
  return sprite;
}

function createAvatarMesh(colorHex, username) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.5, 0.7),
    new THREE.MeshLambertMaterial({ color: colorHex })
  );
  body.position.y = 1.25;

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshLambertMaterial({ color: 0xfde047 })
  );
  head.position.y = 2.45;

  const label = createOverheadSprite(username);
  label.name = "overheadLabel";

  group.add(body, head, label);
  return group;
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

// --- Leaderboard UI Updater ---
function updateLeaderboardUI() {
  const list = document.getElementById('player-list');
  list.innerHTML = Object.values(playersState).map(p => `
    <li class="player-entry">
      <span class="color-dot" style="background:${p.color}"></span>
      <span>${p.username}</span>
    </li>
  `).join('');
}

// --- Map Builder ---
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

// --- Navigation & Lobby ---
async function showLobby() {
  isStudio = false;
  document.getElementById('lobby').style.display = 'block';
  document.getElementById('viewport-container').style.display = 'none';

  const res = await fetch('/api/games');
  const games = await res.json();
  const grid = document.getElementById('game-grid');
  grid.innerHTML = games.map(g => `
    <div class="game-card">
      <div>
        <h3>${g.title}</h3>
        <div class="game-meta">By ${g.creator} • 🟢 ${g.playerCount} Online</div>
      </div>
      <button class="green" onclick="joinGame('${g.id}')">▶ Play World</button>
    </div>
  `).join('');
}

function joinGame(gameId) {
  isStudio = false;
  spawnPoint = { x: 0, y: 4, z: 0 };
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('viewport-container').style.display = 'block';
  document.getElementById('studio-toolbar').style.display = 'none';
  document.getElementById('chat-box').style.display = 'flex';
  document.getElementById('leaderboard').style.display = 'block';
  initThree();

  socket.emit('joinGame', {
    gameId,
    username: document.getElementById('username').value,
    color: document.getElementById('avatarColor').value
  });
}

// --- DynoStudio Mode (Gizmos & Scripting) ---
function openStudio() {
  isStudio = true;
  spawnPoint = { x: 0, y: 4, z: 0 };
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('viewport-container').style.display = 'block';
  document.getElementById('studio-toolbar').style.display = 'flex';
  document.getElementById('chat-box').style.display = 'none';
  document.getElementById('leaderboard').style.display = 'none';
  initThree();

  Object.values(playersState).forEach(p => scene.remove(p.mesh));
  playersState = {};

  const uname = document.getElementById('username').value || "Builder";
  const ucolor = document.getElementById('avatarColor').value;
  myAvatar = createAvatarMesh(ucolor, uname);
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
  const creator = document.getElementById('username').value;
  const blocksPayload = worldBlocks.map(b => b.data);

  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, creator, blocks: blocksPayload })
  });
  const data = await res.json();
  if (data.success) joinGame(data.gameId);
}

// --- Socket Events ---
socket.on('initWorld', ({ game, players, selfId: id }) => {
  selfId = id;
  Object.values(playersState).forEach(p => scene.remove(p.mesh));
  playersState = {};

  buildMap(game.blocks);

  Object.values(players).forEach(p => {
    const mesh = createAvatarMesh(p.color, p.username);
    mesh.position.set(p.x, p.y, p.z);
    scene.add(mesh);
    playersState[p.id] = { mesh, username: p.username, color: p.color, chatTimer: null };
    if (p.id === selfId) myAvatar = mesh;
  });
  updateLeaderboardUI();
});

socket.on('playerJoined', (p) => {
  const mesh = createAvatarMesh(p.color, p.username);
  mesh.position.set(p.x, p.y, p.z);
  scene.add(mesh);
  playersState[p.id] = { mesh, username: p.username, color: p.color, chatTimer: null };
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

// --- Main Physics & Render Loop ---
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

  // Collision & Block Scripts
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

showLobby();
