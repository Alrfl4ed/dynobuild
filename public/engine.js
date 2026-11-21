const socket = io();
let scene, camera, renderer;
let isStudio = false;
let selfId = null;
let myAvatar = null;
let otherPlayers = {};
let worldBlocks = []; // { mesh, data }
let studioBlocksData = [];

// Player physics state
const keys = {};
let velocityY = 0;
let isGrounded = false;
let camYaw = 0, camPitch = 0.35;

function initThree() {
  if (renderer) return;
  const container = document.getElementById('viewport-container');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.1, 500);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(20, 40, 20);
  scene.add(dir);

  // Camera orbit controls
  let dragging = false;
  renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 2) dragging = true; });
  window.addEventListener('mouseup', () => dragging = false);
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    camYaw -= e.movementX * 0.006;
    camPitch = Math.max(0.1, Math.min(1.3, camPitch + e.movementY * 0.006));
  });
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    if (document.activeElement.tagName === 'INPUT') return;
    keys[e.code] = true;
  });
  window.addEventListener('keyup', e => keys[e.code] = false);

  animate();
}

function createAvatarMesh(colorHex) {
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
  group.add(body, head);
  return group;
}

function buildMap(blocks) {
  worldBlocks.forEach(b => scene.remove(b.mesh));
  worldBlocks = [];
  blocks.forEach(b => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.w, b.h, b.d),
      new THREE.MeshLambertMaterial({ color: b.color })
    );
    mesh.position.set(b.x, b.y, b.z);
    scene.add(mesh);
    worldBlocks.push({ mesh, data: b });
  });
}

// --- Lobby & Navigation ---
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
        <div class="game-meta">By ${g.creator} • ${g.playerCount} Playing</div>
      </div>
      <button class="green" onclick="joinGame('${g.id}')">▶ Play</button>
    </div>
  `).join('');
}

function joinGame(gameId) {
  isStudio = false;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('viewport-container').style.display = 'block';
  document.getElementById('studio-toolbar').style.display = 'none';
  document.getElementById('chat-box').style.display = 'flex';
  initThree();

  socket.emit('joinGame', {
    gameId,
    username: document.getElementById('username').value,
    color: document.getElementById('avatarColor').value
  });
}

// --- Studio Builder Mode ---
function openStudio() {
  isStudio = true;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('viewport-container').style.display = 'block';
  document.getElementById('studio-toolbar').style.display = 'flex';
  document.getElementById('chat-box').style.display = 'none';
  initThree();

  Object.values(otherPlayers).forEach(m => scene.remove(m));
  otherPlayers = {};
  if (!myAvatar) {
    myAvatar = createAvatarMesh(document.getElementById('avatarColor').value);
    scene.add(myAvatar);
  }
  myAvatar.position.set(0, 3, 0);

  studioBlocksData = [{ x: 0, y: -0.5, z: 0, w: 40, h: 1, d: 40, color: "#4ade80", type: "solid" }];
  buildMap(studioBlocksData);
}

function studioAddBlock() {
  // Places a 3x1x3 part directly in front of the builder's avatar
  const fx = Math.round(myAvatar.position.x - Math.sin(myAvatar.rotation.y) * 4);
  const fz = Math.round(myAvatar.position.z - Math.cos(myAvatar.rotation.y) * 4);
  const fy = Math.round(myAvatar.position.y + 0.5);

  studioBlocksData.push({
    x: fx, y: fy, z: fz, w: 3, h: 1, d: 3,
    color: document.getElementById('blockColor').value,
    type: document.getElementById('blockType').value
  });
  buildMap(studioBlocksData);
}

function studioClear() {
  studioBlocksData = [{ x: 0, y: -0.5, z: 0, w: 40, h: 1, d: 40, color: "#4ade80", type: "solid" }];
  buildMap(studioBlocksData);
}

async function publishGame() {
  const title = document.getElementById('gameTitle').value;
  const creator = document.getElementById('username').value;
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, creator, blocks: studioBlocksData })
  });
  const data = await res.json();
  if (data.success) joinGame(data.gameId);
}

// --- Socket Listeners ---
socket.on('initWorld', ({ game, players, selfId: id }) => {
  selfId = id;
  Object.values(otherPlayers).forEach(m => scene.remove(m));
  otherPlayers = {};
  if (myAvatar) scene.remove(myAvatar);

  buildMap(game.blocks);

  Object.values(players).forEach(p => {
    const mesh = createAvatarMesh(p.color);
    mesh.position.set(p.x, p.y, p.z);
    scene.add(mesh);
    if (p.id === selfId) myAvatar = mesh;
    else otherPlayers[p.id] = mesh;
  });
});

socket.on('playerJoined', (p) => {
  const mesh = createAvatarMesh(p.color);
  mesh.position.set(p.x, p.y, p.z);
  scene.add(mesh);
  otherPlayers[p.id] = mesh;
});

socket.on('playerMoved', (p) => {
  if (otherPlayers[p.id]) {
    otherPlayers[p.id].position.set(p.x, p.y, p.z);
    otherPlayers[p.id].rotation.y = p.rotY;
  }
});

socket.on('playerLeft', (id) => {
  if (otherPlayers[id]) {
    scene.remove(otherPlayers[id]);
    delete otherPlayers[id];
  }
});

document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    socket.emit('chat', e.target.value);
    e.target.value = '';
  }
});

socket.on('chatMessage', ({ sender, msg }) => {
  const box = document.getElementById('chat-messages');
  box.innerHTML += `<div><strong>${sender}:</strong> ${msg}</div>`;
  box.scrollTop = box.scrollHeight;
});

// --- Main Physics & Render Loop ---
function animate() {
  requestAnimationFrame(animate);
  if (!myAvatar) return;

  const speed = 0.18;
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
    velocityY = 0.32;
    isGrounded = false;
  }

  velocityY -= 0.016; // Gravity
  myAvatar.position.y += velocityY;
  isGrounded = false;

  // Simple AABB Floor & Kill-Brick Collision
  for (const b of worldBlocks) {
    const d = b.data;
    const withinX = Math.abs(myAvatar.position.x - d.x) < (d.w / 2 + 0.5);
    const withinZ = Math.abs(myAvatar.position.z - d.z) < (d.d / 2 + 0.5);
    const topY = d.y + d.h / 2;

    if (withinX && withinZ && myAvatar.position.y <= topY && myAvatar.position.y >= topY - 1.0 && velocityY <= 0) {
      if (d.type === 'kill') {
        myAvatar.position.set(0, 4, 0); // Respawn on kill brick
      } else {
        myAvatar.position.y = topY;
        velocityY = 0;
        isGrounded = true;
      }
    }
  }

  if (myAvatar.position.y < -25) myAvatar.position.set(0, 4, 0);

  if (!isStudio) {
    socket.emit('move', {
      x: myAvatar.position.x,
      y: myAvatar.position.y,
      z: myAvatar.position.z,
      rotY: myAvatar.rotation.y
    });
  }

  // Third-person camera follow
  const dist = 10;
  camera.position.set(
    myAvatar.position.x + Math.sin(camYaw) * Math.cos(camPitch) * dist,
    myAvatar.position.y + 2 + Math.sin(camPitch) * dist,
    myAvatar.position.z + Math.cos(camYaw) * Math.cos(camPitch) * dist
  );
  camera.lookAt(myAvatar.position.x, myAvatar.position.y + 1.5, myAvatar.position.z);

  renderer.render(scene, camera);
}

showLobby();
