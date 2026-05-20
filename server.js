const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const GameCore = require("./gameCore");
const SpeedCore = require("./speedCore");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
app.use(express.static("."));

// ─── Draw2 房间 ───────────────────────────────────────────────
const rooms = {};
const socketRoom = {};

function makeCode(existing) {
  let code;
  do { code = Math.random().toString(36).substring(2, 6).toUpperCase(); }
  while (existing[code]);
  return code;
}

function sendDraw2State(room) {
  if (!room.state) return;
  for (const p of room.players) {
    io.to(p.socketId).emit("stateUpdate", GameCore.viewForPlayer(room.state, p.index));
  }
}

function startDraw2Game(room) {
  let first = typeof room.startingPlayer !== 'number'
    ? Math.floor(Math.random() * 2)
    : 1 - room.startingPlayer;
  room.startingPlayer = first;
  room.state = GameCore.newGame(first);
  for (const p of room.players)
    io.to(p.socketId).emit("gameStart", { yourIndex: p.index, firstPlayer: first });
  sendDraw2State(room);
}

// ─── Speed 房间 ───────────────────────────────────────────────
const speedRooms = {};
const socketSpeedRoom = {};

function sendSpeedState(room) {
  if (!room.state) return;
  for (const p of room.players)
    io.to(p.socketId).emit("speed:stateUpdate", SpeedCore.viewForPlayer(room.state, p.index));
}

function startSpeedGame(room) {
  room.state = SpeedCore.newGame();
  for (const p of room.players) {
    io.to(p.socketId).emit("speed:gameStart", {
      yourIndex: p.index,
      view: SpeedCore.viewForPlayer(room.state, p.index)
    });
  }
}

