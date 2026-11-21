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

// --- Database Setup (Neon / PostgreSQL with In-Memory Fallback) ---
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
      { x: 0, y: -0.5, z: 0, w: 40, h: 1, d: 40, color: "#4ade80", script: "solid" },
      { x: 0, y: 0.5, z: -8, w: 4, h: 1, d: 4, color: "#38bdf8", script: "jumppad" },
      { x: 7, y: 0.5, z: 5, w: 4, h: 1, d: 4, color: "#ef4444", script: "kill" },
      { x: -7, y: 0.5, z: 5, w: 4, h: 1, d: 4, color: "#facc15", script: "checkpoint" }
    ],
    visits: 1337,
    created_at: new Date().toISOString(),
    gamepasses: [],
    custom_code: ''
  }
};

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}

function filterChat(msg) {
  const badWords = ['badword1', 'badword2'];
  let clean = String(msg).trim().slice(0, 100);
  badWords.forEach(word => {
    const regex = new RegExp(word, 'gi');
    clean = clean.replace(regex, '####');
  });
  return clean;
}

function computeBadges(username, existingBadges = [], totalVisits = 0) {
  const set = new Set(Array.isArray(existingBadges) ? existingBadges : []);
  const lower = String(username || '').toLowerCase();
  if (lower === '7lol7' || lower === 'dynobuild') set.add('admin');
  if (new Date() < new Date('2026-12-01')) set.add('og');
  if (totalVisits >= 1000) set.add('developer');
  return [...set];
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
  // Upgrade existing users table safely
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dybux INT DEFAULT 100;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_daily TEXT DEFAULT '';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS badges JSONB DEFAULT '[]';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      creator TEXT NOT NULL,
      thumb_color TEXT DEFAULT '#2563eb',
      blocks JSONB NOT NULL
    );
  `);
  // Upgrade existing games table safely
  await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS visits INT DEFAULT 0;`);
  await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
  await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS gamepasses JSONB DEFAULT '[]';`);
  await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS custom_code TEXT DEFAULT '';`);

  // Always ensure DynoBuild Crossroads test game exists
  const def = memGames["default-plaza"];
  await pool.query(
    `INSERT INTO games (id, title, creator, thumb_color, blocks, visits) 
     VALUES ($1, $2, $3, $4, $5, $6) 
     ON CONFLICT (id) DO NOTHING`,
    [def.id, def.title, def.creator, def.thumbColor, JSON.stringify(def.blocks), def.visits]
  );
  console.log("Database tables verified and test game restored.");
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

