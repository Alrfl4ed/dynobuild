const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Database Setup (Render PostgreSQL with In-Memory Fallback) ---
let pool = null;
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  } catch (err) {
    console.log("pg package not installed, using in-memory fallback.");
  }
}

const defaultAvatar = {
  skin: "#fde047",
  shirt: "#3b82f6",
  pants: "#16a34a",
  hat: "none",
  face: "smile"
};

const memUsers = {};
const memGames = {
  "default-plaza": {
    id: "default-plaza",
    title: "DynoBuild Crossroads",
    creator: "DynoAdmin",
    thumbColor: "#38bdf8",
    blocks: [
      { x: 0, y: -0.5, z: 0, w: 40, h: 1, d: 40, rx: 0, ry: 0, rz: 0, color: "#4ade80", script: "solid" },
      { x: 0, y: 0.5, z: -8, w: 4, h: 1, d: 4, rx: 0, ry: 0, rz: 0, color: "#38bdf8", script: "jumppad" },
      { x: 7, y: 0.5, z: 5, w: 4, h: 1, d: 4, rx: 0, ry: 0, rz: 0, color: "#ef4444", script: "kill" },
      { x: -7, y: 0.5, z: 5, w: 4, h: 1, d: 4, rx: 0, ry: 0, rz: 0, color: "#facc15", script: "checkpoint" }
    ]
  }
};

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}

async function initDB() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      pass_hash TEXT NOT NULL,
      avatar JSONB NOT NULL,
      friends JSONB NOT NULL DEFAULT '[]'
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      creator TEXT NOT NULL,
      thumb_color TEXT DEFAULT '#2563eb',
      blocks JSONB NOT NULL
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*) FROM games');
  if (parseInt(rows[0].count) === 0) {
    const def = memGames["default-plaza"];
    await pool.query(
      'INSERT INTO games (id, title, creator, thumb_color, blocks) VALUES ($1, $2, $3, $4, $5)',
      [def.id, def.title, def.creator, def.thumbColor, JSON.stringify(def.blocks)]
    );
  }
}
initDB().catch(console.error);

async function getUser(username) {
  const clean = String(username || '').trim();
  if (!clean) return null;
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [clean]);
    return rows[0] || null;
  }
  return memUsers[clean.toLowerCase()] || null;
}

async function saveNewUser(username, passHash) {
  if (pool) {
    await pool.query(
      'INSERT INTO users (username, pass_hash, avatar, friends) VALUES ($1, $2, $3, $4)',
      [username, passHash, JSON.stringify(defaultAvatar), JSON.stringify([])]
    );
  } else {
    memUsers[username.toLowerCase()] = {
      username,
      pass_hash: passHash,
      avatar: { ...defaultAvatar },
      friends: []
    };
  }
}

