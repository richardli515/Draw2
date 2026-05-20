const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(express.static("."));

const rooms = {};

function makeRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms[code]);
  return code;
}

io.on("connection", (socket) => {
  socket.on("createRoom", () => {
    const roomCode = makeRoomCode();
    rooms[roomCode] = { players: [socket.id] };
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

    room.players.push(socket.id);
    socket.join(roomCode);
    io.to(roomCode).emit("roomReady", roomCode);
  });

  socket.on("disconnect", () => {
    for (const roomCode of Object.keys(rooms)) {
      const room = rooms[roomCode];
      room.players = room.players.filter((id) => id !== socket.id);
      if (room.players.length === 0) delete rooms[roomCode];
    }
  });
});

server.listen(PORT, () => {
  console.log(`Draw2 server running on port ${PORT}`);
});
