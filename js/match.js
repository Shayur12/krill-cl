/* Answer normalisation + fuzzy matching. Shared by the browser game and the node validator. */
(function (root) {
  const NUM_WORDS = {
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
    eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', twenty: '20',
  };

  function stripAccents(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Canonical comparison key: lowercase, no accents, no punctuation, no leading articles,
  // "&" -> "and", "saint"/"st" unified, number words -> digits, whitespace removed.
  function normalize(raw) {
    let s = stripAccents(String(raw || '').toLowerCase().trim());
    s = s.replace(/&/g, ' and ').replace(/\+/g, ' plus ');
    s = s.replace(/['’`´.]/g, '');
    s = s.replace(/[^a-z0-9]+/g, ' ').trim();
    s = s.replace(/^(the|a|an) /, '');
    s = s.replace(/\bsaint\b/g, 'st').replace(/\bmount\b/g, 'mt');
    s = s.split(' ').map((w) => NUM_WORDS[w] || w).join(' ');
    return s.replace(/ /g, '');
  }

  // Looser key used as a second pass: drops trailing plural "s"/"es".
  function singular(key) {
    if (key.length > 4 && key.endsWith('ies')) return key.slice(0, -3) + 'y';
    if (key.length > 4 && /(ches|shes|xes|ses|zes|oes)$/.test(key)) return key.slice(0, -2);
    if (key.length > 3 && key.endsWith('s') && !key.endsWith('ss')) return key.slice(0, -1);
    return key;
  }

  function levenshtein(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    // Optimal string alignment distance (Levenshtein + adjacent transpositions), with early exit.
    let prev2 = null;
    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  function typoBudget(len) {
    if (len >= 10) return 2;
    if (len >= 5) return 1;
    return 0;
  }

  // Build a lookup index for one prompt. answers: ["Display|alias|alias", ...] ordered common -> rare.
  function buildIndex(answers) {
    const exact = new Map();
    const loose = new Map();
    const entries = [];
    answers.forEach((line, rank) => {
      const forms = line.split('|').map((f) => f.trim()).filter(Boolean);
      const keys = [];
      forms.forEach((f) => {
        const k = normalize(f);
        if (!k) return;
        keys.push(k);
        if (!exact.has(k)) exact.set(k, rank);
        const l = singular(k);
        if (!loose.has(l)) loose.set(l, rank);
      });
      entries.push({ rank, display: forms[0], keys });
    });
    return { exact, loose, entries };
  }

  // Returns rank index of the matched answer, or -1.
  function match(index, guess) {
    const k = normalize(guess);
    if (!k) return -1;
    if (index.exact.has(k)) return index.exact.get(k);
    const l = singular(k);
    if (index.loose.has(l)) return index.loose.get(l);
    const budget = typoBudget(k.length);
    if (budget === 0) return -1;
    let best = -1;
    let bestD = budget + 1;
    for (const e of index.entries) {
      for (const key of e.keys) {
        if (key.length < 5) continue; // never fuzz short answers
        const d = levenshtein(k, key, budget);
        if (d < bestD) {
          bestD = d;
          best = e.rank;
          if (d === 0) return best;
        }
      }
    }
    return bestD <= budget ? best : -1;
  }

  const api = { normalize, singular, levenshtein, buildIndex, match };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KrillMatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
