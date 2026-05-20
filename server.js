import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','小王','大王'];
const NORMAL_RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const STRAIGHT_RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['♠','♥','♣','♦'];

const rooms = new Map();

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const fullPath = path.join(__dirname, url);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(fullPath);
    const type = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.js' ? 'text/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8'
      : 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

function send(ws, type, payload = {}) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function makeRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createDeck() {
  const deck = [];
  for (const rank of NORMAL_RANKS) {
    for (const suit of SUITS) {
      deck.push({ rank, suit, id: `${rank}${suit}-${Math.random().toString(36).slice(2)}` });
    }
  }
  deck.push({ rank: '小王', suit: '', id: `小王-${Math.random().toString(36).slice(2)}` });
  deck.push({ rank: '大王', suit: '', id: `大王-${Math.random().toString(36).slice(2)}` });
  return shuffle(deck);
}

function drawToTwo(game, player) {
  while (player.hand.length < 2 && game.deck.length > 0) {
    player.hand.push(game.deck.shift());
  }
}

function newGame() {
  const game = {
    deck: createDeck(),
    players: [
      { hand: [], pile: [] },
      { hand: [], pile: [] },
    ],
    currentPlayer: 0,
    lastPlay: null,
    lastWinner: null,
    message: '玩家 1 先手。',
    gameOver: false,
  };

  drawToTwo(game, game.players[0]);
  drawToTwo(game, game.players[1]);
  return game;
}

function rankValue(rank) {
  return RANKS.indexOf(rank);
}

function straightValue(cards) {
  if (cards.length !== 2) return -1;
  const values = cards.map((card) => STRAIGHT_RANKS.indexOf(card.rank));
  if (values.includes(-1)) return -1;
  values.sort((a, b) => a - b);
  return values[1] - values[0] === 1 ? values[1] : -1;
}

function isKingBomb(cards) {
  return cards.length === 2
    && cards.some((card) => card.rank === '小王')
    && cards.some((card) => card.rank === '大王');
}

function playType(cards) {
  if (isKingBomb(cards)) return 'kingbomb';
  if (cards.length === 1) return 'single';
  if (cards.length === 2 && cards[0].rank === cards[1].rank) return 'pair';
  if (straightValue(cards) !== -1) return 'straight';
  return null;
}

function playValue(cards) {
  if (isKingBomb(cards)) return 999;
  if (playType(cards) === 'straight') return straightValue(cards);
  return rankValue(cards[0].rank);
}

function canBeat(lastPlay, cards) {
  const type = playType(cards);
  if (!type) return false;
  if (!lastPlay) return true;
  if (isKingBomb(cards)) return true;
  if (isKingBomb(lastPlay.cards)) return false;
  if (type !== playType(lastPlay.cards)) return false;
  return playValue(cards) > playValue(lastPlay.cards);
}

function typeLabel(type) {
  return type === 'single' ? '单张'
    : type === 'pair' ? '对子'
    : type === 'straight' ? '顺子'
    : type === 'kingbomb' ? '王炸'
    : '非法牌型';
}

function cardText(card) {
  return `${card.rank}${card.suit || ''}`;
}

function getCardsByIds(player, cardIds) {
  return cardIds.map((id) => player.hand.find((card) => card.id === id)).filter(Boolean);
}

function executePlay(room, playerIndex, cardIds) {
  const game = room.game;

  if (game.gameOver) return { ok: false, error: '游戏已经结束。' };
  if (game.currentPlayer !== playerIndex) return { ok: false, error: '还没轮到你。' };

  const player = game.players[playerIndex];
  const cards = getCardsByIds(player, cardIds);

  if (cards.length !== cardIds.length || cards.length === 0 || cards.length > 2) {
    return { ok: false, error: '请选择 1 或 2 张手牌。' };
  }

  if (!playType(cards)) return { ok: false, error: '非法牌型。' };
  if (!canBeat(game.lastPlay, cards)) return { ok: false, error: '压不上。' };

  player.hand = player.hand.filter((card) => !cardIds.includes(card.id));
  player.pile.push(...cards);

  game.lastPlay = { playerIndex, cards };
  game.lastWinner = playerIndex;

  drawToTwo(game, player);
  checkEnd(room, playerIndex);

  if (!game.gameOver) {
    game.currentPlayer = 1 - playerIndex;
    game.message = `玩家 ${playerIndex + 1} 出了 ${cards.map(cardText).join(' ')}（${typeLabel(playType(cards))}）。`;
  }

  return { ok: true };
}

