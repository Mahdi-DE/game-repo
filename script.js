'use strict';

(() => {
  const $ = id => document.getElementById(id);

  /* ---------- Configuration ---------- */
  const CONFIG = {
    easy:   { pairs: 6,  time: 75 },
    medium: { pairs: 8,  time: 90 },
    hard:   { pairs: 12, time: 150 }
  };

  const DECKS = {
    space:  ['🚀', '🪐', '👽', '🌙', '☄️', '🛸', '⭐', '🌌', '🔭', '🛰️', '🌎', '👨‍🚀'],
    nature: ['🦊', '🐼', '🦋', '🌻', '🐸', '🐬', '🌵', '🦉', '🐝', '🍀', '🦄', '🐢'],
    food:   ['🍓', '🍕', '🍩', '🍉', '🍪', '🍒', '🥑', '🍔', '🍦', '🥨', '🍋', '🧁']
  };

  const STORE = 'memory-masters-v1';

  /* ---------- Persistence ---------- */
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) || {};
    } catch {
      return {};
    }
  }

  const saved = load();

  const state = {
    phase: 'ready',
    cards: [],
    first: null,
    second: null,
    locked: false,
    matched: 0,
    moves: 0,
    score: 0,
    streak: 0,
    hints: 3,
    time: 90,
    elapsed: 0,
    timer: null,
    hideTimer: null,
    hintTimer: null,
    epoch: 0,
    difficulty: 'medium',
    mode: 'timed',
    deck: 'space',
    sound: saved.sound !== false,
    light: !!saved.light,
    records: Array.isArray(saved.records) ? saved.records : []
  };

  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        sound: state.sound,
        light: state.light,
        records: state.records
      }));
    } catch {}
  }

  /* ---------- Utilities ---------- */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  let audio;

  function beep(freq = 440, duration = .09, type = 'sine') {
    if (!state.sound) return;

    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();

      const osc = audio.createOscillator();
      const gain = audio.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, audio.currentTime);
      gain.gain.setValueAtTime(.07, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);

      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + duration);
    } catch {}
  }

  const fmt = s => {
    const secs = Math.max(0, s);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  };

  function clearTasks() {
    clearInterval(state.timer);
    clearTimeout(state.hideTimer);
    clearTimeout(state.hintTimer);
    state.timer = null;
    state.hideTimer = null;
    state.hintTimer = null;
  }

  function config() {
    return CONFIG[state.difficulty];
  }

  /* ---------- UI updates ---------- */
  function update() {
    const total = config().pairs;

    $('time').textContent = state.mode === 'relaxed' ? fmt(state.elapsed) : fmt(state.time);
    $('moves').textContent = state.moves;
    $('matched').textContent = `${state.matched} / ${total}`;
    $('score').textContent = state.score.toLocaleString();
    $('combo').textContent = `Combo ×${Math.max(1, state.streak)}`;
    $('accuracy').textContent = `Accuracy ${state.moves ? Math.round(state.matched / state.moves * 100) : 100}%`;
    $('hints').textContent = state.hints;

    $('hintBtn').disabled =
      state.phase !== 'playing' ||
      state.locked ||
      state.hints === 0 ||
      state.score < 100;

    $('pauseBtn').disabled = !['playing', 'paused'].includes(state.phase);
    $('pauseBtn').textContent = state.phase === 'paused' ? '▶ Resume' : 'Ⅱ Pause';

    const bestScores = state.records
      .filter(r => r.difficulty === state.difficulty && r.mode === state.mode)
      .map(r => r.score);
    $('best').textContent = `Best ${Math.max(0, ...bestScores).toLocaleString()}`;

    const pct = state.matched / total * 100;
    $('progressBar').style.width = pct + '%';
    $('progressText').textContent = Math.round(pct) + '% complete';

    $('timeMeter').style.width =
      (state.mode === 'relaxed' ? 100 : Math.max(0, state.time / config().time * 100)) + '%';

    $('status').textContent = {
      ready: 'READY TO PLAY',
      playing: 'MISSION ACTIVE',
      paused: 'PAUSED',
      won: 'MISSION COMPLETE',
      lost: 'TIME EXPIRED'
    }[state.phase] || 'READY';
  }

  function overlay(title, text, button, icon = '✦') {
    $('overlayTitle').textContent = title;
    $('overlayText').textContent = text;
    $('overlayBtn').textContent = button;
    $('overlayIcon').textContent = icon;
    $('overlay').classList.remove('hidden');
  }

  function hideOverlay() {
    $('overlay').classList.add('hidden');
  }

  /* ---------- Board ---------- */
  function renderBoard() {
    const board = $('board');
    board.replaceChildren();
    board.classList.toggle('hard', state.difficulty === 'hard');

    state.cards.forEach((card, i) => {
      const btn = document.createElement('button');
      btn.className = 'memory-card';
      btn.type = 'button';
      btn.setAttribute('aria-label', `Card ${i + 1}, face down`);
      btn.dataset.index = i;
      btn.innerHTML =
        '<span class="card-inner">' +
          '<span class="face front"><b>✦</b></span>' +
          '<span class="face back"><span></span></span>' +
        '</span>';
      btn.querySelector('.back span').textContent = card.symbol;
      btn.addEventListener('click', () => flip(i));
      board.appendChild(btn);
    });
  }

  function element(i) {
    return $('board').children[i];
  }

  function show(i) {
    element(i).classList.add('flipped');
    element(i).setAttribute('aria-label', `Card ${i + 1}: ${state.cards[i].symbol}`);
  }

  function conceal(i) {
    element(i).classList.remove('flipped');
    element(i).setAttribute('aria-label', `Card ${i + 1}, face down`);
  }

  /* ---------- Game flow ---------- */
  
  function newGame(auto = false) {
    clearTasks();
    state.epoch++;

    state.difficulty = $('difficulty').value;
    state.mode = $('mode').value;
    state.deck = $('deck').value;

    const c = config();
    const symbols = DECKS[state.deck].slice(0, c.pairs);

    state.cards = shuffle(
      symbols.flatMap((symbol, id) => [
        { id, symbol, matched: false },
        { id, symbol, matched: false }
      ])
    );

    Object.assign(state, {
      phase: 'ready',
      first: null,
      second: null,
      locked: false,
      matched: 0,
      moves: 0,
      score: 0,
      streak: 0,
      hints: 3,
      time: c.time,
      elapsed: 0
    });

    renderBoard();
    $('message').textContent = 'Choose two cards to find a match.';
    overlay('Ready, player one?', 'Memorize the symbols and match every pair.', '▶ Start game', '✦');
    update();

    if (auto) start();
  }

  function start() {
    if (state.phase === 'paused') {
      state.phase = 'playing';
      hideOverlay();
      tick();
      update();
      return;
    }

    if (state.phase !== 'ready') return;

    state.phase = 'playing';
    hideOverlay();
    tick();
    update();
    beep(550);
  }

  function tick() {
    clearInterval(state.timer);

    state.timer = setInterval(() => {
      if (state.phase !== 'playing') return;

      state.elapsed++;

      if (state.mode === 'timed') {
        state.time--;
        if (state.time <= 0) {
          state.time = 0;
          finish(false);
        }
      }

      update();
    }, 1000);
  }















  

  function pause() {
    if (state.phase === 'playing') {
      state.phase = 'paused';
      clearInterval(state.timer);
      overlay('Mission paused', 'Your cards are waiting for you.', '▶ Resume', 'Ⅱ');
    } else if (state.phase === 'paused') {
      start();
    }

    update();
  }

  function finish(won) {
    if (!['playing', 'paused'].includes(state.phase)) return;

    clearTasks();
    state.phase = won ? 'won' : 'lost';

    if (won) {
      state.score += state.mode === 'timed'
        ? state.time * 5
        : Math.max(0, 600 - state.elapsed * 2);

      state.records.push({
        difficulty: state.difficulty,
        mode: state.mode,
        score: state.score,
        moves: state.moves,
        seconds: state.elapsed,
        date: new Date().toISOString().slice(0, 10)
      });

      state.records.sort((a, b) => b.score - a.score);
      state.records = state.records.slice(0, 30);

      persist();
      renderLeaderboard();

      overlay(
        'Mission accomplished!',
        `You scored ${state.score.toLocaleString()} points in ${state.moves} moves and ${fmt(state.elapsed)}. Play again to beat your record!`,
        '↻ Play again',
        '🏆'
      );
      beep(880, .25);
    } else {
      overlay(
        'Time is up!',
        `You matched ${state.matched} of ${config().pairs} pairs. Try again!`,
        '↻ Try again',
        '⌛'
      );
      beep(200, .3, 'sawtooth');
    }

    update();
  }

  /* ---------- Leaderboard ---------- */
  function renderLeaderboard() {
    const list = $('leaderboard');
    list.replaceChildren();

    const records = state.records
      .filter(r => r.difficulty === $('difficulty').value && r.mode === $('mode').value)
      .slice(0, 5);

    if (!records.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No records yet. Be the first!';
      list.append(li);
      return;
    }

    records.forEach((r, i) => {
      const li = document.createElement('li');
      const left = document.createElement('span');
      const right = document.createElement('strong');

      left.textContent = `${['🥇', '🥈', '🥉'][i] || '#' + (i + 1)} ${r.moves} moves · ${r.date}`;
      right.textContent = r.score.toLocaleString();

      li.append(left, right);
      list.append(li);
    });
  }

  /* ---------- Event listeners ---------- */
  $('overlayBtn').addEventListener('click', () => {
    if (state.phase === 'ready' || state.phase === 'paused') start();
    else newGame(true);
  });

  $('newBtn').addEventListener('click', () => newGame(true));
  $('restartBtn').addEventListener('click', () => newGame(true));
  $('hintBtn').addEventListener('click', hint);
  $('pauseBtn').addEventListener('click', pause);
  $('difficulty').addEventListener('change', renderLeaderboard);
  $('mode').addEventListener('change', renderLeaderboard);

  $('soundBtn').addEventListener('click', () => {
    state.sound = !state.sound;
    $('soundBtn').textContent = state.sound ? '🔊' : '🔇';
    persist();
    beep();
  });

  $('themeBtn').addEventListener('click', () => {
    state.light = !state.light;
    document.body.classList.toggle('light', state.light);
    persist();
  });

  $('helpBtn').addEventListener('click', () => $('helpDialog').showModal());
  $('closeHelp').addEventListener('click', () => $('helpDialog').close());
  $('gotIt').addEventListener('click', () => $('helpDialog').close());

  $('clearBtn').addEventListener('click', () => {
    if (confirm('Delete all saved leaderboard scores?')) {
      state.records = [];
      persist();
      renderLeaderboard();
      update();
    }
  });

  document.addEventListener('keydown', e => {
    if (
      $('helpDialog').open ||
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)
    ) return;

    const key = e.key.toLowerCase();

    if (key === 'p') {
      e.preventDefault();
      pause();
    } else if (key === 'h') {
      e.preventDefault();
      hint();
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      if (state.phase !== 'playing') return;
      e.preventDefault();

      const cards = [...$('board').children];
      const active = cards.indexOf(document.activeElement);
      const cols = state.difficulty === 'hard' ? 6 : 4;
      const delta = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -cols,
        ArrowDown: cols
      }[e.key];

      cards[(Math.max(0, active) + delta + cards.length) % cards.length]?.focus();
    }
  });

  /* ---------- Init ---------- */
  document.body.classList.toggle('light', state.light);
  $('soundBtn').textContent = state.sound ? '🔊' : '🔇';
  newGame();
  renderLeaderboard();
})();