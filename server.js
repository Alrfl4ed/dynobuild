const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store (Replace with Render PostgreSQL queries for permanent storage)
const publishedGames = {
  "default-plaza": {
    id: "default-plaza",
    title: "Crossroads Hangout",
    creator: "System",
    blocks: [
      { x: 0, y: -0.5, z: 0, w: 40, h: 1, d: 40, color: "#4ade80", type: "solid" },
      { x: 0, y: 1.5, z: -8, w: 6, h: 3, d: 2, color: "#ef4444", type: "solid" },
      { x: 6, y: 0.5, z: 5, w: 3, h: 1, d: 3, color: "#facc15", type: "kill" }
    ]
  }
};

// Track active players per game room: { roomId: { socketId: playerData } }
const activeRooms = {};

// API: Fetch all published games for the Lobby
app.get('/api/games', (req, res) => {
  const list = Object.values(publishedGames).map(g => ({
    id: g.id,
    title: g.title,
    creator: g.creator,
    playerCount: activeRooms[g.id] ? Object.keys(activeRooms[g.id]).length : 0
  }));
  res.json(list);
});

// API: Publish a new game from Studio
app.post('/api/games', (req, res) => {
  const { title, creator, blocks } = req.body;
  const id = 'game-' + Date.now();
  publishedGames[id] = { id, title: title || "Untitled Place", creator: creator || "Builder", blocks };
  res.json({ success: true, gameId: id });
});

// Multiplayer WebSocket Logic
io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('joinGame', ({ gameId, username, color }) => {
    const gameData = publishedGames[gameId];
    if (!gameData) return;

    if (currentRoom) socket.leave(currentRoom);
    currentRoom = gameId;
    socket.join(gameId);

    if (!activeRooms[gameId]) activeRooms[gameId] = {};
    activeRooms[gameId][socket.id] = {
      id: socket.id,
      username: username || `Guest_${socket.id.slice(0, 4)}`,
      color: color || "#3b82f6",
      x: 0, y: 3, z: 0, rotY: 0
    };

    // Send map geometry and existing players to the joining client
    socket.emit('initWorld', {
      game: gameData,
      players: activeRooms[gameId],
      selfId: socket.id
    });

    // Notify others in the same game room
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
    io.to(currentRoom).emit('chatMessage', { sender, msg: String(msg).slice(0, 120) });
  });

  socket.on('disconnect', () => {
    if (currentRoom && activeRooms[currentRoom]) {
      delete activeRooms[currentRoom][socket.id];
      io.to(currentRoom).emit('playerLeft', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Platform running on port ${PORT}`));
