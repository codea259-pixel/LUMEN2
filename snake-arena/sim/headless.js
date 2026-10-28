// Runs Snake Arena with no graphics and reports how each personality did.
//
//   node sim/headless.js                       24 bots, Normal, 3 minutes of game time
//   node sim/headless.js --bots 50 --seconds 120 --difficulty hard
//   node sim/headless.js --control 8           add 8 random "wanderers" to compare against
//   node sim/headless.js --check               also assert the AI beats random play (exit 1 if not)

import { Game } from '../src/game.js';
import { WORLD } from '../src/config.js';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : isNaN(+v) ? v : +v;
};
const opts = {
  bots: arg('bots', 24), seconds: arg('seconds', 180), difficulty: arg('difficulty', 'normal'),
  seed: arg('seed', 7), control: arg('control', arg('check', false) ? 8 : 0), check: !!arg('check', false),
};

const game = new Game({ seed: opts.seed, difficulty: opts.difficulty, bots: opts.bots, control: opts.control });
const states = {};
let problems = 0, worst = 0;
const steps = Math.round(opts.seconds * WORLD.tickRate), t0 = performance.now();
for (let i = 0; i < steps; i++) {
  const a = performance.now();
  game.step();
  worst = Math.max(worst, performance.now() - a);
  if (i % 30 === 0) {
    for (const b of game.bots) {
      const s = b.snake;
      if (!s) continue;
      if (!Number.isFinite(s.x + s.y + s.angle + s.mass)) { problems++; console.error('not finite:', b.name, s.x, s.y); }
      if (Math.hypot(s.x, s.y) > WORLD.radius + 1) { problems++; console.error('outside the arena:', b.name); }
      const st = b.brain.state || 'wander';
      (states[b.kind] ||= {})[st] = (states[b.kind][st] || 0) + 1;
    }
  }
}
const ms = performance.now() - t0;

// Count the lives still running as if they ended now.
const rows = {};
for (const b of game.bots) {
  const st = b.stats, s = b.snake;
  const r = (rows[b.kind] ||= { bots: 0, lives: 0, time: 0, peak: 0, best: 0, kills: 0, wall: 0, eaten: 0, now: 0 });
  r.bots++; r.lives += st.lives; r.time += st.aliveTime; r.wall += st.wall; r.eaten += st.eaten;
  const peak = Math.max(st.peak, s ? s.peakMass : 0);
  r.peak += peak; r.best = Math.max(r.best, peak); r.kills += st.kills + (s ? s.kills : 0); r.now += s ? s.mass : 0;
}

console.log(`\nSnake Arena simulation: ${opts.bots} bots${opts.control ? ` + ${opts.control} wanderers` : ''}, ${opts.difficulty}, ${opts.seconds}s of game time, seed ${opts.seed}`);
console.log(`speed: ${(ms / steps).toFixed(2)} ms per tick on average (worst ${worst.toFixed(1)} ms), ${(opts.seconds / (ms / 1000)).toFixed(0)}x real time\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('personality', 15) + pad('avg life', 10) + pad('avg peak', 10) + pad('best', 8) + pad('kills', 7) + pad('k/life', 8) + pad('eaten', 7) + pad('wall', 6) + 'time spent in each state');
for (const [k, r] of Object.entries(rows)) {
  const tot = Object.values(states[k] || {}).reduce((a, b) => a + b, 0) || 1;
  const mix = Object.entries(states[k] || {}).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${Math.round((100 * n) / tot)}%`).join(', ');
  console.log(pad(k, 15) + pad((r.time / r.lives).toFixed(0) + 's', 10) + pad((r.peak / r.bots).toFixed(0), 10) + pad(r.best.toFixed(0), 8)
    + pad(r.kills, 7) + pad((r.kills / r.lives).toFixed(2), 8) + pad(r.eaten, 7) + pad(r.wall, 6) + mix);
}
const top = game.leaders(5).map((s) => `${s.name} (${s.bot ? s.bot.kind : 'player'}) ${Math.round(s.mass)}`).join(', ');
console.log(`\nlongest right now: ${top}`);

if (problems) { console.error(`\n${problems} invariant problems`); process.exit(1); }
if (opts.check) {
  const ai = Object.entries(rows).filter(([k]) => k !== 'wanderer').map(([, r]) => r);
  const w = rows.wanderer;
  const sum = (f) => ai.reduce((a, r) => a + f(r), 0);
  const aiLife = sum((r) => r.time) / sum((r) => r.lives), wLife = w.time / w.lives;
  const aiPeak = sum((r) => r.peak) / sum((r) => r.bots), wPeak = w.peak / w.bots;
  const fails = [];
  if (!(aiLife > wLife * 1.5)) fails.push(`AI lives (${aiLife.toFixed(0)}s) are not clearly longer than random (${wLife.toFixed(0)}s)`);
  if (!(aiPeak > wPeak * 1.5)) fails.push(`AI snakes (${aiPeak.toFixed(0)}) do not grow clearly bigger than random (${wPeak.toFixed(0)})`);
  if (!(sum((r) => r.kills) > 0)) fails.push('no bot ever killed another snake');
  if (!(ms / steps < 8)) fails.push(`too slow: ${(ms / steps).toFixed(2)} ms per tick`);
  console.log(fails.length ? '\nCHECK FAILED:\n- ' + fails.join('\n- ') : `\ncheck passed: AI bots live ${(aiLife / wLife).toFixed(1)}x longer and grow ${(aiPeak / wPeak).toFixed(1)}x bigger than random wanderers`);
  if (fails.length) process.exit(1);
}
