const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const GameCore = require("./gameCore");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(express.static("."));

// rooms[code] = {
//   code, players: [{socketId, index}], state, startingPlayer
// }
const rooms = {};

// socketId -> { roomCode, playerIndex }
const socketRoom = {};

function makeRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms[code]);
  return code;
}

function sendStateToRoom(room) {
  if (!room.state) return;
  for (const p of room.players) {
    const view = GameCore.viewForPlayer(room.state, p.index);
    io.to(p.socketId).emit("stateUpdate", view);
  }
}

function startNewGame(room) {
  // 每局轮流先手；第一局随机
  let firstPlayer;
  if (typeof room.startingPlayer !== 'number') {
    firstPlayer = Math.floor(Math.random() * 2);
  } else {
    firstPlayer = 1 - room.startingPlayer;
  }
  room.startingPlayer = firstPlayer;
  room.state = GameCore.newGame(firstPlayer);
  for (const p of room.players) {
    io.to(p.socketId).emit("gameStart", { yourIndex: p.index, firstPlayer });
  }
  sendStateToRoom(room);
}

io.on("connection", (socket) => {

  socket.on("createRoom", () => {
    const roomCode = makeRoomCode();
    rooms[roomCode] = {
      code: roomCode,
      players: [{ socketId: socket.id, index: 0 }],
      state: null,
      startingPlayer: undefined
    };
    socketRoom[socket.id] = { roomCode, playerIndex: 0 };
    socket.join(roomCode);
    socket.emit("roomCreated", roomCode);
  });

  socket.on("joinRoom", (roomCode) => {
    roomCode = String(roomCode || "").toUpperCase().trim();
    const room = rooms[roomCode];

    if (!room) {
      socket.emit("joinFailed", "房间不存在");
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("joinFailed", "房间已满");
      return;
    }

    room.players.push({ socketId: socket.id, index: 1 });
    socketRoom[socket.id] = { roomCode, playerIndex: 1 };
    socket.join(roomCode);

    // 通知房间双方已就绪
    io.to(roomCode).emit("roomReady", roomCode);

    // 自动开局
    startNewGame(room);
  });

  // 客户端请求出牌
  socket.on("playCards", (payload) => {
    const link = socketRoom[socket.id];
    if (!link) return;
    const room = rooms[link.roomCode];
    if (!room || !room.state) return;

    const result = GameCore.validatePlay(room.state, link.playerIndex, payload && payload.cardIds);
    if (!result.ok) {
      socket.emit("actionError", result.reason);
      return;
    }
    GameCore.applyPlay(room.state, link.playerIndex, result.cards);
    sendStateToRoom(room);
  });

  // 客户端请求 pass
  socket.on("passTurn", () => {
    const link = socketRoom[socket.id];
    if (!link) return;
    const room = rooms[link.roomCode];
    if (!room || !room.state) return;

    const result = GameCore.validatePass(room.state, link.playerIndex);
    if (!result.ok) {
      socket.emit("actionError", result.reason);
      return;
    }
    GameCore.applyPass(room.state, link.playerIndex);
    sendStateToRoom(room);
  });

  // 再来一局
  socket.on("requestRestart", () => {
    const link = socketRoom[socket.id];
    if (!link) return;
    const room = rooms[link.roomCode];
    if (!room) return;
    if (!room.state || !room.state.gameOver) {
      socket.emit("actionError", "gameNotOver");
      return;
    }
    if (room.players.length < 2) {
      socket.emit("actionError", "opponentLeft");
      return;
    }
    startNewGame(room);
  });

  socket.on("disconnect", () => {
    const link = socketRoom[socket.id];
    if (link) {
      const room = rooms[link.roomCode];
      if (room) {
        room.players = room.players.filter((p) => p.socketId !== socket.id);
        if (room.players.length === 0) {
          delete rooms[link.roomCode];
        } else {
          io.to(link.roomCode).emit("opponentLeft");
        }
      }
      delete socketRoom[socket.id];
    }
  });
});

server.listen(PORT, () => {
  console.log(`Draw2 server running on port ${PORT}`);
});