// ─── Socket 事件 ─────────────────────────────────────────────
io.on("connection", (socket) => {

  // ── Draw2 ──
  socket.on("createRoom", () => {
    const code = makeCode(rooms);
    rooms[code] = { code, players: [{ socketId: socket.id, index: 0 }], state: null, startingPlayer: undefined };
    socketRoom[socket.id] = { roomCode: code, playerIndex: 0 };
    socket.join(code);
    socket.emit("roomCreated", code);
  });

  socket.on("joinRoom", (roomCode) => {
    roomCode = String(roomCode || "").toUpperCase().trim();
    const room = rooms[roomCode];
    if (!room) { socket.emit("joinFailed", "房间不存在"); return; }
    if (room.players.length >= 2) { socket.emit("joinFailed", "房间已满"); return; }
    if (room.players.some(p => p.socketId === socket.id)) { socket.emit("joinFailed", "不能加入自己创建的房间"); return; }
    room.players.push({ socketId: socket.id, index: 1 });
    socketRoom[socket.id] = { roomCode, playerIndex: 1 };
    socket.join(roomCode);
    io.to(roomCode).emit("roomReady", roomCode);
    startDraw2Game(room);
  });

  socket.on("playCards", (payload) => {
    const link = socketRoom[socket.id];
    if (!link) return;
    const room = rooms[link.roomCode];
    if (!room || !room.state) return;
    const result = GameCore.validatePlay(room.state, link.playerIndex, payload && payload.cardIds);
    if (!result.ok) { socket.emit("actionError", result.reason); return; }
    GameCore.applyPlay(room.state, link.playerIndex, result.cards);
    sendDraw2State(room);
  });

  socket.on("passTurn", () => {
    const link = socketRoom[socket.id];
    if (!link) return;
    const room = rooms[link.roomCode];
    if (!room || !room.state) return;
    const result = GameCore.validatePass(room.state, link.playerIndex);
    if (!result.ok) { socket.emit("actionError", result.reason); return; }
    GameCore.applyPass(room.state, link.playerIndex);
    sendDraw2State(room);
  });

  socket.on("requestRestart", () => {
    const link = socketRoom[socket.id];
    if (!link) return;
    const room = rooms[link.roomCode];
    if (!room || !room.state || !room.state.gameOver) { socket.emit("actionError", "gameNotOver"); return; }
    if (room.players.length < 2) { socket.emit("actionError", "opponentLeft"); return; }
    startDraw2Game(room);
  });

  // ── Speed ──
  socket.on("speed:createRoom", () => {
    const code = makeCode(speedRooms);
    speedRooms[code] = { code, players: [{ socketId: socket.id, index: 0 }], state: null };
    socketSpeedRoom[socket.id] = { roomCode: code, playerIndex: 0 };
    socket.join("speed:" + code);
    socket.emit("speed:roomCreated", code);
  });

  socket.on("speed:joinRoom", (roomCode) => {
    roomCode = String(roomCode || "").toUpperCase().trim();
    const room = speedRooms[roomCode];
    if (!room) { socket.emit("speed:joinFailed", "房间不存在"); return; }
    if (room.players.length >= 2) { socket.emit("speed:joinFailed", "房间已满"); return; }
    if (room.players.some(p => p.socketId === socket.id)) { socket.emit("speed:joinFailed", "不能加入自己创建的房间"); return; }
    room.players.push({ socketId: socket.id, index: 1 });
    socketSpeedRoom[socket.id] = { roomCode, playerIndex: 1 };
    socket.join("speed:" + roomCode);
    io.to("speed:" + roomCode).emit("speed:roomReady");
    startSpeedGame(room);
  });

  socket.on("speed:playCard", (payload) => {
    const link = socketSpeedRoom[socket.id];
    if (!link) return;
    const room = speedRooms[link.roomCode];
    if (!room || !room.state || room.state.gameOver) return;
    const { cardId, pileIndex } = payload || {};
    const result = SpeedCore.playCard(room.state, link.playerIndex, cardId, pileIndex);
    if (!result.ok) { socket.emit("speed:playFailed", result.reason); return; }
    if (room.state.gameOver) {
      for (const p of room.players)
        io.to(p.socketId).emit("speed:gameOver", { winner: room.state.winner });
    }
    sendSpeedState(room);
  });

  socket.on("speed:pass", () => {
    const link = socketSpeedRoom[socket.id];
    if (!link) return;
    const room = speedRooms[link.roomCode];
    if (!room || !room.state || room.state.gameOver) return;
    SpeedCore.pass(room.state, link.playerIndex);
    if (room.state.gameOver) {
      for (const p of room.players)
        io.to(p.socketId).emit("speed:gameOver", { winner: room.state.winner });
    }
    sendSpeedState(room);
  });

  socket.on("speed:restart", () => {
    const link = socketSpeedRoom[socket.id];
    if (!link) return;
    const room = speedRooms[link.roomCode];
    if (!room || !room.state || !room.state.gameOver) return;
    if (room.players.length < 2) { socket.emit("speed:joinFailed", "对手已离开"); return; }
    startSpeedGame(room);
  });

  // ── 断线清理 ──
  socket.on("disconnect", () => {
    const link = socketRoom[socket.id];
    if (link) {
      const room = rooms[link.roomCode];
      if (room) {
        room.players = room.players.filter(p => p.socketId !== socket.id);
        if (room.players.length === 0) delete rooms[link.roomCode];
        else io.to(link.roomCode).emit("opponentLeft");
      }
      delete socketRoom[socket.id];
    }
    const slink = socketSpeedRoom[socket.id];
    if (slink) {
      const room = speedRooms[slink.roomCode];
      if (room) {
        room.players = room.players.filter(p => p.socketId !== socket.id);
        if (room.players.length === 0) delete speedRooms[slink.roomCode];
        else io.to("speed:" + slink.roomCode).emit("speed:opponentLeft");
      }
      delete socketSpeedRoom[socket.id];
    }
  });
});

server.listen(PORT, () => console.log(`Draw2+Speed server running on port ${PORT}`));
