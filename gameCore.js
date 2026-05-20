// gameCore.js — 起两张 共享游戏逻辑
// 纯函数模块，服务端 (Node) 和前端 (浏览器) 都能用。
// 服务端 require()，前端通过 <script> 加载后挂到 window.GameCore。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GameCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','小王','大王'];
  const STRAIGHT_RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A'];
  const NORMAL_RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  const SUITS = ['♠','♥','♣','♦'];

  function createDeck() {
    const d = [];
    for (const r of NORMAL_RANKS) {
      for (const s of SUITS) {
        d.push({ rank: r, suit: s, id: r + s + Math.random().toString(36).slice(2, 8) });
      }
    }
    d.push({ rank: '小王', suit: '', id: '小王' + Math.random().toString(36).slice(2, 8) });
    d.push({ rank: '大王', suit: '', id: '大王' + Math.random().toString(36).slice(2, 8) });
    return shuffle(d);
  }

  function shuffle(d) {
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function rv(r) { return RANKS.indexOf(r); }

  function sv(cards) {
    if (cards.length !== 2) return -1;
    const v = cards.map(c => STRAIGHT_RANKS.indexOf(c.rank));
    if (v.includes(-1)) return -1;
    v.sort((a, b) => a - b);
    return v[1] - v[0] === 1 ? v[1] : -1;
  }

  function isKingBomb(cards) {
    return cards.length === 2
      && cards.some(c => c.rank === '小王')
      && cards.some(c => c.rank === '大王');
  }

  function handType(cards) {
    if (isKingBomb(cards)) return 'kingbomb';
    if (cards.length === 1) return 'single';
    if (cards.length === 2 && cards[0].rank === cards[1].rank) return 'pair';
    if (sv(cards) !== -1) return 'straight';
    return null;
  }

  function handValue(cards) {
    if (isKingBomb(cards)) return 999;
    if (handType(cards) === 'straight') return sv(cards);
    return rv(cards[0].rank);
  }

  function canBeat(last, cards) {
    const t = handType(cards);
    if (!t) return false;
    if (!last) return true;
    if (isKingBomb(cards)) return true;
    if (isKingBomb(last.cards)) return false;
    if (t !== handType(last.cards)) return false;
    return handValue(cards) > handValue(last.cards);
  }

  function drawToTwo(player, deck) {
    while (player.hand.length < 2 && deck.length > 0) {
      player.hand.push(deck.shift());
    }
  }

  // 创建一局新游戏的 state。firstPlayer = 先手玩家索引 (0 或 1)。
  function newGame(firstPlayer) {
    if (typeof firstPlayer !== 'number') firstPlayer = 0;
    const state = {
      deck: createDeck(),
      players: [
        { hand: [], pile: [] },
        { hand: [], pile: [] }
      ],
      currentPlayer: firstPlayer,
      lastPlay: null,
      lastWinner: null,
      gameOver: false,
      winner: null
    };
    drawToTwo(state.players[0], state.deck);
    drawToTwo(state.players[1], state.deck);
    return state;
  }

  // 验证 playerIndex 出 cardIds 这步是否合法。返回 {ok, reason, cards}。
  function validatePlay(state, playerIndex, cardIds) {
    if (state.gameOver) return { ok: false, reason: 'gameOver' };
    if (state.currentPlayer !== playerIndex) return { ok: false, reason: 'notYourTurn' };
    if (!Array.isArray(cardIds) || cardIds.length === 0 || cardIds.length > 2) {
      return { ok: false, reason: 'invalid' };
    }
    const p = state.players[playerIndex];
    const cards = [];
    for (const id of cardIds) {
      const c = p.hand.find(x => x.id === id);
      if (!c) return { ok: false, reason: 'cardNotInHand' };
      if (cards.find(x => x.id === id)) return { ok: false, reason: 'duplicate' };
      cards.push(c);
    }
    if (!handType(cards)) return { ok: false, reason: 'invalid' };
    if (!canBeat(state.lastPlay, cards)) return { ok: false, reason: 'cannotBeat' };
    return { ok: true, cards };
  }

  // 执行一手出牌。state 会被改变。返回执行的 cards。
  function applyPlay(state, playerIndex, cards) {
    const p = state.players[playerIndex];
    p.hand = p.hand.filter(c => !cards.some(x => x.id === c.id));
    p.pile.push(...cards);
    state.lastPlay = { playerIndex, cards };
    state.lastWinner = playerIndex;
    drawToTwo(p, state.deck);
    checkEnd(state, playerIndex);
    if (!state.gameOver) {
      state.currentPlayer = 1 - playerIndex;
    }
    return cards;
  }

  // 检查游戏结束。条件：牌堆空 且 当前出牌人手牌也空。
  function checkEnd(state, playerIndex) {
    if (state.deck.length !== 0) return;
    if (state.players[playerIndex].hand.length !== 0) return;
    const other = 1 - playerIndex;
    const winner = state.players[playerIndex];
    const loser = state.players[other];
    if (loser.hand.length > 0) {
      winner.pile.push(...loser.hand);
      loser.hand = [];
    }
    state.gameOver = true;
    const s0 = state.players[0].pile.length;
    const s1 = state.players[1].pile.length;
    if (s0 > s1) state.winner = 0;
    else if (s1 > s0) state.winner = 1;
    else state.winner = -1; // 平局
  }

  // 验证 pass。
  function validatePass(state, playerIndex) {
    if (state.gameOver) return { ok: false, reason: 'gameOver' };
    if (state.currentPlayer !== playerIndex) return { ok: false, reason: 'notYourTurn' };
    if (!state.lastPlay) return { ok: false, reason: 'emptyPass' };
    return { ok: true };
  }

  // 执行 pass：清桌，由上一手赢家继续先手。
  function applyPass(state, playerIndex) {
    state.lastPlay = null;
    state.currentPlayer = state.lastWinner;
  }

  // AI 决策（单机用）。
  function allPlays(hand) {
    const ps = hand.map(c => [c]);
    if (hand.length >= 2) ps.push([hand[0], hand[1]]);
    return ps.filter(p => handType(p));
  }

  function chooseAi(state, aiIndex) {
    const legal = allPlays(state.players[aiIndex].hand).filter(p => canBeat(state.lastPlay, p));
    if (!legal.length) return null;
    if (state.lastPlay) {
      const t = handType(state.lastPlay.cards);
      if (t === 'kingbomb') return null;
      return legal
        .filter(p => handType(p) === t || handType(p) === 'kingbomb')
        .sort((a, b) => handValue(a) - handValue(b))[0] || null;
    }
    if (state.deck.length === 0) {
      const two = legal.filter(p => p.length === 2).sort((a, b) => handValue(a) - handValue(b))[0];
      if (two) return two;
    }
    const singles = legal.filter(p => p.length === 1).sort((a, b) => handValue(a) - handValue(b));
    return singles[0] || legal.sort((a, b) => handValue(a) - handValue(b))[0];
  }

  // 给联机的对手生成"隐藏"视图：手牌只暴露数量，不暴露牌面。
  function viewForPlayer(state, viewerIndex) {
    const other = 1 - viewerIndex;
    return {
      deckCount: state.deck.length,
      currentPlayer: state.currentPlayer,
      lastPlay: state.lastPlay,
      lastWinner: state.lastWinner,
      gameOver: state.gameOver,
      winner: state.winner,
      you: {
        index: viewerIndex,
        hand: state.players[viewerIndex].hand,
        pile: state.players[viewerIndex].pile.length
      },
      opponent: {
        index: other,
        handCount: state.players[other].hand.length,
        pile: state.players[other].pile.length
      }
    };
  }

  return {
    RANKS, STRAIGHT_RANKS, NORMAL_RANKS, SUITS,
    createDeck, shuffle,
    handType, handValue, canBeat,
    drawToTwo,
    newGame,
    validatePlay, applyPlay,
    validatePass, applyPass,
    checkEnd,
    chooseAi, allPlays,
    viewForPlayer
  };
});
