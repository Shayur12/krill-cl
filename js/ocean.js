/* Ambient ocean: a gradient that darkens with depth, drifting marine snow, rising bubbles, and bursts. */
(function () {
  const canvas = document.getElementById('ocean');
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1;
  let depth = 0, depthTarget = 0; // metres, 0..7000+
  const snow = [], bubbles = [], bursts = [];

  // Ocean zones, surface to trench. Colours are [top, bottom] of the gradient.
  const STOPS = [
    { m: 0, top: [22, 128, 158], bot: [6, 52, 78] },
    { m: 200, top: [13, 82, 112], bot: [4, 33, 52] },
    { m: 1000, top: [8, 46, 72], bot: [3, 20, 34] },
    { m: 4000, top: [6, 24, 44], bot: [2, 10, 20] },
    { m: 7000, top: [10, 10, 30], bot: [1, 3, 8] },
  ];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function colourAt(m, key) {
    for (let i = 0; i < STOPS.length - 1; i++) {
      const a = STOPS[i], b = STOPS[i + 1];
      if (m <= b.m) {
        const t = Math.max(0, (m - a.m) / (b.m - a.m));
        return a[key].map((v, j) => Math.round(lerp(v, b[key][j], t)));
      }
    }
    return STOPS[STOPS.length - 1][key];
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const want = Math.round((W * H) / 9000);
    while (snow.length < want) snow.push(makeSnow(true));
    snow.length = Math.min(snow.length, want);
  }

  function makeSnow(anywhere) {
    return {
      x: Math.random() * W, y: anywhere ? Math.random() * H : -5,
      r: Math.random() * 1.6 + 0.3, vy: Math.random() * 0.25 + 0.05,
      sway: Math.random() * Math.PI * 2, a: Math.random() * 0.5 + 0.15,
    };
  }
  function makeBubble(x, y, big) {
    return {
      x: x == null ? Math.random() * W : x, y: y == null ? H + 10 : y,
      r: big ? Math.random() * 5 + 2 : Math.random() * 3 + 1,
      vy: -(Math.random() * 0.8 + 0.4), wob: Math.random() * Math.PI * 2, life: 1,
    };
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last) / 16.67;
    last = now;
    depth += (depthTarget - depth) * Math.min(1, 0.04 * dt);

    const top = colourAt(depth, 'top'), bot = colourAt(depth, 'bot');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgb(${top})`);
    g.addColorStop(1, `rgb(${bot})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // light shafts near the surface, fading with depth
    const light = Math.max(0, 1 - depth / 900);
    if (light > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const x = (W / 4) * i + Math.sin(now / 4000 + i * 1.7) * 60 + W / 8;
        const lg = ctx.createLinearGradient(x, 0, x + 80, H * 0.8);
        lg.addColorStop(0, `rgba(150,230,255,${0.06 * light})`);
        lg.addColorStop(1, 'rgba(150,230,255,0)');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(x - 30, 0); ctx.lineTo(x + 40, 0); ctx.lineTo(x + 180, H * 0.85); ctx.lineTo(x + 40, H * 0.85);
        ctx.fill();
      }
      ctx.restore();
    }

    if (!reduce) {
      ctx.fillStyle = '#d8f4ff';
      for (const s of snow) {
        s.y += s.vy * dt; s.sway += 0.01 * dt;
        const x = s.x + Math.sin(s.sway) * 6;
        if (s.y > H + 5) Object.assign(s, makeSnow(false));
        ctx.globalAlpha = s.a * (0.6 + Math.min(0.4, depth / 3000));
        ctx.beginPath(); ctx.arc(x, s.y, s.r, 0, 6.283); ctx.fill();
      }
      if (Math.random() < 0.04 * dt) bubbles.push(makeBubble());
      ctx.strokeStyle = '#bdf3ff';
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.y += b.vy * dt * (1 + (b.r / 6)); b.wob += 0.05 * dt;
        if (b.burst) b.life -= 0.012 * dt;
        if (b.y < -10 || b.life <= 0) { bubbles.splice(i, 1); continue; }
        ctx.globalAlpha = 0.45 * b.life;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(b.x + Math.sin(b.wob) * 3, b.y, b.r, 0, 6.283); ctx.stroke();
      }
      for (let i = bursts.length - 1; i >= 0; i--) {
        const p = bursts[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy = p.vy * 0.96 - 0.03 * dt; p.life -= 0.02 * dt;
        if (p.life <= 0) { bursts.splice(i, 1); continue; }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + p.life / 2), 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  }

  window.Ocean = {
    setDepth(m, instant) { depthTarget = Math.max(0, m); if (instant) depth = depthTarget; },
    burst(x, y, colour, n) {
      if (reduce) return;
      for (let i = 0; i < (n || 26); i++) {
        const a = Math.random() * Math.PI * 2, sp = Math.random() * 5 + 1.5;
        bursts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, r: Math.random() * 3 + 1.5, c: colour, life: 1 });
      }
      for (let i = 0; i < 10; i++) {
        const b = makeBubble(x + (Math.random() - 0.5) * 80, y + Math.random() * 20, true);
        b.burst = true; bubbles.push(b);
      }
    },
  };

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();
