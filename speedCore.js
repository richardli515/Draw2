// speedCore.js — Speed 闪电战 共享游戏逻辑
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpeedCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const SUITS = ['♠','♥','♣','♦'];

  function createDeck() {
    const d = [];
    for (const r of RANKS)
      for (const s of SUITS)
        d.push({ rank: r, suit: s, id: r + s + Math.random().toString(36).slice(2, 8) });
    return shuffle(d);
  }

  function shuffle(d) {
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  // A 可接 K 或 2，循环
  function rankIndex(r) { return RANKS.indexOf(r); }

  function adjacent(a, b) {
    if (a === null || b === null) return false;
    const ai = rankIndex(typeof a === 'string' ? a : a.rank);
    const bi = rankIndex(typeof b === 'string' ? b : b.rank);
    if (ai === -1 || bi === -1) return false;
    const diff = Math.abs(ai - bi);
    return diff === 1 || diff === RANKS.length - 1;
  }

  // 创建新游戏 state
  // 每人：15张牌堆 + 5张手牌
  // 桌面：各1张明牌（从剩余牌堆翻出）
  function newGame() {
    const deck = createDeck(); // 52张
    const state = {
      players: [
        { drawPile: [], hand: [] },
        { drawPile: [], hand: [] }
      ],
      piles: [null, null],   // 桌面两堆顶牌
      passFlags: [false, false],
      gameOver: false,
      winner: null
    };

    // 分配：p0 拿 15 张牌堆，p1 拿 15 张牌堆
    state.players[0].drawPile = deck.splice(0, 15);
    state.players[1].drawPile = deck.splice(0, 15);

    // 各摸 5 张手牌
    drawUpToFive(state.players[0]);
    drawUpToFive(state.players[1]);

    // 剩余 52-30-10 = 12 张，取两张作桌面初始牌
    state.piles[0] = deck.splice(0, 1)[0] || null;
    state.piles[1] = deck.splice(0, 1)[0] || null;

    // 剩余牌不用（标准 Speed 用完了52张）
    return state;
  }

  function drawUpToFive(player) {
    while (player.hand.length < 5 && player.drawPile.length > 0) {
      player.hand.push(player.drawPile.shift());
    }
  }

  // 验证并执行出牌。返回 {ok, reason}
  function playCard(state, playerIndex, cardId, pileIndex) {
    if (state.gameOver) return { ok: false, reason: 'gameOver' };
    if (pileIndex !== 0 && pileIndex !== 1) return { ok: false, reason: 'invalid' };

    const p = state.players[playerIndex];
    const cardIdx = p.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return { ok: false, reason: 'cardNotInHand' };

    const card = p.hand[cardIdx];
    const topCard = state.piles[pileIndex];

    // 桌面堆为空或相邻才能放
    if (topCard !== null && !adjacent(card.rank, topCard.rank)) {
      return { ok: false, reason: 'notAdjacent' };
    }

    // 执行：移除手牌，更新桌面，补牌，清 pass 标记
    p.hand.splice(cardIdx, 1);
    state.piles[pileIndex] = card;
    state.passFlags[playerIndex] = false;
    state.passFlags[1 - playerIndex] = false; // 任何人出牌都重置双方 pass
    drawUpToFive(p);

    // 检查胜利：手牌和牌堆都空
    checkWin(state);
    return { ok: true };
  }

  // 手动 pass
  function pass(state, playerIndex) {
    if (state.gameOver) return { ok: false, reason: 'gameOver' };
    state.passFlags[playerIndex] = true;

    // 双方都 pass → 翻新牌到桌面
    if (state.passFlags[0] && state.passFlags[1]) {
      flipNewCards(state);
      state.passFlags = [false, false];
    }
    return { ok: true };
  }

  // 双方都 pass 时，从各自牌堆顶翻一张到桌面
  function flipNewCards(state) {
    for (let i = 0; i < 2; i++) {
      // 优先从 p0/p1 牌堆各取一张
      const src = state.players[i].drawPile;
      if (src.length > 0) {
        state.piles[i] = src.shift();
        drawUpToFive(state.players[i]);
      }
    }
    checkWin(state);
  }

  function checkWin(state) {
    for (let i = 0; i < 2; i++) {
      const p = state.players[i];
      if (p.hand.length === 0 && p.drawPile.length === 0) {
        state.gameOver = true;
        state.winner = i;
        return;
      }
    }
  }

  // 给某玩家的视图（隐藏对手手牌）
  function viewForPlayer(state, viewerIndex) {
    const other = 1 - viewerIndex;
    return {
      piles: state.piles,
      passFlags: state.passFlags,
      gameOver: state.gameOver,
      winner: state.winner,
      you: {
        index: viewerIndex,
        hand: state.players[viewerIndex].hand,
        deckCount: state.players[viewerIndex].drawPile.length
      },
      opponent: {
        index: other,
        handCount: state.players[other].hand.length,
        deckCount: state.players[other].drawPile.length
      }
    };
  }

  return { RANKS, SUITS, createDeck, shuffle, adjacent, rankIndex, newGame, playCard, pass, drawUpToFive, viewForPlayer };
});
