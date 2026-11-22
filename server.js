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

// Neon PostgreSQL Database Connection
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// Initialize Database Tables and ensure they exist before accepting traffic
async function initDB() {
  if (!pool) {
    console.log("⚠️ Running in memory-only mode (No DATABASE_URL provided).");
    return;
  }
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          dybux INTEGER DEFAULT 100,
          avatar JSONB DEFAULT '{}',
          badges TEXT[] DEFAULT ARRAY['og']
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS games (
          id SERIAL PRIMARY KEY,
          title VARCHAR(100) NOT NULL,
          creator VARCHAR(50) NOT NULL,
          blocks JSONB DEFAULT '[]',
          customCode TEXT DEFAULT '',
          thumbColor VARCHAR(20) DEFAULT '#00a2ff',
          visits INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log("✅ Neon PostgreSQL database tables verified/initialized successfully.");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("❌ Database initialization error:", err.message);
  }
}

// --- API ROUTES ---

// Register
app.post('/api/register', async (req, res) => {
  const username = req.body.username ? String(req.body.username).trim() : '';
  const password = req.body.password ? String(req.body.password).trim() : '';
  
  if (!username || username.length < 3 || !password) {
    return res.status(400).json({ success: false, error: "Username must be at least 3 characters and password is required." });
  }

  try {
    if (pool) {
      const existing = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ success: false, error: "Username already taken." });
      }

      const defaultAvatar = { skin: '#fde047', shirt: '#3b82f6', pants: '#16a34a', hat: 'none', face: 'smile' };
      const insert = await pool.query(
        'INSERT INTO users (username, password, dybux, avatar, badges) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [username, password, 100, JSON.stringify(defaultAvatar), ['og']]
      );
      console.log(`[Auth] Registered new user: '${username}'`);
      return res.json({ success: true, user: insert.rows[0] });
    } else {
      return res.json({ success: true, user: { username, dybux: 100, avatar: {}, badges: ['og'] } });
    }
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ success: false, error: "Database error: " + err.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const username = req.body.username ? String(req.body.username).trim() : '';
  const password = req.body.password ? String(req.body.password).trim() : '';

  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Missing username or password." });
  }

  try {
    if (pool) {
      const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
      if (result.rows.length === 0) {
        console.log(`[Auth] Login failed: User '${username}' not found.`);
        return res.status(401).json({ success: false, error: "Incorrect username or password." });
      }

      if (result.rows[0].password !== password) {
        console.log(`[Auth] Login failed for '${username}': Password mismatch.`);
        return res.status(401).json({ success: false, error: "Incorrect username or password." });
      }

      console.log(`[Auth] Successful login for '${username}'`);
      return res.json({ success: true, user: result.rows[0] });
    } else {
      return res.json({ success: true, user: { username, dybux: 100, avatar: {}, badges: ['og'] } });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, error: "Database error: " + err.message });
  }
});

// Save Avatar
app.post('/api/avatar', async (req, res) => {
  const { username, avatar } = req.body;
  if (!username) return res.status(400).json({ success: false, error: "Not logged in" });

  try {
    if (pool) {
      await pool.query('UPDATE users SET avatar = $1 WHERE LOWER(username) = LOWER($2)', [JSON.stringify(avatar), String(username).trim()]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Avatar save error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// Get Profile
app.get('/api/profile/:username', async (req, res) => {
  const target = req.params.username;
  try {
    if (pool) {
      const result = await pool.query('SELECT username, dybux, avatar, badges FROM users WHERE LOWER(username) = LOWER($1)', [target]);
      if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
      return res.json(result.rows[0]);
    }
    res.json({ username: target, dybux: 100, badges: ['og'] });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Complete Quest & Update Dybux Balance
app.post('/api/complete-quest', async (req, res) => {
  const { username, questId, reward } = req.body;
  if (!username) {
    return res.status(400).json({ success: false, error: "Not logged in" });
  }

  const cleanUser = String(username).trim();
  const rewardAmount = parseInt(reward, 10) || 0;

  try {
    if (pool) {
      const userRes = await pool.query('SELECT dybux FROM users WHERE LOWER(username) = LOWER($1)', [cleanUser]);
      if (userRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: "User not found" });
      }

      const currentDybux = userRes.rows[0].dybux || 100;
      const newDybux = currentDybux + rewardAmount;

      await pool.query('UPDATE users SET dybux = $1 WHERE LOWER(username) = LOWER($2)', [newDybux, cleanUser]);

      return res.json({ success: true, dybux: newDybux });
    } else {
      return res.json({ success: true, dybux: 100 + rewardAmount });
    }
  } catch (err) {
    console.error("Error updating quest reward:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// Get Games
app.get('/api/games', async (req, res) => {
  try {
    if (pool) {
      const games = await pool.query('SELECT id, title, creator, thumbColor, visits, created_at FROM games ORDER BY id DESC');
      return res.json(games.rows);
    }
    res.json([]);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
});

// Publish Game
app.post('/api/games', async (req, res) => {
  const { title, creator, blocks, customCode, thumbColor } = req.body;
  try {
    if (pool) {
      const insert = await pool.query(
        'INSERT INTO games (title, creator, blocks, customCode, thumbColor, visits) VALUES ($1, $2, $3, $4, $5, 0) RETURNING id',
        [title || 'Untitled', creator || 'Builder', JSON.stringify(blocks || []), customCode || '', thumbColor || '#00a2ff']
      );
      return res.json({ success: true, gameId: insert.rows[0].id });
    }
    res.json({ success: true, gameId: 1 });
  } catch (err) {
    console.error("Publish error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// --- SOCKET.IO MULTIPLAYER ---
io.on('connection', (socket) => {
  socket.on('joinGame', async ({ gameId, username }) => {
    socket.join(`game_${gameId}`);
    try {
      if (pool) {
        const gameRes = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
        if (gameRes.rows.length > 0) {
          socket.emit('initWorld', { game: gameRes.rows[0] });
          await pool.query('UPDATE games SET visits = visits + 1 WHERE id = $1', [gameId]);
        }
      }
    } catch (err) {
      console.error("Join game error:", err);
    }
  });

  socket.on('chat', (msg) => {
    io.emit('chatMessage', { sender: 'Player', msg: String(msg).substring(0, 150) });
  });

  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;

// Start server only after database initialization attempt
initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 DynoBuild server running on port ${PORT}`);
  });
});
