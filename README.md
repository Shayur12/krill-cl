# Krill Dive

A browser trivia game where the rarer your answer, the deeper you dive. It's an unofficial fan-made tribute inspired by [Krillion](https://krillion.io/), written from scratch as plain HTML, CSS and JavaScript with no build step and no dependencies.

## How it plays

- **Daily Dive**: 7 prompts, the same for everyone, refreshed at 00:00 UTC. You get 25 seconds per prompt.
- Your first **accepted** answer locks in and ends the round. Each wrong guess costs 2 seconds.
- Scoring is by rarity. 1 point takes you 10 m deeper:

  | Tier | Points | Depth |
  |---|---|---|
  | One in a Krillion (the single rarest answer) | 100 | 1,000 m |
  | Deep Cut | 85 | 850 m |
  | Rare | 60 | 600 m |
  | Schooler | 30 | 300 m |
  | Too Clever | 15 | 150 m |
  | Plankton | 10 | 100 m |

- **Rankings**: the results screen shows your percentile, a depth histogram, your ocean zone (Sunlight → Twilight → Midnight → Abyssal → Hadal), and a shareable emoji grid. Because the site is static, the percentile compares you against 4,000 simulated divers whose answer choices follow each prompt's popularity curve.
- **Infinite Dive**: endless prompts with a 45-second oxygen tank that drains constantly. Correct answers refill it (rarer answers refill more, up to 60 s) and wrong guesses cost 2 s.
- **Past Dives**: replay any earlier daily dive. Past dives don't count toward your streak.
- **Stats**: streaks, best and average depth, and your tier distribution, all saved in your browser.
- Matching is forgiving: case, accents, punctuation, a leading "the", plurals, number words and small typos are all accepted.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Host it on the web (GitHub Pages)

1. Merge this branch into `main`.
2. In the repo on GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The `Deploy to GitHub Pages` workflow publishes the site on every push to `main` (you can also run it by hand from the **Actions** tab). The game will then be live at `https://<your-user>.github.io/krill-cl/`.

`node tools/build.js` also writes a single self-contained file, `dist/krill-dive.html`, which you can drop onto any static host.

## Prompt bank

Prompts live in `data/prompts-*.js`. Each prompt lists its accepted answers **from most to least commonly given**. That order is what sets the rarity tiers, and the last answer is the One in a Krillion:

```js
{ id: "nat-cheese", prompt: "Name a type of cheese", cat: "Food", answers: [
  "Cheddar", "Mozzarella", "Parmesan|Parmigiano Reggiano", /* … */ "Taleggio"
]}
```

Alternate spellings go after `|`, and the first form is the one shown. After editing, run `node tools/validate.js`, which catches duplicate ids and answers that collide after normalisation.

## Development

- `js/match.js`: answer normalisation and fuzzy matching (shared with the validator)
- `js/game.js`: game modes, timers, scoring, simulated rankings, results, stats, archive
- `js/ocean.js`: ambient background whose colour sinks with your depth
- `tools/smoke.js`: end-to-end Playwright run of a daily dive and an infinite run, at desktop and phone sizes
