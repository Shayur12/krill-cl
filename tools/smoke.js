#!/usr/bin/env node
/* End-to-end smoke test in headless Chromium.
   Usage: node tools/smoke.js [screenshotDir]   (needs the `playwright` package on NODE_PATH) */
const path = require('path');
const { chromium } = require('playwright');

const shots = process.argv[2];
const url = 'file://' + path.join(process.env.SITE_DIR || path.join(__dirname, '..'), 'index.html');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const vp of [{ width: 1280, height: 860 }, { width: 390, height: 780 }]) {
    const page = await browser.newPage({ viewport: vp });
    // CDN scripts can be served from a local copy when the test machine is offline.
    if (process.env.GSAP_LOCAL) await page.route('**/gsap.min.js', (r) => r.fulfill({ path: process.env.GSAP_LOCAL, contentType: 'text/javascript' }));
    page.on('pageerror', (e) => errors.push(`[${vp.width}] ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(`[${vp.width}] console: ${m.text()}`); });
    await page.goto(url);
    const tag = vp.width < 500 ? 'phone' : 'desk';
    const snap = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${tag}-${name}.png`) }); };

    await page.waitForSelector('.modal');
    await snap('help');
    await page.click('.modal [data-close]');
    await snap('home');

    // Daily dive: answer with different rarity levels, one wrong guess, one give-up.
    await page.click('#go-daily');
    await page.waitForFunction(() => !document.querySelector('.countin'), null, { timeout: 5000 });
    const plan = await page.evaluate(() => {
      const k = window.__krill;
      return k.promptsForDive(k.todayDive()).map((id) => {
        const s = k.sheet(id);
        return { id, first: s.entries[0].display, last: s.entries[s.entries.length - 1].display, mid: s.entries[Math.floor(s.entries.length * 0.6)].display };
      });
    });
    for (let i = 0; i < plan.length; i++) {
      await page.waitForFunction(() => document.querySelector('#guess') && !document.querySelector('#guess').readOnly);
      if (i === 1) {
        await page.fill('#guess', 'zzzz not an answer');
        await page.press('#guess', 'Enter');
        await page.waitForSelector('.miss-chip');
        await snap('wrong');
      }
      if (i === 4) {
        await page.click('#giveup');
      } else {
        const ans = i === 2 ? plan[i].last : i === 3 ? plan[i].first : plan[i].mid;
        // simulate a small typo on long answers to exercise fuzzy matching
        const typed = i === 5 && ans.length > 6 ? ans.slice(0, -2) + ans.slice(-1) + ans.slice(-2, -1) : ans.toLowerCase();
        await page.fill('#guess', typed);
        await page.press('#guess', 'Enter');
      }
      await page.waitForSelector('.reveal');
      if (i === 0) { await page.waitForTimeout(260); await snap('plunge-mid'); }
      if (i === 2) { await page.waitForTimeout(800); await snap('reveal-krillion'); }
      const title = await page.textContent('.reveal .tier-badge');
      console.log(`[${tag}] round ${i + 1}: ${title}`);
      await page.waitForTimeout(450);
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('#hist');
    await page.waitForTimeout(1600);
    await snap('results');
    await page.click('.round-row');
    await page.waitForSelector('.sheet');
    const depth = await page.textContent('#depth-big');
    const pct = await page.textContent('.rank-line .big');
    console.log(`[${tag}] results: ${depth.trim()} · ${pct}`);

    // Reload keeps the finished dive.
    await page.reload();
    await page.waitForSelector('#go-results');

    // Infinite: one right answer, then surface.
    await page.click('#go-inf');
    await page.waitForFunction(() => !document.querySelector('.countin'), null, { timeout: 5000 });
    const ans = await page.evaluate(() => {
      const q = document.querySelector('#pq').textContent;
      const p = window.KRILL_PROMPTS.find((x) => x.prompt === q);
      return p.answers[3].split('|')[0];
    });
    await page.fill('#guess', ans);
    await page.press('#guess', 'Enter');
    await page.waitForSelector('.reveal');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#guess').readOnly);
    await snap('infinite');
    await page.click('#giveup');
    await page.waitForSelector('#again', { timeout: 6000 });
    await snap('infinite-results');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) errors.push(`[${vp.width}] horizontal overflow`);
    await page.close();
  }
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('smoke OK');
})().catch((e) => { console.error(e); process.exit(1); });
