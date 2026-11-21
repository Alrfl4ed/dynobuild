const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Database Setup (Render PostgreSQL with In-Memory Fallback) ---
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

const fallbackGames = {
  "default-plaza": {
    id: "default-plaza",
    title: "DynoBuild Crossroads",
    creator: "DynoAdmin",
    blocks: [
      { x: 0, y: -0.5, z: 0, w: 40, h: 1, d: 40, rx: 0, ry: 0, rz: 0, color: "#4ade80", script: "solid" },
      { x: 0, y: 0.5, z: -8, w: 4, h: 1, d: 4, rx: 0, ry: 0, rz: 0, color: "#38bdf8", script: "jumppad" },
      { x: 7, y: 0.5, z: 5, w: 4, h: 1, d: 4, rx: 0, ry: 0, rz: 0, color: "#ef4444", script: "kill" },
      { x: -7, y: 0.5, z: 5, w: 4, h: 1, d: 4, rx: 0, ry: 0, rz: 0, color: "#facc15", script: "checkpoint" }
    ]
  }
};

async function initDB() {
  if (!pool) return console.log("No DATABASE_URL found. Using in-memory storage.");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      creator TEXT NOT NULL,
      blocks JSONB NOT NULL
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*) FROM games');
  if (parseInt(rows[0].count) === 0) {
    const def = fallbackGames["default-plaza"];
    await pool.query(
      'INSERT INTO games (id, title, creator, blocks) VALUES ($1, $2, $3, $4)',
      [def.id, def.title, def.creator, JSON.stringify(def.blocks)]
    );
  }
}
initDB().catch(console.error);

// Track active players per game room: { roomId: { socketId: playerData } }
const activeRooms = {};

// API: Fetch all published games
app.get('/api/games', async (req, res) => {
  try {
    let gamesList = [];
    if (pool) {
      const { rows } = await pool.query('SELECT id, title, creator FROM games');
      gamesList = rows;
    } else {
      gamesList = Object.values(fallbackGames);
    }
    const formatted = gamesList.map(g => ({
      id: g.id,
      title: g.title,
      creator: g.creator,
      playerCount: activeRooms[g.id] ? Object.keys(activeRooms[g.id]).length : 0
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Publish a new game from Studio
app.post('/api/games', async (req, res) => {
  try {
    const { title, creator, blocks } = req.body;
    const id = 'game-' + Date.now();
    const safeTitle = String(title || "Untitled Place").slice(0, 40);
    const safeCreator = String(creator || "Builder").slice(0, 24);

    if (pool) {
      await pool.query(
        'INSERT INTO games (id, title, creator, blocks) VALUES ($1, $2, $3, $4)',
        [id, safeTitle, safeCreator, JSON.stringify(blocks)]
      );
    } else {
      fallbackGames[id] = { id, title: safeTitle, creator: safeCreator, blocks };
    }
    res.json({ success: true, gameId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Multiplayer Socket.io Logic ---
io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('joinGame', async ({ gameId, username, color }) => {
    let gameData = null;
    if (pool) {
      const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
      gameData = rows[0];
    } else {
      gameData = fallbackGames[gameId];
    }
    if (!gameData) return;

    if (currentRoom) {
      socket.leave(currentRoom);
      if (activeRooms[currentRoom]) {
        delete activeRooms[currentRoom][socket.id];
        io.to(currentRoom).emit('playerLeft', socket.id);
      }
    }

    currentRoom = gameId;
    socket.join(gameId);

    if (!activeRooms[gameId]) activeRooms[gameId] = {};
    activeRooms[gameId][socket.id] = {
      id: socket.id,
      username: String(username || `Guest_${socket.id.slice(0, 4)}`).slice(0, 20),
      color: color || "#3b82f6",
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
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DynoBuild running on port ${PORT}`));
