#!/usr/bin/env node
/* Validates prompt data files. Usage: node tools/validate.js [data/prompts-*.js ...] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { normalize, singular } = require('../js/match.js');

const dataDir = path.join(__dirname, '..', 'data');
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(dataDir).filter((f) => /^prompts-.*\.js$/.test(f)).map((f) => path.join(dataDir, f));

const ctx = { window: {} };
vm.createContext(ctx);
let errors = 0;
const err = (m) => { errors++; console.error('ERROR: ' + m); };

for (const f of files) {
  try {
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
  } catch (e) {
    err(`${f}: failed to evaluate: ${e.message}`);
  }
}

const prompts = ctx.window.KRILL_PROMPTS || [];
const ids = new Set();
const texts = new Set();
let answerTotal = 0;
for (const p of prompts) {
  const where = p && p.id ? p.id : JSON.stringify(p).slice(0, 60);
  if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) err(`${where}: bad id`);
  if (ids.has(p.id)) err(`${where}: duplicate id`);
  ids.add(p.id);
  if (!p.prompt || typeof p.prompt !== 'string') err(`${where}: missing prompt`);
  const t = normalize(p.prompt);
  if (texts.has(t)) err(`${where}: duplicate prompt text`);
  texts.add(t);
  if (!p.cat) err(`${where}: missing cat`);
  if (!Array.isArray(p.answers) || p.answers.length < 20) err(`${where}: needs >= 20 answers (has ${p.answers ? p.answers.length : 0})`);
  const seen = new Map();
  (p.answers || []).forEach((line, i) => {
    if (typeof line !== 'string' || !line.trim()) return err(`${where}: empty answer at ${i}`);
    for (const form of line.split('|')) {
      const k = normalize(form);
      if (!k) { err(`${where}: answer "${line}" has empty form`); continue; }
      for (const key of new Set([k, singular(k)])) {
        if (seen.has(key) && seen.get(key) !== i) err(`${where}: "${form}" collides with "${p.answers[seen.get(key)]}"`);
        seen.set(key, i);
      }
    }
  });
  answerTotal += (p.answers || []).length;
}

const cats = {};
prompts.forEach((p) => { cats[p.cat] = (cats[p.cat] || 0) + 1; });
console.log(`${prompts.length} prompts, ${answerTotal} answers across ${files.length} file(s)`);
console.log('By category:', cats);
if (errors) { console.error(`${errors} error(s)`); process.exit(1); }
console.log('OK');