app.post('/api/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim().replace(/[^a-zA-Z0-9_]/g, '').slice(0, 18);
    const password = String(req.body.password || '');
    if (username.length < 3 || password.length < 3) {
      return res.status(400).json({ error: "Username and password must be at least 3 characters." });
    }
    const existing = await getUser(username);
    if (existing) return res.status(400).json({ error: "Username is already taken." });

    const initialBadges = computeBadges(username, [], 0);

    if (pool) {
      await pool.query(
        'INSERT INTO users (username, pass_hash, avatar, friends, dybux, badges) VALUES ($1, $2, $3, $4, $5, $6)',
        [username, hashPassword(password), JSON.stringify(defaultAvatar), JSON.stringify([]), 100, JSON.stringify(initialBadges)]
      );
    } else {
      memUsers[username.toLowerCase()] = {
        username,
        pass_hash: hashPassword(password),
        avatar: { ...defaultAvatar },
        friends: [],
        dybux: 100,
        badges: initialBadges,
        banned: false
      };
    }
    res.json({ success: true, user: { username, avatar: defaultAvatar, friends: [], dybux: 100, badges: initialBadges } });
  } catch (err) {
    console.error("Register error:", err);
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
    if (user.banned) {
      return res.status(403).json({ error: "This account has been banned." });
    }

    let totalVisits = 0;
    if (pool) {
      const { rows } = await pool.query('SELECT SUM(visits) as total FROM games WHERE LOWER(creator) = LOWER($1)', [user.username]);
      totalVisits = parseInt(rows[0]?.total || 0);
    }
    const updatedBadges = computeBadges(user.username, user.badges, totalVisits);

    res.json({
      success: true,
      user: {
        username: user.username,
        avatar: user.avatar,
        friends: user.friends || [],
        dybux: user.dybux ?? 100,
        badges: updatedBadges
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/daily-reward', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await getUser(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    const today = new Date().toISOString().slice(0, 10);
    if (user.last_daily === today) {
      return res.status(400).json({ error: "Already claimed today's Dybux!" });
    }

    const newDybux = (user.dybux ?? 100) + 50;
    if (pool) {
      await pool.query('UPDATE users SET dybux = $1, last_daily = $2 WHERE username = $3', [newDybux, today, user.username]);
    } else {
      user.dybux = newDybux;
      user.last_daily = today;
    }
    res.json({ success: true, dybux: newDybux });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/profile/:username', async (req, res) => {
  try {
    const target = await getUser(req.params.username);
    if (!target) return res.status(404).json({ error: "User not found" });

    let totalVisits = 0;
    if (pool) {
      const { rows } = await pool.query('SELECT SUM(visits) as total FROM games WHERE LOWER(creator) = LOWER($1)', [target.username]);
      totalVisits = parseInt(rows[0]?.total || 0);
    }
    const badges = computeBadges(target.username, target.badges, totalVisits);

    res.json({
      username: target.username,
      avatar: target.avatar,
      friends: target.friends || [],
      dybux: target.dybux ?? 100,
      badges
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/ban', async (req, res) => {
  try {
    const { adminUser, targetUser } = req.body;
    const cleanAdmin = String(adminUser || '').toLowerCase();
    if (cleanAdmin !== '7lol7' && cleanAdmin !== 'dynobuild') {
      return res.status(403).json({ error: "Unauthorized admin action." });
    }
    if (pool) {
      await pool.query('UPDATE users SET banned = true WHERE LOWER(username) = LOWER($1)', [targetUser]);
    } else {
      const u = memUsers[String(targetUser).toLowerCase()];
      if (u) u.banned = true;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const onlineUsers = {};
const activeRooms = {};

app.get('/api/games', async (req, res) => {
  try {
    let gamesList = [];
    if (pool) {
      const { rows } = await pool.query('SELECT id, title, creator, thumb_color, visits, created_at FROM games');
      gamesList = rows;
    } else {
      gamesList = Object.values(memGames);
    }
    const formatted = gamesList.map(g => ({
      id: g.id,
      title: g.title,
      creator: g.creator,
      thumbColor: g.thumb_color || g.thumbColor || "#2563eb",
      visits: g.visits || 0,
      createdAt: g.created_at || g.createdAt,
      playerCount: activeRooms[g.id] ? Object.keys(activeRooms[g.id]).length : 0
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/games', async (req, res) => {
  try {
    const { title, creator, blocks, gamepasses, customCode, thumbColor } = req.body;
    const id = 'game-' + Date.now();
    const safeTitle = String(title || "Untitled Place").slice(0, 40);
    const safeCreator = String(creator || "Builder").slice(0, 24);
    const color = thumbColor || "#2563eb";

    if (pool) {
      await pool.query(
        'INSERT INTO games (id, title, creator, thumb_color, blocks, visits, gamepasses, custom_code) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [id, safeTitle, safeCreator, color, JSON.stringify(blocks || []), 0, JSON.stringify(gamepasses || []), customCode || '']
      );
    } else {
      memGames[id] = { id, title: safeTitle, creator: safeCreator, thumbColor: color, blocks: blocks || [], visits: 0, gamepasses: gamepasses || [], customCode: customCode || '' };
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
  });

  socket.on('joinGame', async ({ gameId, username, avatar }) => {
    let gameData = null;
    if (pool) {
      const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
      gameData = rows[0];
      if (gameData) {
        await pool.query('UPDATE games SET visits = COALESCE(visits, 0) + 1 WHERE id = $1', [gameId]);
        gameData.visits = (gameData.visits || 0) + 1;
      }
    } else {
      gameData = memGames[gameId];
      if (gameData) gameData.visits = (gameData.visits || 0) + 1;
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
    if (!activeRooms[gameId]) activeRooms[gameId] = {};
    activeRooms[gameId][socket.id] = {
      id: socket.id,
      username: displayUser,
      avatar: avatar || defaultAvatar,
      x: 0, y: 3, z: 0, rotY: 0
    };

    socket.emit('initWorld', {
      game: {
        id: gameData.id,
        title: gameData.title,
        creator: gameData.creator,
        thumbColor: gameData.thumb_color || gameData.thumbColor,
        blocks: gameData.blocks,
        customCode: gameData.custom_code || gameData.customCode || ''
      },
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
    if (sender.startsWith('Guest_')) return; // Guests cannot chat
    const cleanMsg = filterChat(msg);
    if (!cleanMsg) return;
    io.to(currentRoom).emit('chatMessage', { id: socket.id, sender, msg: cleanMsg });
  });

  socket.on('disconnect', () => {
    if (currentRoom && activeRooms[currentRoom]) {
      delete activeRooms[currentRoom][socket.id];
      io.to(currentRoom).emit('playerLeft', socket.id);
    }
    if (loggedUsername) delete onlineUsers[loggedUsername.toLowerCase()];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DynoBuild platform running on port ${PORT}`));
