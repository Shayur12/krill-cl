/* Gameplay motion, driven by GSAP when it loads (falls back to the CSS animations otherwise).
   The motion language is descent: new prompts surface from below, accepted answers are carried
   down into the card and the whole screen plunges; rejected guesses sink away. */
(function () {
  const g = window.gsap;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const on = !!g && !reduce;
  if (on) document.documentElement.classList.add('gsap');

  // Wrap each character (or word) in spans so letters can move independently.
  function split(el, by) {
    const text = el.textContent;
    el.textContent = '';
    el.setAttribute('aria-label', text);
    const parts = by === 'word' ? text.split(/(\s+)/) : Array.from(text);
    return parts.map((p) => {
      if (/^\s+$/.test(p)) { el.appendChild(document.createTextNode(p)); return null; }
      const s = document.createElement('span');
      s.className = by === 'word' ? 'sw' : 'sc';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = p;
      el.appendChild(s);
      return s;
    }).filter(Boolean);
  }

  // Letters of a string positioned over `fromEl`, styled like it; caller animates and removes.
  function ghostLetters(text, fromEl) {
    const r = fromEl.getBoundingClientRect();
    const cs = getComputedStyle(fromEl);
    const box = document.createElement('div');
    box.className = 'ghost-word';
    box.style.cssText = `left:${r.left + parseFloat(cs.paddingLeft)}px;top:${r.top + r.height / 2}px;font:${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily};color:${cs.color}`;
    box.textContent = text;
    document.body.appendChild(box);
    return { box, letters: split(box, 'char') };
  }

  const Motion = {
    enabled: on,

    promptIn(card, q, cat) {
      if (!on) return;
      g.killTweensOf([card, q, cat]);
      const words = split(q, 'word');
      g.timeline()
        .fromTo(card, { y: 70, opacity: 0.4, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out' })
        .fromTo(cat, { y: 14, opacity: 0, letterSpacing: '0.5em' }, { y: 0, opacity: 1, letterSpacing: '0.16em', duration: 0.5, ease: 'power3.out' }, 0.05)
        .fromTo(words, { y: 46, opacity: 0, rotationX: -75, transformOrigin: '50% 100%' },
          { y: 0, opacity: 1, rotationX: 0, duration: 0.6, stagger: 0.055, ease: 'back.out(1.6)' }, 0.1);
    },

    // Accepted answer: the typed letters lift out of the input and settle into the reveal.
    accept(input, target, text, colour, done) {
      if (!on || !input || !target) { if (done) done(); return; }
      const { box, letters } = ghostLetters(text, input);
      const tr = target.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      const dx = tr.left + tr.width / 2 - (br.left + br.width / 2);
      const dy = tr.top + tr.height / 2 - (br.top + br.height / 2);
      g.set(target, { opacity: 0 });
      g.timeline({ onComplete: () => { box.remove(); g.to(target, { opacity: 1, duration: 0.12 }); if (done) done(); } })
        .to(letters, { y: -18, color: colour, duration: 0.16, stagger: 0.012, ease: 'power2.out' })
        .to(box, { x: dx, y: dy, scale: 1.25, duration: 0.42, ease: 'power3.inOut' }, 0.08)
        .to(letters, { y: 0, duration: 0.3, stagger: 0.01, ease: 'bounce.out' }, 0.32);
    },

    // Rejected guess: letters drop and scatter like something sinking past you.
    reject(input, text) {
      if (!on || !input || !text) return;
      const { box, letters } = ghostLetters(text, input);
      g.timeline({ onComplete: () => box.remove() })
        .to(letters, {
          y: () => 60 + Math.random() * 80,
          x: () => (Math.random() - 0.5) * 50,
          rotation: () => (Math.random() - 0.5) * 120,
          opacity: 0, color: '#ff6464',
          duration: 0.75, stagger: { each: 0.02, from: 'random' }, ease: 'power2.in',
        });
      g.fromTo(input, { x: -10 }, { x: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.25)' });
    },

    // Reveal panel: tier name tilts in letter by letter, points count up, the rest follows.
    reveal(panel, tierIdx) {
      if (!on || !panel) return;
      const badge = panel.querySelector('.tier-badge');
      const chars = badge ? split(badge, 'char') : [];
      const rest = panel.querySelectorAll('.pts, .blurb, .rarest, .continue, .reveal-bar');
      const big = tierIdx >= 4;
      const tl = g.timeline();
      tl.fromTo(panel, { clipPath: 'circle(0% at 50% 45%)' }, { clipPath: 'circle(150% at 50% 45%)', duration: 0.55, ease: 'power3.out' })
        .fromTo(chars, { y: 40, opacity: 0, '--yrot': -45, scale: big ? 1.6 : 1.2 },
          { y: 0, opacity: 1, '--yrot': 0, scale: 1, duration: 0.5, stagger: 0.03, ease: 'back.out(2)' }, 0.08)
        .fromTo(rest, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.06, ease: 'power2.out' }, 0.3);
      const pts = panel.querySelector('.pts [data-count]');
      if (pts) {
        const o = { v: 0 };
        const to = +pts.dataset.count;
        tl.to(o, { v: to, duration: 0.7, ease: 'power2.out', onUpdate: () => { pts.textContent = Math.round(o.v); } }, 0.3);
      }
    },

    // The dive itself: the screen lurches downward, the ocean streaks past, depth rolls.
    plunge(screen, tierIdx, depthEl, fromM, toM) {
      if (window.Ocean && Ocean.plunge) Ocean.plunge(0.4 + tierIdx * 0.32);
      if (!on) return;
      const amp = 6 + tierIdx * 4;
      g.timeline()
        .to(screen, { y: amp, duration: 0.14, ease: 'power2.out' })
        .to(screen, { y: 0, duration: 0.9, ease: 'elastic.out(1, 0.4)' });
      if (tierIdx === 5) {
        g.to(screen, { keyframes: { x: [-7, 6, -5, 4, -2, 1, 0] }, duration: 0.6, ease: 'none' });
      }
      if (depthEl) {
        const o = { v: fromM };
        g.to(o, { v: toM, duration: 1.1, ease: 'power3.out', onUpdate: () => { depthEl.textContent = Math.round(o.v).toLocaleString('en-US') + ' m'; } });
        g.fromTo(depthEl, { scale: 1.35, color: '#ff6f8e' }, { scale: 1, color: '', duration: 0.8, ease: 'back.out(3)' });
      }
    },

    shockwave(card, colour) {
      if (!on || !card) return;
      const r = card.getBoundingClientRect();
      for (let i = 0; i < 2; i++) {
        const ring = document.createElement('div');
        ring.className = 'shock';
        ring.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;border-color:${colour}`;
        document.body.appendChild(ring);
        g.fromTo(ring, { scale: 0.1, opacity: 0.9 }, { scale: 9 + i * 4, opacity: 0, duration: 1.1 + i * 0.3, delay: i * 0.12, ease: 'power2.out', onComplete: () => ring.remove() });
      }
    },

    pip(pip) {
      if (!on || !pip) return;
      g.fromTo(pip, { scaleY: 2.6, filter: 'brightness(2)' }, { scaleY: 1, filter: 'brightness(1)', duration: 0.6, ease: 'elastic.out(1, 0.35)' });
    },

    // Out of time / gave up: the card sinks and greys a little before the answer sheet shows.
    miss(card) {
      if (!on || !card) return;
      g.fromTo(card, { y: 0, filter: 'saturate(1)' }, { y: 12, filter: 'saturate(0.4)', duration: 0.25, ease: 'power2.in', yoyo: true, repeat: 1 });
    },

    chip(el) {
      if (!on || !el) return;
      g.fromTo(el, { y: -26, opacity: 0, scale: 0.6 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2.2)' });
    },

    // Staggered arrival for lists of things on non-game screens.
    stagger(els, opts) {
      if (!on || !els || !els.length) return;
      g.fromTo(els, { y: (opts && opts.y) || 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, stagger: (opts && opts.each) || 0.06, ease: 'power3.out', delay: (opts && opts.delay) || 0, clearProps: 'transform,opacity' });
    },

    title(el) {
      if (!on || !el) return;
      const chars = [];
      el.querySelectorAll('[data-split]').forEach((part) => chars.push(...split(part, 'char')));
      g.fromTo(chars, { y: 60, opacity: 0, '--yrot': 40 }, { y: 0, opacity: 1, '--yrot': 0, duration: 0.8, stagger: 0.022, ease: 'expo.out' });
    },
  };

  window.Motion = Motion;
})();
