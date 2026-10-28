// Behaviour tests: small staged situations, each checking one thing the AI must do.
//   node sim/scenarios.js
// Exits with code 1 if any check fails.

import { Game } from '../src/game.js';
import { WORLD, SNAKE } from '../src/config.js';
import { angleDiff } from '../src/math.js';
import { perceive } from '../src/ai/perception.js';
import { BotBrain } from '../src/ai/brain.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ': ' + detail : ''}`);
  if (!ok) failed++;
};
const KINDS = ['aggressive', 'defensive', 'balanced', 'opportunistic'];
const run = (g, seconds, each) => { for (let i = 0; i < seconds * WORLD.tickRate; i++) { g.step(); if (each) each(g); } };
/** A snake nobody controls: it drives straight unless the test steers it. */
const dummy = (g, o) => g.spawnSnake({ name: o.name || 'Dummy', skin: { hue: 0, hue2: 30, kind: 'dummy' }, ...o });

// 1. The arena edge
{
  let alive = 0, n = 0;
  for (const kind of KINDS) for (const diff of ['normal', 'hard']) for (let seed = 1; seed <= 3; seed++) {
    const g = new Game({ seed, difficulty: diff, bots: 0, food: false });
    const b = g.addBot(kind, { x: WORLD.radius - 300, y: 0, angle: 0 });
    run(g, 4); n++; if (b.snake && b.stats.lives === 1) alive++;
  }
  check('turns away from the arena edge it is driving at', alive === n, `${alive}/${n} survived`);
}

// 2. A body across the path
{
  let alive = 0, n = 0;
  for (const kind of KINDS) for (const diff of ['normal', 'hard']) for (let seed = 1; seed <= 3; seed++) {
    const g = new Game({ seed, difficulty: diff, bots: 0, food: false });
    dummy(g, { x: 250, y: -700, angle: -Math.PI / 2, mass: 800, name: 'Wall' });
    const b = g.addBot(kind, { x: 0, y: 0, angle: 0, mass: 60 });
    g.rebuildGrid();
    run(g, 4); n++; if (b.snake && b.stats.lives === 1) alive++;
  }
  check('steers around a long body lying across its path', alive === n, `${alive}/${n} survived`);
}

// 3. Food
{
  let ok = 0, n = 0, gains = [];
  for (const kind of KINDS) for (let seed = 1; seed <= 2; seed++) {
    const g = new Game({ seed, difficulty: 'normal', bots: 0, food: false });
    for (let i = 0; i < 30; i++) g.food.add(300 + (i % 6) * 9, 250 + Math.floor(i / 6) * 9, 2, 120);
    g.food.rebuild();
    const b = g.addBot(kind, { x: 0, y: 0, angle: 0 });
    const m0 = b.snake.mass;
    run(g, 5); n++;
    const gain = b.snake ? b.snake.mass - m0 : 0; gains.push(gain.toFixed(0));
    if (gain >= 45) ok++;
  }
  check('finds and eats a food cluster off to the side', ok === n, `gained ${gains.join(', ')} of 60`);
}

// 4. Hunting: cut off a smaller snake that drives straight
{
  let kills = 0, hunted = 0, n = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const g = new Game({ seed, difficulty: 'normal', bots: 0, food: false });
    const prey = dummy(g, { x: 350, y: 150, angle: 0, mass: 40, name: 'Prey' });
    const b = g.addBot('aggressive', { x: 0, y: 0, angle: 0, mass: 500 });
    let saw = false;
    run(g, 10, () => { if (b.snake && ['hunt', 'encircle'].includes(b.brain.state)) saw = true; });
    n++; if (saw) hunted++;
    if (!prey.alive && b.snake && b.snake.kills > 0) kills++;
  }
  check('aggressive bots hunt a smaller snake', hunted === n, `${hunted}/${n} went hunting`);
  check('...and usually kill it by cutting it off', kills >= 4, `${kills}/${n} kills`);
}

