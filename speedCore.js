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
    const a = d.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function rankIndex(r) { return RANKS.indexOf(r); }

  // K→A→2→3 完全循环，±1 相邻
  function adjacent(a, b) {
    if (a === null || b === null) return false;
    const ai = rankIndex(typeof a === 'string' ? a : a.rank);
    const bi = rankIndex(typeof b === 'string' ? b : b.rank);
    if (ai === -1 || bi === -1) return false;
    const diff = Math.abs(ai - bi);
    return diff === 1 || diff === RANKS.length - 1;
  }

  // state 结构：
  //   players[i].drawPile  — 翻牌牌堆
  //   players[i].hand      — 手牌（最多5张）
  //   piles[i]             — 桌面堆顶牌（null=空）
  //   pileStacks[i]        — 桌面堆顶牌下面的历史牌（底部在index 0）
  //   passFlags[i]         — 是否已 pass
  function newGame() {
    const deck = createDeck(); // 52张
    const state = {
      players: [
        { handPile: [], hand: [], drawPile: [] },
        { handPile: [], hand: [], drawPile: [] }
      ],
      piles: [null, null],
      pileStacks: [[], []],
      passFlags: [false, false],
      gameOver: false,
      winner: null
    };

    // 每人 15 张补手牌堆
    state.players[0].handPile = deck.splice(0, 15);
    state.players[1].handPile = deck.splice(0, 15);
    // 各摸 5 张初始手牌（从 handPile）
    drawUpToFive(state.players[0]);
    drawUpToFive(state.players[1]);

    // 桌面初始明牌 2 张
    state.piles[0] = deck.splice(0, 1)[0] || null;
    state.piles[1] = deck.splice(0, 1)[0] || null;

    // 剩余 20 张：各 5 张作翻牌牌堆，剩余 10 张补进 handPile
    state.players[0].drawPile = deck.splice(0, 5);
    state.players[1].drawPile = deck.splice(0, 5);
    state.players[0].handPile.push(...deck.splice(0, 5));
    state.players[1].handPile.push(...deck.splice(0, 5));
    return state;
  }

  // 从 handPile 补手牌到 5 张
  function drawUpToFive(player) {
    while (player.hand.length < 5 && player.handPile.length > 0) {
      player.hand.push(player.handPile.shift());
    }
  }

  // 出牌。返回 {ok, reason}
  function playCard(state, playerIndex, cardId, pileIndex) {
    if (state.gameOver) return { ok: false, reason: 'gameOver' };
    if (pileIndex !== 0 && pileIndex !== 1) return { ok: false, reason: 'invalid' };

    const p = state.players[playerIndex];
    const cardIdx = p.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return { ok: false, reason: 'cardNotInHand' };

    const card = p.hand[cardIdx];
    const topCard = state.piles[pileIndex];

    if (topCard !== null && !adjacent(card.rank, topCard.rank)) {
      return { ok: false, reason: 'notAdjacent' };
    }

    // 旧顶牌压入历史
    if (topCard !== null) state.pileStacks[pileIndex].push(topCard);
    p.hand.splice(cardIdx, 1);
    state.piles[pileIndex] = card;
    // 任何人出牌都重置双方 pass
    state.passFlags[0] = false;
    state.passFlags[1] = false;
    drawUpToFive(p);
    checkWin(state);
    return { ok: true };
  }

  // Pass。返回 {ok, reason}
  function pass(state, playerIndex) {
    if (state.gameOver) return { ok: false, reason: 'gameOver' };
    state.passFlags[playerIndex] = true;

    if (state.passFlags[0] && state.passFlags[1]) {
      flipNewCards(state);
      state.passFlags = [false, false];
    }
    return { ok: true };
  }

  // 双方都 pass 时翻新牌。
  // 优先从各自 drawPile 翻；若 drawPile 都空，则把桌面两堆（含顶牌）收集、洗牌、平分成新 drawPile，再各翻一张。
  function flipNewCards(state) {
    const p0Empty = state.players[0].drawPile.length === 0;
    const p1Empty = state.players[1].drawPile.length === 0;

    if (p0Empty && p1Empty) {
      // 收集桌面所有牌（含顶牌 + 历史牌）
      const collected = [];
      for (let i = 0; i < 2; i++) {
        if (state.piles[i]) collected.push(state.piles[i]);
        collected.push(...state.pileStacks[i]);
        state.piles[i] = null;
        state.pileStacks[i] = [];
      }
      if (collected.length === 0) {
        // 无牌可翻，游戏卡死，平局
        state.gameOver = true;
        state.winner = -1;
        return;
      }
      const shuffled = shuffle(collected);
      const half = Math.floor(shuffled.length / 2);
      state.players[0].drawPile = shuffled.slice(0, half);
      state.players[1].drawPile = shuffled.slice(half);
    }

    // 各从 drawPile 翻一张到桌面
    for (let i = 0; i < 2; i++) {
      const src = state.players[i].drawPile;
      if (src.length > 0) {
        if (state.piles[i] !== null) state.pileStacks[i].push(state.piles[i]);
        state.piles[i] = src.shift();
      }
    }
    checkWin(state);
  }

  function checkWin(state) {
    for (let i = 0; i < 2; i++) {
      const p = state.players[i];
      // 手牌和补手牌堆都空才算赢
      if (p.hand.length === 0 && p.handPile.length === 0) {
        state.gameOver = true;
        state.winner = i;
        return;
      }
    }
  }

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
        handPileCount: state.players[viewerIndex].handPile.length,
        flipPileCount: state.players[viewerIndex].drawPile.length
      },
      opponent: {
        index: other,
        handCount: state.players[other].hand.length,
        handPileCount: state.players[other].handPile.length,
        flipPileCount: state.players[other].drawPile.length
      }
    };
  }

  return { RANKS, SUITS, createDeck, shuffle, adjacent, rankIndex, newGame, playCard, pass, drawUpToFive, checkWin, viewForPlayer };
});
