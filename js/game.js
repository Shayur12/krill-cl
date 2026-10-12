/* Krill Dive — game engine. */
(function () {
  'use strict';
  const M = window.KrillMatch;
  const PROMPTS = (window.KRILL_PROMPTS || []).filter((p) => p && p.answers && p.answers.length >= 10);
  const BY_ID = new Map(PROMPTS.map((p) => [p.id, p]));

  // ---------------------------------------------------------------- config
  const ROUNDS = 7;
  const ROUND_TIME = 25; // seconds per daily prompt
  const PENALTY = 2; // seconds lost per wrong guess
  const O2_START = 45; // infinite mode oxygen
  const O2_MAX = 60;
  const M_PER_PT = 10; // metres of depth per point
  const EPOCH = Date.UTC(2026, 0, 1); // Dive #1
  const DAY = 86400000;
  const REEF_SIZE = 4000; // simulated divers used for rankings

  const TIERS = [
    { key: 'plankton', name: 'Plankton', pts: 10, o2: 3, emoji: '🟩', css: '--t-plankton', blurb: 'Everyone’s first thought. Safe, shallow water.' },
    { key: 'clever', name: 'Too Clever', pts: 15, o2: 4, emoji: '🟨', css: '--t-clever', blurb: 'You thought it was obscure. So did thousands of others.' },
    { key: 'schooler', name: 'Schooler', pts: 30, o2: 6, emoji: '🟧', css: '--t-schooler', blurb: 'Swimming with a decent-sized school.' },
    { key: 'rare', name: 'Rare', pts: 60, o2: 8, emoji: '🟦', css: '--t-rare', blurb: 'Not many divers made it down here.' },
    { key: 'deep', name: 'Deep Cut', pts: 85, o2: 10, emoji: '🟪', css: '--t-deep', blurb: 'Down where the sunlight gives up.' },
    { key: 'krillion', name: 'One in a Krillion', pts: 100, o2: 15, emoji: '🟥', css: '--t-krillion', blurb: 'The single rarest answer on the sheet.' },
  ];
  const MISS = { key: 'miss', name: 'No answer', pts: 0, emoji: '⬛', css: '--t-miss', blurb: '' };

  const ZONES = [
    { m: 0, name: 'Sunlight Zone' },
    { m: 200, name: 'Twilight Zone' },
    { m: 1000, name: 'Midnight Zone' },
    { m: 4000, name: 'Abyssal Zone' },
    { m: 6000, name: 'Hadal Zone' },
  ];
  const zoneFor = (m) => ZONES.reduce((z, cur) => (m >= cur.m ? cur : z), ZONES[0]);

  // ---------------------------------------------------------------- utils
  const $ = (sel, root) => (root || document).querySelector(sel);
  const view = $('#view');
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tierVar = (t) => `var(${t.css})`;

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem('krilldive:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('krilldive:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  // ---------------------------------------------------------------- days
  const todayDive = () => Math.floor((Date.now() - EPOCH) / DAY) + 1;
  const diveDate = (n) => new Date(EPOCH + (n - 1) * DAY);
  const dateLabel = (n) => diveDate(n).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  function msToNextDive() { return EPOCH + todayDive() * DAY - Date.now(); }
  function hms(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
  }

  // Every dive draws 7 prompts from a seeded shuffle of the whole bank; a full cycle uses each prompt once.
  function promptsForDive(n) {
    const ids = PROMPTS.map((p) => p.id).sort();
    const per = Math.max(1, Math.floor(ids.length / ROUNDS));
    const slot = n - 1;
    const cycle = Math.floor(slot / per);
    const off = (slot % per) * ROUNDS;
    const perm = shuffle(ids, rng(hashStr('krill-cycle-' + cycle)));
    // keep categories varied inside a single dive
    const chosen = [], cats = new Set();
    for (let i = 0; chosen.length < ROUNDS && i < perm.length; i++) {
      const id = perm[(off + i) % perm.length];
      const cat = BY_ID.get(id).cat;
      if (chosen.length < ROUNDS && (!cats.has(cat) || i > ROUNDS * 3)) { chosen.push(id); cats.add(cat); }
    }
    return chosen;
  }

  // ---------------------------------------------------------------- rarity sheets
  // Answers are authored most-common first. Popularity follows a Zipf curve over that order;
  // tiers come from rank position so every prompt has the full ladder, and the last answer is the One in a Krillion.
  const sheetCache = new Map();
  function sheet(id) {
    if (sheetCache.has(id)) return sheetCache.get(id);
    const p = BY_ID.get(id);
    const n = p.answers.length;
    const s = 1.15;
    const w = p.answers.map((_, i) => Math.pow(i + 1, -s));
    const total = w.reduce((a, b) => a + b, 0);
    const plank = Math.max(1, Math.ceil(n * 0.06));
    const entries = p.answers.map((line, i) => {
      const f = i / (n - 1);
      let t;
      if (i === n - 1) t = 5;
      else if (i < plank) t = 0;
      else if (f < 0.2) t = 1;
      else if (f < 0.42) t = 2;
      else if (f < 0.68) t = 3;
      else t = 4;
      return { rank: i, display: line.split('|')[0], tier: t, share: (w[i] / total) * 100 };
    });
    const out = { prompt: p, entries, index: M.buildIndex(p.answers) };
    sheetCache.set(id, out);
    return out;
  }
  const shareLabel = (pct) => (pct < 0.1 ? '<0.1%' : pct < 1 ? pct.toFixed(1) + '%' : Math.round(pct) + '%');

  // ---------------------------------------------------------------- simulated reef (rankings)
  const reefCache = new Map();
  function reef(n, ids) {
    const key = n + ':' + ids.join(',');
    if (reefCache.has(key)) return reefCache.get(key);
    const rand = rng(hashStr('reef-' + key));
    const BIAS = [0, 0.15, 0.3, 0.45, 0.6, 0.75];
    const tables = ids.map((id) => {
      const sh = sheet(id);
      return BIAS.map((b) => {
        let acc = 0;
        const cum = sh.entries.map((e, i) => (acc += Math.pow(i + 1, -1.15 * (1 - b))));
        return { cum, total: acc, tiers: sh.entries.map((e) => TIERS[e.tier].pts) };
      });
    });
    const scores = new Array(REEF_SIZE);
    for (let p = 0; p < REEF_SIZE; p++) {
      const miss = 0.05 + 0.32 * rand() * rand();
      const bi = Math.min(BIAS.length - 1, Math.floor(Math.pow(rand(), 1.6) * BIAS.length));
      let sc = 0;
      for (const t of tables) {
        if (rand() < miss) continue;
        const tb = t[bi];
        const r = rand() * tb.total;
        let lo = 0, hi = tb.cum.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (tb.cum[mid] < r) lo = mid + 1; else hi = mid; }
        sc += tb.tiers[lo];
      }
      scores[p] = sc;
    }
    scores.sort((a, b) => a - b);
    reefCache.set(key, scores);
    return scores;
  }
  function percentile(scores, score) {
    let below = 0, equal = 0;
    for (const s of scores) { if (s < score) below++; else if (s === score) equal++; }
    return ((below + equal * 0.5) / scores.length) * 100;
  }

  // ---------------------------------------------------------------- sound
  const sound = (function () {
    let ac = null;
    let on = store.get('sound', true);
    function tone(freq, dur, type, vol, slide, delay) {
      if (!on) return;
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)();
        const t0 = ac.currentTime + (delay || 0);
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq, t0);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(ac.destination);
        o.start(t0); o.stop(t0 + dur + 0.02);
      } catch (e) { /* audio unavailable */ }
    }
    return {
      get on() { return on; },
      toggle() { on = !on; store.set('sound', on); return on; },
      bad() { tone(160, 0.18, 'triangle', 0.14, 90); },
      tick() { tone(880, 0.05, 'square', 0.03); },
      start() { tone(330, 0.12, 'sine', 0.1, 660); },
      count() { tone(520, 0.1, 'sine', 0.08); },
      good(tier) {
        const base = [392, 440, 523, 587, 659, 784][tier];
        tone(base, 0.16, 'sine', 0.12, base * 1.5);
        tone(base * 1.5, 0.22, 'sine', 0.09, base * 2, 0.08);
        if (tier >= 4) tone(base * 2, 0.35, 'triangle', 0.07, base * 3, 0.18);
        if (tier === 5) [0.3, 0.4, 0.5].forEach((d, i) => tone(1046 + i * 262, 0.25, 'sine', 0.06, null, d));
      },
      over() { tone(300, 0.5, 'sawtooth', 0.06, 70); },
    };
  })();
  const SOUND_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const SOUND_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
  const soundBtn = $('#btn-sound');
  const paintSound = () => { soundBtn.innerHTML = sound.on ? SOUND_ON : SOUND_OFF; soundBtn.setAttribute('aria-pressed', String(sound.on)); };
  soundBtn.addEventListener('click', () => { sound.toggle(); paintSound(); });
  paintSound();

  // ---------------------------------------------------------------- feedback helpers
  function toast(msg) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2300);
  }
  function floater(text, el, colour) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'floater'; f.textContent = text;
    f.style.left = r.left + r.width / 2 + 'px'; f.style.top = r.top - 10 + 'px';
    if (colour) f.style.setProperty('--tc', colour);
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }
  function countUp(el, to, ms, suffix) {
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.firstChild.nodeValue = fmt(to * e);
      if (k < 1) requestAnimationFrame(step);
    };
    el.innerHTML = '0' + (suffix || '');
    requestAnimationFrame(step);
  }
  function cssColour(t) { return getComputedStyle(document.documentElement).getPropertyValue(t.css).trim(); }

  // ---------------------------------------------------------------- persistence
  function loadDive(n) { return store.get('dive:' + n, null); }
  function saveDive(n, d) { store.set('dive:' + n, d); }
  function stats() {
    return Object.assign({ played: 0, streak: 0, maxStreak: 0, lastDive: 0, best: 0, total: 0, tiers: [0, 0, 0, 0, 0, 0, 0], infBest: 0, infPlayed: 0 }, store.get('stats', {}));
  }
  function currentStreak(st) { return st.lastDive >= todayDive() - 1 ? st.streak : 0; }

  // ---------------------------------------------------------------- timers
  let loopId = 0;
  let clockTimer = 0;
  function stopLoops() { cancelAnimationFrame(loopId); clearInterval(clockTimer); loopId = 0; }

  // ================================================================ HOME
  function home() {
    stopLoops();
    game = null;
    const n = todayDive();
    const d = loadDive(n);
    const st = stats();
    Ocean.setDepth(d && d.done ? d.score * M_PER_PT : 0);
    if (!PROMPTS.length) {
      view.innerHTML = `<section class="screen panel"><h2>No prompts loaded</h2><p>The prompt bank failed to load. Refresh the page to try again.</p></section>`;
      return;
    }
    const inProgress = d && !d.done && d.rounds && d.rounds.length + (d.cur ? 1 : 0) > 0;
    view.innerHTML = `
      <section class="screen">
        <div class="hero">
          <span class="dive-tag">DIVE #${n} · ${dateLabel(n)} · ${PROMPTS.length} prompts</span>
          <h1 id="hero-title"><span data-split>Go </span><span data-split class="accent">deeper</span><br><span data-split>than everyone else.</span></h1>
          <p>Seven prompts. Twenty-five seconds each. Obvious answers keep you in the shallows; rare ones send you to the trench.</p>
        </div>
        <div class="home-actions">
          ${d && d.done
            ? `<button class="btn block" id="go-results" type="button">See today’s dive · ${fmt(d.score * M_PER_PT)} m</button>`
            : `<button class="btn block" id="go-daily" type="button">${inProgress ? 'RESUME DIVE' : 'BEGIN DIVE'}</button>`}
          <div class="row">
            <button class="btn secondary" id="go-inf" type="button">Infinite Dive</button>
            <button class="btn secondary" id="go-arch" type="button">Past Dives</button>
          </div>
          <p class="mode-note">${d && d.done ? `Next dive in <span class="countdown" id="cd">${hms(msToNextDive())}</span>` : `Everyone gets the same seven prompts. New dive at 00:00 UTC.`}</p>
        </div>
        <div class="panel">
          <div class="eyebrow" style="margin-bottom:10px">Rarity ladder</div>
          <div class="tierlist">
            ${TIERS.slice().reverse().map((t) => `
              <div class="tierrow"><span class="dot" style="background:${tierVar(t)}"></span><span class="nm">${t.name}</span><span class="pt">${t.pts} pts</span><span class="dp">${fmt(t.pts * M_PER_PT)} m</span></div>`).join('')}
          </div>
        </div>
        <div class="result-stats">
          <div class="panel stat"><b>${currentStreak(st)}</b><span>Streak</span></div>
          <div class="panel stat"><b>${fmt(st.best * M_PER_PT)}</b><span>Best m</span></div>
          <div class="panel stat"><b>${fmt(st.infBest * M_PER_PT)}</b><span>Infinite best m</span></div>
        </div>
        <p class="footer-note">Unofficial fan-made tribute inspired by Krillion. Rankings compare you against a simulated field of ${fmt(REEF_SIZE)} divers.</p>
      </section>`;
    const on = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
    on('go-daily', () => startDaily(n, false));
    on('go-results', () => results(n));
    on('go-inf', startInfinite);
    on('go-arch', archive);
    Motion.title($('#hero-title'));
    Motion.stagger(document.querySelectorAll('.home-actions .btn, .tierrow, .result-stats .stat'), { each: 0.04, delay: 0.25 });
    if ($('#cd')) clockTimer = setInterval(() => { const el = $('#cd'); if (!el) return clearInterval(clockTimer); if (msToNextDive() <= 0) return home(); el.textContent = hms(msToNextDive()); }, 1000);
    if (!store.get('seenHelp', false)) { store.set('seenHelp', true); help(); }
  }

  // ================================================================ PLAY
  let game = null;

  function startDaily(n, isArchive) {
    const ids = promptsForDive(n);
    let d = loadDive(n);
    if (!d || !d.ids || d.ids.join() !== ids.join()) d = { ids, rounds: [], cur: null, done: false, score: 0 };
    saveDive(n, d);
    game = { mode: isArchive ? 'archive' : 'daily', dive: n, ids, data: d, round: d.rounds.length, score: d.rounds.reduce((a, r) => a + r.pts, 0) };
    Ocean.setDepth(game.score * M_PER_PT);
    renderPlay();
    if (game.round === 0 && !d.cur) countIn(() => beginRound()); else beginRound();
  }

  function startInfinite() {
    const recent = store.get('infRecent', []);
    const fresh = PROMPTS.map((p) => p.id).filter((id) => !recent.includes(id));
    const queue = shuffle(fresh, Math.random).concat(shuffle(recent, Math.random));
    game = { mode: 'infinite', queue, round: 0, score: 0, o2: O2_START, rounds: [], data: null };
    Ocean.setDepth(0);
    renderPlay();
    countIn(() => beginRound());
  }

  function countIn(done) {
    const el = document.createElement('div');
    el.className = 'countin';
    document.body.appendChild(el);
    let k = 3;
    const tick = () => {
      if (!game) { el.remove(); return; }
      if (k === 0) { el.remove(); sound.start(); done(); return; }
      el.innerHTML = `<span>${k}</span>`; sound.count(); k--;
      setTimeout(tick, 560);
    };
    tick();
  }

  function renderPlay() {
    const inf = game.mode === 'infinite';
    view.innerHTML = `
      <section class="screen" style="gap:16px">
        ${inf ? `
          <div class="oxygen" id="oxy">
            <div class="oxy-meta"><span>OXYGEN <b id="oxy-num">${O2_START.toFixed(1)}s</b></span><span>DEPTH <b id="depth">0 m</b> · #<b id="rnum">1</b></span></div>
            <div class="oxy-track"><div class="oxy-fill" id="oxy-fill"></div></div>
          </div>` : `
          <div class="hud">
            <div>
              <div class="pips" id="pips">${game.ids.map(() => '<div class="pip"></div>').join('')}</div>
              <div class="hud-meta"><span><span class="hide-narrow">${game.mode === 'archive' ? 'PAST ' : ''}DIVE #${game.dive} · </span>PROMPT <span id="rnum">1</span>/${ROUNDS}</span><span class="depth-read" id="depth">0 m</span></div>
            </div>
            <div class="timer" id="timer">
              <svg viewBox="0 0 64 64"><circle class="track" cx="32" cy="32" r="28" fill="none" stroke-width="5"/><circle class="bar" id="tbar" cx="32" cy="32" r="28" fill="none" stroke-width="5" stroke-dasharray="175.93" stroke-dashoffset="0"/></svg>
              <div class="num" id="tnum">${ROUND_TIME}</div>
            </div>
          </div>`}
        <div class="panel prompt-card" id="card">
          <span class="cat" id="pcat">&nbsp;</span>
          <div class="q" id="pq">Get ready…</div>
        </div>
        <form class="guess-form" id="form" autocomplete="off">
          <input class="guess-input" id="guess" type="text" inputmode="text" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Type a rare answer…" aria-label="Your answer" maxlength="60">
          <button class="btn" type="submit" id="submit">GO</button>
        </form>
        <div class="under-input"><div class="misses" id="misses"></div><span class="feedback" id="fb"></span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <button class="btn ghost" type="button" id="giveup">${inf ? 'Surface' : 'Give up'}</button>
          <span class="kbd-hint"><kbd>Enter</kbd> submit · <kbd>Esc</kbd> ${inf ? 'surface' : 'give up'}</span>
        </div>
      </section>`;
    paintPips();
    $('#form').addEventListener('submit', (e) => { e.preventDefault(); onSubmit(); });
    $('#giveup').addEventListener('click', () => giveUp());
    $('#guess').addEventListener('input', () => { $('#fb').textContent = ''; });
    focusInput();
  }

  function focusInput() { const g = $('#guess'); if (g) { try { g.focus({ preventScroll: true }); } catch (e) { g.focus(); } } }

  function paintPips() {
    if (game.mode === 'infinite') return;
    const pips = document.querySelectorAll('#pips .pip');
    pips.forEach((p, i) => {
      const r = game.data.rounds[i];
      p.className = 'pip' + (i === game.round && !r ? ' current' : '');
      p.style.background = r ? (r.tier >= 0 ? tierVar(TIERS[r.tier]) : 'var(--t-miss)') : '';
    });
  }

  function setDepthReadout() {
    const el = $('#depth');
    if (el) el.textContent = fmt(game.score * M_PER_PT) + ' m';
    Ocean.setDepth(game.score * M_PER_PT);
  }

  function beginRound() {
    if (!game) return;
    const inf = game.mode === 'infinite';
    let id;
    if (inf) {
      if (game.round >= game.queue.length) game.queue = game.queue.concat(shuffle(PROMPTS.map((p) => p.id), Math.random));
      id = game.queue[game.round];
    } else {
      if (game.round >= ROUNDS) return finishDaily();
      id = game.ids[game.round];
    }
    const sh = sheet(id);
    game.cur = { id, sh, misses: [], phase: 'play' };
    const card = $('#card');
    card.querySelectorAll('.reveal').forEach((r) => r.remove());
    card.classList.remove('enter', 'revealed'); void card.offsetWidth; card.classList.add('enter');
    $('#pcat').textContent = sh.prompt.cat;
    $('#pq').textContent = sh.prompt.prompt;
    $('#rnum').textContent = game.round + 1;
    $('#misses').innerHTML = '';
    $('#fb').textContent = '';
    const g = $('#guess');
    g.value = ''; g.readOnly = false; g.placeholder = 'Type a rare answer…';
    $('#submit').disabled = false;
    $('#giveup').disabled = false;
    setDepthReadout();
    paintPips();
    focusInput();
    Motion.promptIn(card, $('#pq'), $('#pcat'));

    if (inf) {
      game.lastFrame = performance.now();
      runClock();
    } else {
      const saved = game.data.cur && game.data.cur.id === id ? game.data.cur : null;
      const left = saved ? Math.max(1, saved.left) : ROUND_TIME;
      if (saved && saved.misses) saved.misses.forEach((m) => addMissChip(m));
      if (saved) game.cur.misses = (saved.misses || []).slice();
      game.cur.endAt = performance.now() + left * 1000;
      game.data.cur = { id, left, misses: game.cur.misses };
      saveDive(game.dive, game.data);
      game.lastSave = 0;
      game.lastTick = Math.ceil(left);
      runClock();
    }
  }

  function runClock() {
    cancelAnimationFrame(loopId);
    const inf = game.mode === 'infinite';
    const tnum = $('#tnum'), tbar = $('#tbar'), timer = $('#timer');
    const oxyFill = $('#oxy-fill'), oxyNum = $('#oxy-num'), oxy = $('#oxy');
    const step = (now) => {
      if (!game || !game.cur || game.cur.phase !== 'play') return;
      if (inf) {
        const dt = (now - game.lastFrame) / 1000;
        game.lastFrame = now;
        game.o2 = Math.max(0, game.o2 - dt);
        oxyFill.style.transform = `scaleX(${game.o2 / O2_MAX})`;
        oxyNum.textContent = game.o2.toFixed(1) + 's';
        oxy.classList.toggle('low', game.o2 < 10);
        if (game.o2 <= 0) return timeout();
      } else {
        const left = Math.max(0, (game.cur.endAt - now) / 1000);
        tnum.textContent = Math.ceil(left);
        tbar.style.strokeDashoffset = String(175.93 * (1 - left / ROUND_TIME));
        timer.classList.toggle('low', left <= 5);
        const whole = Math.ceil(left);
        if (whole !== game.lastTick) { game.lastTick = whole; if (whole <= 5 && whole > 0) sound.tick(); }
        if (now - game.lastSave > 500) {
          game.lastSave = now;
          game.data.cur.left = left;
          saveDive(game.dive, game.data);
        }
        if (left <= 0) return timeout();
      }
      loopId = requestAnimationFrame(step);
    };
    loopId = requestAnimationFrame(step);
  }

  function addMissChip(text) {
    const c = document.createElement('span');
    c.className = 'miss-chip'; c.textContent = text;
    $('#misses').appendChild(c);
    return c;
  }

  function onSubmit() {
    if (!game || !game.cur) return;
    if (game.cur.phase === 'reveal') return advance();
    const g = $('#guess');
    const raw = g.value.trim();
    if (!raw) return;
    const key = M.normalize(raw);
    if (game.cur.misses.some((m) => M.normalize(m) === key)) {
      $('#fb').textContent = 'Already tried that';
      shake(g);
      g.select();
      return;
    }
    const rank = M.match(game.cur.sh.index, raw);
    if (rank < 0) return wrong(raw);
    correct(rank, raw);
  }

  function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

  function wrong(raw) {
    const g = $('#guess');
    sound.bad();
    if (Motion.enabled) Motion.reject(g, raw); else shake(g);
    if (navigator.vibrate) { try { navigator.vibrate(40); } catch (e) { /* ignore */ } }
    game.cur.misses.push(raw);
    Motion.chip(addMissChip(raw));
    $('#fb').textContent = 'Not on the sheet';
    g.value = '';
    if (game.mode === 'infinite') {
      game.o2 = Math.max(0, game.o2 - PENALTY);
      floater(`-${PENALTY}s`, $('#oxy'), 'var(--bad)');
    } else {
      game.cur.endAt -= PENALTY * 1000;
      game.data.cur.misses = game.cur.misses;
      const t = $('#timer');
      const pen = document.createElement('span');
      pen.className = 'pen'; pen.textContent = `-${PENALTY}s`;
      t.appendChild(pen); setTimeout(() => pen.remove(), 900);
    }
  }

  function correct(rank, raw) {
    const e = game.cur.sh.entries[rank];
    const tier = TIERS[e.tier];
    const fromM = game.score * M_PER_PT;
    game.score += tier.pts;
    const rec = { id: game.cur.id, guess: raw, rank, tier: e.tier, pts: tier.pts };
    sound.good(e.tier);
    const r = $('#card').getBoundingClientRect();
    Ocean.burst(r.left + r.width / 2, r.top + r.height / 2, cssColour(tier), 18 + e.tier * 8);
    if (game.mode === 'infinite') {
      game.o2 = Math.min(O2_MAX, game.o2 + tier.o2);
      floater(`+${tier.o2}s O₂`, $('#oxy'), tierVar(tier));
    }
    recordRound(rec);
    const panel = reveal(rec);
    const colour = cssColour(tier);
    Motion.accept($('#guess'), panel.querySelector('.your-ans'), raw, colour);
    Motion.plunge($('#view .screen'), e.tier, $('#depth'), fromM, game.score * M_PER_PT);
    if (game.mode !== 'infinite') Motion.pip(document.querySelectorAll('#pips .pip')[game.round]);
    if (e.tier >= 4) Motion.shockwave($('#card'), colour);
  }

  function timeout() {
    if (!game || !game.cur || game.cur.phase !== 'play') return;
    sound.over();
    const rec = { id: game.cur.id, guess: null, rank: -1, tier: -1, pts: 0 };
    recordRound(rec);
    reveal(rec, game.mode === 'infinite' ? 'Out of oxygen' : 'Out of air');
    Motion.miss($('#card'));
  }

  let lastEsc = 0;
  function giveUp(fromKey) {
    if (!game || !game.cur || game.cur.phase !== 'play') return;
    if (fromKey && Date.now() - lastEsc > 1500) { lastEsc = Date.now(); toast(game.mode === 'infinite' ? 'Press Esc again to surface' : 'Press Esc again to give up'); return; }
    if (game.mode === 'infinite') { game.o2 = 0; return timeout(); }
    sound.over();
    const rec = { id: game.cur.id, guess: null, rank: -1, tier: -1, pts: 0 };
    recordRound(rec);
    reveal(rec, 'You surfaced');
    Motion.miss($('#card'));
  }

  function recordRound(rec) {
    game.cur.phase = 'reveal';
    cancelAnimationFrame(loopId);
    if (game.mode === 'infinite') {
      game.rounds.push(rec);
    } else {
      rec.misses = game.cur.misses.length;
      game.data.rounds.push(rec);
      game.data.cur = null;
      game.data.score = game.score;
      saveDive(game.dive, game.data);
    }
    setDepthReadout();
    paintPips();
  }

  function reveal(rec, missTitle) {
    const sh = game.cur.sh;
    const rarest = sh.entries[sh.entries.length - 1];
    const tier = rec.tier >= 0 ? TIERS[rec.tier] : MISS;
    const e = rec.rank >= 0 ? sh.entries[rec.rank] : null;
    const ended = game.mode === 'infinite' && game.o2 <= 0;
    const hold = ended ? 3200 : rec.tier === 5 ? 3600 : rec.tier >= 0 ? 2600 : 3000;
    const g = $('#guess');
    g.readOnly = true; g.placeholder = '';
    $('#submit').disabled = false;
    $('#giveup').disabled = true;
    const div = document.createElement('div');
    div.className = 'reveal' + (rec.tier === 5 ? ' krillion' : '');
    div.style.setProperty('--tc', tierVar(tier));
    div.innerHTML = e
      ? `<div class="tier-badge">${tier.name}</div>
         <div class="your-ans">${esc(e.display)}</div>
         <div class="pts">+<span data-count="${tier.pts}">${tier.pts}</span> pts · +${fmt(tier.pts * M_PER_PT)} m</div>
         <div class="blurb">${tier.blurb} About ${shareLabel(e.share)} of divers say this.</div>
         ${rec.tier !== 5 ? `<div class="rarest">One in a Krillion: <b>${esc(rarest.display)}</b></div>` : ''}`
      : `<div class="tier-badge">${missTitle}</div>
         <div class="blurb">Top answer was <b>${esc(sh.entries[0].display)}</b>. The deepest was <b style="color:var(--t-krillion)">${esc(rarest.display)}</b>.</div>`;
    div.innerHTML += `<div class="reveal-bar"><i style="animation-duration:${hold}ms"></i></div><div class="continue">${ended ? 'Surfacing…' : 'Enter or tap to continue'}</div>`;
    div.addEventListener('click', advance);
    $('#card').appendChild(div);
    $('#card').classList.remove('enter');
    $('#card').classList.add('revealed');
    g.value = '';
    Motion.reveal(div, rec.tier);
    clearTimeout(game.advTimer);
    game.advTimer = setTimeout(advance, hold);
    return div;
  }

  function advance() {
    if (!game || !game.cur || game.cur.phase !== 'reveal') return;
    clearTimeout(game.advTimer);
    game.cur.phase = 'done';
    if (game.mode === 'infinite') {
      if (game.o2 <= 0) return finishInfinite();
      game.round++;
      game.lastFrame = performance.now();
      return beginRound();
    }
    game.round++;
    if (game.round >= ROUNDS) return finishDaily();
    beginRound();
  }

  function finishDaily() {
    stopLoops();
    const d = game.data;
    const n = game.dive;
    if (!d.done) {
      d.done = true;
      d.score = d.rounds.reduce((a, r) => a + r.pts, 0);
      d.finishedAt = Date.now();
      saveDive(n, d);
      const st = stats();
      st.played++;
      st.total += d.score;
      st.best = Math.max(st.best, d.score);
      d.rounds.forEach((r) => { st.tiers[r.tier >= 0 ? r.tier : 6]++; });
      if (game.mode === 'daily') {
        st.streak = st.lastDive === n - 1 ? st.streak + 1 : st.lastDive === n ? st.streak : 1;
        st.lastDive = n;
        st.maxStreak = Math.max(st.maxStreak, st.streak);
      }
      store.set('stats', st);
    }
    const mode = game.mode;
    game = null;
    results(n, mode === 'archive');
  }

  function finishInfinite() {
    stopLoops();
    const st = stats();
    const best = st.infBest;
    st.infBest = Math.max(st.infBest, game.score);
    st.infPlayed++;
    store.set('stats', st);
    const seen = game.rounds.map((r) => r.id);
    store.set('infRecent', seen.concat(store.get('infRecent', [])).filter((v, i, a) => a.indexOf(v) === i).slice(0, Math.floor(PROMPTS.length * 0.6)));
    const g = game;
    game = null;
    resultsInfinite(g, g.score > best && g.score > 0);
  }

  // ================================================================ RESULTS
  function roundRows(rounds) {
    return rounds.map((r, i) => {
      const sh = sheet(r.id);
      const t = r.tier >= 0 ? TIERS[r.tier] : MISS;
      return `
        <div>
          <button class="round-row" type="button" data-i="${i}" style="--tc:${tierVar(t)}" aria-expanded="false">
            <span class="stripe"></span>
            <span style="min-width:0"><span class="rq">${esc(sh.prompt.prompt)}</span><br><span class="ra">${r.rank >= 0 ? esc(sh.entries[r.rank].display) : '—'}</span> <span class="rt">${t.name}</span></span>
            <span class="rp">${r.pts}<small>${r.rank >= 0 ? shareLabel(sh.entries[r.rank].share) : ''}</small></span>
          </button>
          <div class="sheet-wrap" data-sheet="${i}" hidden></div>
        </div>`;
    }).join('');
  }
  function wireRoundRows(rounds) {
    document.querySelectorAll('.round-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.i;
        const wrap = document.querySelector(`[data-sheet="${i}"]`);
        const open = wrap.hidden;
        wrap.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        if (open && !wrap.innerHTML) {
          const sh = sheet(rounds[i].id);
          wrap.innerHTML = `<div class="sheet"><div class="sheet-legend">Full answer sheet · ${sh.entries.length} accepted answers, most common first</div>${sh.entries.map((e) =>
            `<span class="${e.rank === rounds[i].rank ? 'you' : ''}" style="--tc:${tierVar(TIERS[e.tier])}" title="${TIERS[e.tier].name} · ${shareLabel(e.share)}">${esc(e.display)}</span>`).join('')}</div>`;
        }
      });
    });
  }

  function drawHist(canvas, scores, mine) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    const maxPts = ROUNDS * 100, bins = 28, bw = maxPts / bins;
    const counts = new Array(bins).fill(0);
    scores.forEach((s) => counts[Math.min(bins - 1, Math.floor(s / bw))]++);
    const peak = Math.max(...counts);
    const myBin = Math.min(bins - 1, Math.floor(mine / bw));
    const gap = 2, colW = (w - gap * (bins - 1)) / bins, base = h - 16;
    const style = getComputedStyle(document.documentElement);
    const krill = style.getPropertyValue('--krill').trim();
    const faint = style.getPropertyValue('--ink-faint').trim();
    counts.forEach((n, i) => {
      const bh = peak ? Math.max(2, (n / peak) * (base - 6)) : 2;
      c.fillStyle = i === myBin ? krill : 'rgba(150,215,235,.22)';
      const x = i * (colW + gap);
      c.beginPath();
      if (c.roundRect) c.roundRect(x, base - bh, colW, bh, [3, 3, 0, 0]); else c.rect(x, base - bh, colW, bh);
      c.fill();
    });
    c.fillStyle = faint;
    c.font = '10px ' + style.getPropertyValue('--f-mono');
    c.textAlign = 'left'; c.fillText('0 m', 0, h - 2);
    c.textAlign = 'center'; c.fillText(fmt(maxPts * M_PER_PT / 2) + ' m', w / 2, h - 2);
    c.textAlign = 'right'; c.fillText(fmt(maxPts * M_PER_PT) + ' m', w, h - 2);
  }

  function shareText(n, d, pct) {
    let url = '';
    try { if (/^https?:/.test(location.protocol) && window.top === window) url = '\n' + location.origin + location.pathname; } catch (e) { /* cross-origin frame */ }
    return `Krill Dive #${n} · ${fmt(d.score * M_PER_PT)} m\n${d.rounds.map((r) => (r.tier >= 0 ? TIERS[r.tier] : MISS).emoji).join('')}\n${zoneFor(d.score * M_PER_PT).name} · deeper than ${Math.floor(pct)}% of divers${url}`;
  }

  function copy(text) {
    const done = () => toast('Copied to clipboard');
    const fallback = () => {
      const pre = $('#share-pre');
      if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      toast('Select the text above and copy it');
    };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }

  function results(n, isArchive) {
    stopLoops();
    const d = loadDive(n);
    if (!d || !d.done) return home();
    const m = d.score * M_PER_PT;
    Ocean.setDepth(m);
    const scores = reef(n, d.ids);
    const pct = percentile(scores, d.score);
    const best = d.rounds.reduce((b, r) => Math.max(b, r.tier), -1);
    const st = stats();
    const text = shareText(n, d, pct);
    const today = n === todayDive();
    view.innerHTML = `
      <section class="screen">
        <div class="result-hero">
          <span class="eyebrow">${today ? 'Today’s dive' : 'Past dive'} · #${n} · ${dateLabel(n)}</span>
          <div class="depth" id="depth-big">0<small>m</small></div>
          <span class="zone-chip">${zoneFor(m).name}</span>
        </div>
        <div class="result-stats">
          <div class="panel stat"><b>${d.score}</b><span>Points</span></div>
          <div class="panel stat"><b>${Math.floor(pct)}%</b><span>Percentile</span></div>
          <div class="panel stat"><b style="color:${best >= 0 ? tierVar(TIERS[best]) : 'inherit'};font-size:${best === 5 ? '.9rem' : '1.1rem'}">${best >= 0 ? TIERS[best].name : '—'}</b><span>Deepest find</span></div>
        </div>
        <div class="panel rank-panel">
          <div class="rank-line"><span class="eyebrow">Ranking</span><span class="big">Top ${Math.max(1, Math.ceil(100 - pct))}%</span></div>
          <canvas class="hist" id="hist" aria-label="Distribution of depths reached by divers today"></canvas>
          <div class="hist-cap">You went deeper than ${Math.floor(pct)}% of ${fmt(scores.length)} simulated divers on this dive. Median: ${fmt(scores[scores.length >> 1] * M_PER_PT)} m.</div>
        </div>
        <div class="panel" style="display:grid;gap:12px">
          <div class="eyebrow">Your dive · tap a prompt for its full answer sheet</div>
          <div class="rounds">${roundRows(d.rounds)}</div>
        </div>
        <div class="panel" style="display:grid;gap:12px">
          <div class="eyebrow">Share</div>
          <div class="share-preview" id="share-pre">${esc(text)}</div>
          <div class="share-row">
            <button class="btn" type="button" id="copy">Copy result</button>
            <button class="btn secondary" type="button" id="inf">Infinite Dive</button>
          </div>
        </div>
        <div class="result-stats">
          <div class="panel stat"><b>${currentStreak(st)}</b><span>Streak</span></div>
          <div class="panel stat"><b>${st.played}</b><span>Dives</span></div>
          <div class="panel stat"><b class="countdown" id="cd" style="font-size:1.05rem">${hms(msToNextDive())}</b><span>Next dive</span></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn ghost" type="button" id="arch">Past dives</button>
          <button class="btn ghost" type="button" id="homeb">Home</button>
        </div>
      </section>`;
    countUp($('#depth-big'), m, 1400, '<small>m</small>');
    Motion.stagger(document.querySelectorAll('#view .screen > *'), { each: 0.08, y: 40 });
    Motion.stagger(document.querySelectorAll('.round-row'), { each: 0.07, delay: 0.45, y: 20 });
    requestAnimationFrame(() => drawHist($('#hist'), scores, d.score));
    wireRoundRows(d.rounds);
    $('#copy').addEventListener('click', () => copy(text));
    $('#inf').addEventListener('click', startInfinite);
    $('#arch').addEventListener('click', archive);
    $('#homeb').addEventListener('click', home);
    clockTimer = setInterval(() => { const el = $('#cd'); if (!el) return clearInterval(clockTimer); el.textContent = hms(msToNextDive()); }, 1000);
    if (isArchive) toast('Past dives don’t count toward your streak');
  }

  function resultsInfinite(g, isBest) {
    const m = g.score * M_PER_PT;
    const st = stats();
    const found = g.rounds.filter((r) => r.tier >= 0).length;
    const best = g.rounds.reduce((b, r) => Math.max(b, r.tier), -1);
    view.innerHTML = `
      <section class="screen">
        <div class="result-hero">
          <span class="eyebrow">Infinite dive · ${isBest ? 'new personal best' : 'out of oxygen'}</span>
          <div class="depth" id="depth-big">0<small>m</small></div>
          <span class="zone-chip">${zoneFor(m).name}</span>
        </div>
        <div class="result-stats">
          <div class="panel stat"><b>${g.score}</b><span>Points</span></div>
          <div class="panel stat"><b>${found}</b><span>Answers</span></div>
          <div class="panel stat"><b>${fmt(st.infBest * M_PER_PT)}</b><span>Best m</span></div>
        </div>
        ${best >= 0 ? `<p class="mode-note">Deepest find: <b style="color:${tierVar(TIERS[best])}">${TIERS[best].name}</b></p>` : ''}
        <div class="panel" style="display:grid;gap:12px">
          <div class="eyebrow">This run · tap a prompt for its full answer sheet</div>
          <div class="rounds">${roundRows(g.rounds)}</div>
        </div>
        <div class="share-row">
          <button class="btn" type="button" id="again">Dive again</button>
          <button class="btn secondary" type="button" id="homeb">Home</button>
        </div>
      </section>`;
    countUp($('#depth-big'), m, 1200, '<small>m</small>');
    Motion.stagger(document.querySelectorAll('#view .screen > *'), { each: 0.08, y: 40 });
    wireRoundRows(g.rounds);
    $('#again').addEventListener('click', startInfinite);
    $('#homeb').addEventListener('click', home);
  }

  // ================================================================ MODALS
  function modal(html, onClose) {
    closeModal();
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) closeModal(); });
    back._onClose = onClose;
    document.body.appendChild(back);
    const btn = back.querySelector('[data-close]');
    if (btn) btn.focus();
    return back;
  }
  function closeModal() {
    document.querySelectorAll('.modal-back').forEach((m) => { m.remove(); if (m._onClose) m._onClose(); });
    if (game && game.cur && game.cur.phase === 'play') focusInput();
  }
  const closeBtn = '<button class="icon-btn" type="button" data-close aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';

  function help() {
    modal(`
      <div class="modal-head"><h2>How to dive</h2>${closeBtn}</div>
      <ol>
        <li>Every day there are <b>7 prompts</b>, the same for everyone. A new dive drops at <b>00:00 UTC</b>.</li>
        <li>You get <b>${ROUND_TIME} seconds</b> per prompt. Type an answer and press Enter.</li>
        <li>Your first <b>accepted</b> answer locks in and ends the round. Wrong guesses don’t end it, but each one costs <b>${PENALTY} seconds</b>.</li>
        <li>The <b>rarer</b> your answer, the more points. Each point takes you <b>${M_PER_PT} m</b> deeper.</li>
        <li>Spelling is forgiving: case, accents, “the”, plurals and small typos are fine.</li>
      </ol>
      <div class="tierlist">
        ${TIERS.slice().reverse().map((t) => `<div class="tierrow"><span class="dot" style="background:${tierVar(t)}"></span><span class="nm">${t.name}</span><span class="pt">${t.pts} pts</span><span class="dp">${fmt(t.pts * M_PER_PT)} m</span></div>`).join('')}
      </div>
      <p><b>Infinite Dive</b> has no daily limit. You start with ${O2_START}s of oxygen that drains constantly. Correct answers refill it (rarer answers refill more) and wrong guesses cost ${PENALTY}s. Dive until you run out.</p>
      <p>Only one answer per prompt is <b>One in a Krillion</b>: the very rarest on the sheet.</p>
      <button class="btn block" type="button" data-close>Let’s dive</button>`);
  }

  function statsModal() {
    const st = stats();
    const totalRounds = st.tiers.reduce((a, b) => a + b, 0);
    const peak = Math.max(1, ...st.tiers);
    const rows = TIERS.map((t, i) => ({ t, n: st.tiers[i] })).reverse().concat([{ t: MISS, n: st.tiers[6] }]);
    modal(`
      <div class="modal-head"><h2>Your dive log</h2>${closeBtn}</div>
      <div class="stat-grid">
        <div class="stat"><b>${st.played}</b><span>Dives</span></div>
        <div class="stat"><b>${currentStreak(st)}</b><span>Streak</span></div>
        <div class="stat"><b>${st.maxStreak}</b><span>Max streak</span></div>
        <div class="stat"><b>${st.played ? fmt((st.total / st.played) * M_PER_PT) : 0}</b><span>Avg m</span></div>
        <div class="stat"><b>${fmt(st.best * M_PER_PT)}</b><span>Best m</span></div>
        <div class="stat"><b>${fmt(st.infBest * M_PER_PT)}</b><span>Infinite m</span></div>
        <div class="stat"><b>${st.infPlayed}</b><span>Infinite runs</span></div>
        <div class="stat"><b>${totalRounds ? Math.round(((totalRounds - st.tiers[6]) / totalRounds) * 100) : 0}%</b><span>Answered</span></div>
      </div>
      <div class="eyebrow">Tier distribution (daily prompts)</div>
      <div class="tier-bars">
        ${rows.map(({ t, n }) => `<div class="tier-bar" style="--tc:${tierVar(t)}"><span>${t.name}</span><div class="track"><div class="fill" style="width:${(n / peak) * 100}%"></div></div><span class="n">${n}</span></div>`).join('')}
      </div>`);
  }

  function archive() {
    const today = todayDive();
    const items = [];
    for (let n = today; n >= 1; n--) {
      const d = loadDive(n);
      items.push(`<button class="arch ${d && d.done ? 'done' : ''}" type="button" data-n="${n}"><b>#${n}</b><span>${d && d.done ? fmt(d.score * M_PER_PT) + ' m' : d && d.rounds && d.rounds.length ? 'in progress' : dateLabel(n)}</span></button>`);
    }
    const back = modal(`
      <div class="modal-head"><h2>Past dives</h2>${closeBtn}</div>
      <p>Replay any earlier dive. Past dives don’t affect your streak.</p>
      <div class="archive-list">${items.join('')}</div>`);
    back.querySelectorAll('.arch').forEach((b) => b.addEventListener('click', () => {
      const n = +b.dataset.n;
      closeModal();
      const d = loadDive(n);
      if (d && d.done) results(n, n !== today);
      else startDaily(n, n !== today);
    }));
  }

  // ================================================================ global wiring
  $('#btn-help').addEventListener('click', help);
  $('#btn-stats').addEventListener('click', statsModal);
  $('#brand').addEventListener('click', () => {
    if (game && game.mode !== 'infinite' && game.cur && game.cur.phase === 'play') { toast('Finish or give up this prompt first'); return; }
    if (game && game.mode === 'infinite') { toast('Surface first to leave the dive'); return; }
    home();
  });
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-back')) { if (e.key === 'Escape') closeModal(); return; }
    if (!game || !game.cur) return;
    if (e.key === 'Escape') { e.preventDefault(); giveUp(true); return; }
    if (game.cur.phase === 'reveal' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); advance(); return; }
    if (game.cur.phase === 'play' && e.key.length === 1 && document.activeElement !== $('#guess') && !e.metaKey && !e.ctrlKey) focusInput();
  });
  // Keep the infinite oxygen clock honest when the tab is hidden then shown.
  document.addEventListener('visibilitychange', () => {
    if (game && game.mode === 'infinite' && document.visibilityState === 'visible') runClockIfPlaying();
  });
  function runClockIfPlaying() { if (game && game.cur && game.cur.phase === 'play') runClock(); }

  // test hook for tools/smoke.js
  window.__krill = { promptsForDive, sheet, reef, percentile, todayDive, TIERS };

  home();
})();