// 5. Fleeing: a big snake boosting across the bot's path
{
  let fled = 0, alive = 0, n = 0;
  for (const kind of ['defensive', 'balanced', 'opportunistic']) for (let seed = 1; seed <= 3; seed++) {
    const g = new Game({ seed, difficulty: 'normal', bots: 0, food: false });
    const big = dummy(g, { x: 400, y: -450, angle: Math.PI / 2, mass: 900, name: 'Big' });
    big.wantBoost = true;
    const b = g.addBot(kind, { x: 0, y: 0, angle: 0, mass: 40 });
    let saw = false;
    run(g, 5, () => { if (b.snake && b.brain.state === 'flee') saw = true; });
    n++; if (saw) fled++; if (b.snake && b.stats.lives === 1) alive++;
  }
  check('cautious bots flee a big snake charging across their path', fled === n, `${fled}/${n} fled`);
  check('...and survive it', alive === n, `${alive}/${n} survived`);
}

// 6. Encirclement is noticed, and the gap is found
{
  const g = new Game({ seed: 3, difficulty: 'normal', bots: 0, food: false });
  const b = g.addBot('balanced', { x: 0, y: 0, angle: 0, mass: 60 });
  const coil = dummy(g, { x: 200, y: 0, angle: Math.PI / 2, mass: 700, name: 'Coil' });
  // Lay the coil's trail on a circle of radius 200 with a 60° gap centred on 90° (straight "down" in screen terms).
  const gap = Math.PI / 2, tr = [];
  for (let a = gap + Math.PI / 6; a <= gap + 2 * Math.PI - Math.PI / 6 + 1e-9; a += 0.02) tr.push(Math.cos(a) * 200, Math.sin(a) * 200);
  coil.trail = tr; coil.t0 = 0; coil.x = tr[tr.length - 2]; coil.y = tr[tr.length - 1]; coil.resample();
  g.rebuildGrid();
  const S = perceive(b.snake, g, b.personality, g.diff, {});
  check('notices it is being coiled', S.trapped > 0.5, `trapped ${S.trapped.toFixed(2)}`);
  check('...and finds the way out', Math.abs(angleDiff(S.gapAngle, gap)) < 0.45, `gap at ${(S.gapAngle * 180 / Math.PI).toFixed(0)}°, real gap at 90°`);
  b.brain.think();
  check('...and switches to escape mode', b.brain.state === 'escape', b.brain.state);
}

// 7. Smooth turning, decision rate and boost discipline in a full game
{
  const g = new Game({ seed: 11, difficulty: 'normal', bots: 30 });
  const maxStep = SNAKE.baseTurn / WORLD.tickRate + 1e-9;
  let worstTurn = 0, thinks = 0, boostTicks = 0, boostReason = 0;
  const think = BotBrain.prototype.think;
  BotBrain.prototype.think = function () { thinks++; return think.call(this); };
  const before = new Map();
  for (let i = 0; i < 30 * WORLD.tickRate; i++) {
    for (const s of g.snakes) before.set(s, s.angle);
    g.step();
    for (const s of g.snakes) {
      if (before.has(s)) worstTurn = Math.max(worstTurn, Math.abs(angleDiff(before.get(s), s.angle)));
      if (s.boosting && s.bot) {
        boostTicks++;
        const st = s.bot.brain.state, br = s.bot.brain;
        if (['hunt', 'encircle', 'flee', 'escape', 'scavenge'].includes(st) || g.time < br.boostUntil + 0.05) boostReason++;
      }
    }
  }
  BotBrain.prototype.think = think;
  check('turning is never faster than the turn rate (no instant U-turns)', worstTurn <= maxStep, `largest turn ${(worstTurn * 180 / Math.PI).toFixed(2)}° per tick, limit ${(maxStep * 180 / Math.PI).toFixed(2)}°`);
  const perBotPerSec = thinks / 30 / 30;
  check('bots make full decisions every few frames, not every frame', perBotPerSec > 6 && perBotPerSec < 20, `${perBotPerSec.toFixed(1)} decisions per bot per second at 60 fps`);
  check('boosting only happens with a reason', boostTicks > 0 && boostReason / boostTicks > 0.98, `${boostTicks} boosting ticks, ${((100 * boostReason) / Math.max(1, boostTicks)).toFixed(1)}% while chasing, fleeing, escaping or racing for food`);
}

// 8. Scale: 50 bots on Hard
{
  const g = new Game({ seed: 5, difficulty: 'hard', bots: 50 });
  run(g, 2);
  const t0 = performance.now(), N = 20 * WORLD.tickRate;
  run(g, 20);
  const ms = (performance.now() - t0) / N;
  check('50 Hard bots run comfortably inside a 60 fps frame', ms < 8, `${ms.toFixed(2)} ms per tick`);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall scenario checks passed');
process.exit(failed ? 1 : 0);