// --- Auth & Profile API ---
app.post('/api/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().replace(/[^a-zA-Z0-9_]/g, '').slice(0, 18);
    const password = String(req.body.password || '');
    if (username.length < 3 || password.length < 3) {
      return res.status(400).json({ error: "Username and password must be at least 3 characters." });
    }
    const existing = await getUser(username);
    if (existing) return res.status(400).json({ error: "Username is already taken." });

    await saveNewUser(username, hashPassword(password));
    res.json({ success: true, user: { username, avatar: defaultAvatar, friends: [] } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = await getUser(username);
    if (!user || user.pass_hash !== hashPassword(password)) {
      return res.status(401).json({ error: "Invalid username or password." });
    }
    res.json({
      success: true,
      user: { username: user.username, avatar: user.avatar, friends: user.friends || [] }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/avatar', async (req, res) => {
  try {
    const { username, avatar } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (pool) {
      await pool.query('UPDATE users SET avatar = $1 WHERE username = $2', [JSON.stringify(avatar), user.username]);
    } else {
      user.avatar = avatar;
    }
    res.json({ success: true, avatar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const onlineUsers = {};
const activeRooms = {};

app.get('/api/friends/:username', async (req, res) => {
  try {
    const user = await getUser(req.params.username);
    if (!user) return res.json([]);
    const friendNames = user.friends || [];
    const detailed = [];

    for (const fName of friendNames) {
      const fUser = await getUser(fName);
      const live = onlineUsers[fName.toLowerCase()];
      detailed.push({
        username: fUser ? fUser.username : fName,
        avatar: fUser ? fUser.avatar : defaultAvatar,
        online: !!live,
        status: live ? live.status : 'Offline',
        gameId: live ? live.gameId : null,
        gameTitle: live ? live.gameTitle : null
      });
    }
    res.json(detailed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/friends/add', async (req, res) => {
  try {
    const { username, friendUsername } = req.body;
    const user = await getUser(username);
    const target = await getUser(friendUsername);

    if (!user) return res.status(404).json({ error: "Not logged in." });
    if (!target) return res.status(404).json({ error: "Player not found." });
    if (user.username.toLowerCase() === target.username.toLowerCase()) {
      return res.status(400).json({ error: "You cannot add yourself." });
    }

    const myFriends = new Set(user.friends || []);
    myFriends.add(target.username);
    const theirFriends = new Set(target.friends || []);
    theirFriends.add(user.username);

    if (pool) {
      await pool.query('UPDATE users SET friends = $1 WHERE username = $2', [JSON.stringify([...myFriends]), user.username]);
      await pool.query('UPDATE users SET friends = $1 WHERE username = $2', [JSON.stringify([...theirFriends]), target.username]);
    } else {
      user.friends = [...myFriends];
      target.friends = [...theirFriends];
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/games', async (req, res) => {
  try {
    let gamesList = [];
    if (pool) {
      const { rows } = await pool.query('SELECT id, title, creator, thumb_color FROM games');
      gamesList = rows;
    } else {
      gamesList = Object.values(memGames);
    }
    const formatted = gamesList.map(g => ({
      id: g.id,
      title: g.title,
      creator: g.creator,
      thumbColor: g.thumb_color || g.thumbColor || "#2563eb",
      playerCount: activeRooms[g.id] ? Object.keys(activeRooms[g.id]).length : 0
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/games', async (req, res) => {
  try {
    const { title, creator, blocks } = req.body;
    const id = 'game-' + Date.now();
    const safeTitle = String(title || "Untitled Place").slice(0, 40);
    const safeCreator = String(creator || "Builder").slice(0, 24);
    const colors = ["#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];
    const thumbColor = colors[Math.floor(Math.random() * colors.length)];

    if (pool) {
      await pool.query(
        'INSERT INTO games (id, title, creator, thumb_color, blocks) VALUES ($1, $2, $3, $4, $5)',
        [id, safeTitle, safeCreator, thumbColor, JSON.stringify(blocks)]
      );
    } else {
      memGames[id] = { id, title: safeTitle, creator: safeCreator, thumbColor, blocks };
    }
    res.json({ success: true, gameId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  let currentRoom = null;
  let loggedUsername = null;

  socket.on('presence', ({ username, avatar }) => {
    if (!username) return;
    loggedUsername = username;
    onlineUsers[username.toLowerCase()] = {
      username,
      status: 'Online',
      gameId: null,
      gameTitle: null,
      avatar: avatar || defaultAvatar
    };
  });

  socket.on('leaveGame', () => {
    if (currentRoom && activeRooms[currentRoom]) {
      delete activeRooms[currentRoom][socket.id];
      io.to(currentRoom).emit('playerLeft', socket.id);
      socket.leave(currentRoom);
      currentRoom = null;
    }
    if (loggedUsername && onlineUsers[loggedUsername.toLowerCase()]) {
      onlineUsers[loggedUsername.toLowerCase()].status = 'Online';
      onlineUsers[loggedUsername.toLowerCase()].gameId = null;
      onlineUsers[loggedUsername.toLowerCase()].gameTitle = null;
    }
  });

  socket.on('joinGame', async ({ gameId, username, avatar }) => {
    let gameData = null;
    if (pool) {
      const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
      gameData = rows[0];
    } else {
      gameData = memGames[gameId];
    }
    if (!gameData) return;

    if (currentRoom && activeRooms[currentRoom]) {
      socket.leave(currentRoom);
      delete activeRooms[currentRoom][socket.id];
      io.to(currentRoom).emit('playerLeft', socket.id);
    }

    currentRoom = gameId;
    socket.join(gameId);

    const displayUser = String(username || `Guest_${socket.id.slice(0, 4)}`).slice(0, 20);
    if (loggedUsername && onlineUsers[loggedUsername.toLowerCase()]) {
      onlineUsers[loggedUsername.toLowerCase()].status = 'In-Game';
      onlineUsers[loggedUsername.toLowerCase()].gameId = gameId;
      onlineUsers[loggedUsername.toLowerCase()].gameTitle = gameData.title;
    }

    if (!activeRooms[gameId]) activeRooms[gameId] = {};
    activeRooms[gameId][socket.id] = {
      id: socket.id,
      username: displayUser,
      avatar: avatar || defaultAvatar,
      x: 0, y: 3, z: 0, rotY: 0
    };

    socket.emit('initWorld', {
      game: gameData,
      players: activeRooms[gameId],
      selfId: socket.id
    });

    socket.to(gameId).emit('playerJoined', activeRooms[gameId][socket.id]);
  });

  socket.on('move', (transform) => {
    if (!currentRoom || !activeRooms[currentRoom]?.[socket.id]) return;
    Object.assign(activeRooms[currentRoom][socket.id], transform);
    socket.to(currentRoom).emit('playerMoved', { id: socket.id, ...transform });
  });

  socket.on('chat', (msg) => {
    if (!currentRoom || !activeRooms[currentRoom]?.[socket.id]) return;
    const sender = activeRooms[currentRoom][socket.id].username;
    const cleanMsg = String(msg).trim().slice(0, 100);
    if (!cleanMsg) return;
    io.to(currentRoom).emit('chatMessage', { id: socket.id, sender, msg: cleanMsg });
  });

  socket.on('disconnect', () => {
    if (currentRoom && activeRooms[currentRoom]) {
      delete activeRooms[currentRoom][socket.id];
      io.to(currentRoom).emit('playerLeft', socket.id);
    }
    if (loggedUsername) {
      delete onlineUsers[loggedUsername.toLowerCase()];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DynoBuild v3 running on port ${PORT}`));