function executePass(room, playerIndex) {
  const game = room.game;

  if (game.gameOver) return { ok: false, error: '游戏已经结束。' };
  if (game.currentPlayer !== playerIndex) return { ok: false, error: '还没轮到你。' };
  if (!game.lastPlay) return { ok: false, error: '空桌不能 Pass。' };

  const winner = game.lastWinner;
  game.lastPlay = null;
  game.currentPlayer = winner;
  game.message = `玩家 ${playerIndex + 1} Pass。清桌，玩家 ${winner + 1} 继续先手。`;
  return { ok: true };
}

function checkEnd(room, lastPlayerIndex) {
  const game = room.game;
  if (game.deck.length !== 0) return;
  if (game.players[lastPlayerIndex].hand.length !== 0) return;

  const otherIndex = 1 - lastPlayerIndex;
  const winner = game.players[lastPlayerIndex];
  const loser = game.players[otherIndex];

  if (loser.hand.length > 0) {
    winner.pile.push(...loser.hand);
    loser.hand = [];
  }

  game.gameOver = true;

  const p1 = game.players[0].pile.length;
  const p2 = game.players[1].pile.length;

  if (p1 > p2) game.message = `游戏结束：玩家 1 获胜！${p1}:${p2}`;
  else if (p2 > p1) game.message = `游戏结束：玩家 2 获胜！${p2}:${p1}`;
  else game.message = `游戏结束：平局 ${p1}:${p2}`;
}

function viewFor(room, playerIndex, extra = {}) {
  return {
    roomCode: room.code,
    playerIndex,
    game: {
      deckCount: room.game.deck.length,
      players: room.game.players.map((player, index) => ({
        hand: index === playerIndex ? player.hand : [],
        handCount: player.hand.length,
        pileCount: player.pile.length,
      })),
      currentPlayer: room.game.currentPlayer,
      lastPlay: room.game.lastPlay,
      lastWinner: room.game.lastWinner,
      message: room.game.message,
      gameOver: room.game.gameOver,
    },
    ...extra,
  };
}

function broadcast(room, type, extra = {}) {
  room.players.forEach((player) => {
    if (player?.ws) send(player.ws, type, viewFor(room, player.index, extra));
  });
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.playerIndex = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, 'error', { error: '消息格式错误。' });
      return;
    }

    if (msg.type === 'host') {
      const code = makeRoomCode();
      const room = {
        code,
        game: newGame(),
        players: [{ ws, index: 0 }, null],
        createdAt: Date.now(),
      };

      rooms.set(code, room);
      ws.roomCode = code;
      ws.playerIndex = 0;

      send(ws, 'state', viewFor(room, 0, { notice: `房间已创建：${code}` }));
      return;
    }

    if (msg.type === 'join') {
      const code = String(msg.roomCode || '').trim();
      const room = rooms.get(code);

      if (!room) {
        send(ws, 'error', { error: '房间不存在。' });
        return;
      }

      if (room.players[1]) {
        send(ws, 'error', { error: '房间已满。' });
        return;
      }

      room.players[1] = { ws, index: 1 };
      ws.roomCode = code;
      ws.playerIndex = 1;

      broadcast(room, 'state', { notice: `玩家 2 已加入房间：${code}` });
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room || ws.playerIndex === null) {
      send(ws, 'error', { error: '你还没有进入房间。' });
      return;
    }

    if (msg.type === 'play') {
      const result = executePlay(room, ws.playerIndex, msg.cardIds || []);
      if (!result.ok) send(ws, 'error', { error: result.error });
      broadcast(room, 'state');
      return;
    }

    if (msg.type === 'pass') {
      const result = executePass(room, ws.playerIndex);
      if (!result.ok) send(ws, 'error', { error: result.error });
      broadcast(room, 'state');
      return;
    }

    if (msg.type === 'restart') {
      room.game = newGame();
      broadcast(room, 'state', { notice: '游戏已重新开始。' });
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room || ws.playerIndex === null) return;

    if (room.players[ws.playerIndex]?.ws === ws) {
      room.players[ws.playerIndex] = null;
    }

    const remaining = room.players.find(Boolean);
    if (!remaining) {
      rooms.delete(room.code);
    } else {
      broadcast(room, 'state', { notice: `玩家 ${ws.playerIndex + 1} 已离开。` });
    }
  });
});

// Clean up abandoned rooms every 30 minutes.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const hasPlayers = room.players.some((player) => player?.ws?.readyState === player.ws.OPEN);
    if (!hasPlayers || now - room.createdAt > 6 * 60 * 60 * 1000) {
      rooms.delete(code);
    }
  }
}, 30 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Draw2 Render server listening on ${PORT}`);
});
