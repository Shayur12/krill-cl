#!/usr/bin/env node
/* Bundles the game into one self-contained HTML file: dist/krill-dive.html.
   Pass --fragment to omit the <html>/<head>/<body> wrapper (for hosts that supply their own skeleton). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fragment = process.argv.includes('--fragment');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, href) =>
  `<style>\n${fs.readFileSync(path.join(root, href), 'utf8')}\n</style>`);
html = html.replace(/<script src="(?!https?:)([^"]+)"><\/script>/g, (_, src) =>
  `<script>\n${fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`);

if (fragment) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\s*/, '')
    .replace(/<meta name="viewport"[^>]*>\s*/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = head.trim() + '\n' + body.trim() + '\n';
}

const out = path.join(root, 'dist', fragment ? 'krill-dive.fragment.html' : 'krill-dive.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
