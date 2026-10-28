import { WORLD, SNAKE, DIFFICULTY } from './config.js';
import { makeRng, TAU, clamp } from './math.js';
import { SpatialGrid } from './spatial.js';
import { FoodField } from './food.js';
import { Snake } from './snake.js';
import { Bot } from './bot.js';
import { KINDS } from './ai/personalities.js';
import { SEG, findCollisions } from './collision.js';

/**
 * The whole world, with no drawing code, so it runs the same in a browser
 * and in Node (see sim/). One call to step(dt) is one fixed tick:
 *
 *   1. bots think (every few ticks) and steer
 *   2. every snake moves; boosting snakes drop pellets
 *   3. snakes eat (and suck in) nearby food
 *   4. rebuild the body grid, find collisions, turn the dead into food
 *   5. respawn food, track fights and death sites for the AI
 */
export class Game {
  /**
   * @param {object} o
   * @param {number} [o.seed]        same seed + same settings = same game
   * @param {string} [o.difficulty]  'easy' | 'normal' | 'hard'
   * @param {number} [o.bots]        how many AI snakes
   * @param {string[]} [o.mix]       personality kinds to cycle through (default: all four)
   * @param {number} [o.control]     extra random "wanderer" snakes (for comparisons)
   * @param {boolean} [o.food]       scatter and respawn natural food (tests turn this off)
   */
  constructor({ seed = 1, difficulty = 'normal', bots = 24, mix = KINDS, control = 0, food = true } = {}) {
    this.rng = makeRng(seed);
    this.time = 0;
    this.tick = 0;
    this.setDifficulty(difficulty);
    this.snakes = [];
    this.slots = [];        // slot -> snake, for decoding grid entries
    this.freeSlots = [];
    this.bots = [];
    this.names = new Set();
    this.player = null;
    this.deaths = [];       // recent death sites: { x, y, value, t, victim, killer }
    this.hotspots = [];     // places where snakes are fighting: { x, y, intensity, t, a, b }
    this.listeners = new Set();
    this.food = new FoodField(this.rng);
    this.segGrid = new SpatialGrid(WORLD.radius, WORLD.cellSize);
    this.naturalFood = food;
    if (food) for (let i = 0; i < WORLD.foodTarget; i++) this.food.spawnNatural();
    this.food.rebuild();
    this.food.rebuildCoarse();
    for (let i = 0; i < bots; i++) this.addBot(mix[i % mix.length]);
    for (let i = 0; i < control; i++) this.addBot('wanderer');
    this.rebuildGrid();
  }

  setDifficulty(key) {
    this.difficulty = DIFFICULTY[key] ? key : 'normal';
    this.diff = DIFFICULTY[this.difficulty];
  }

  /** Subscribe to events ({ type: 'death', victim, killer }). Returns an unsubscribe function. */
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  addBot(kind, spawnAt = null) {
    const b = new Bot(this, kind, spawnAt);
    this.bots.push(b);
    return b;
  }

  addPlayer(name = 'You') {
    this.names.add(name);
    this.player = this.spawnSnake({ name, skin: { hue: 48, hue2: 20, kind: 'player' }, isPlayer: true });
    return this.player;
  }

  /** A point away from other snakes, so nobody spawns into a body. */
  safeSpot() {
    const r = this.rng;
    let best = null, bestGap = -1;
    for (let k = 0; k < 30; k++) {
      const a = r() * TAU, d = Math.sqrt(r()) * WORLD.radius * 0.8;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      let gap = Infinity;
      for (const s of this.snakes) {
        for (let i = 0; i < s.n; i += 6) gap = Math.min(gap, Math.hypot(s.bx[i] - x, s.by[i] - y));
      }
      if (gap > 450) return { x, y };
      if (gap > bestGap) { bestGap = gap; best = { x, y }; }
    }
    return best;
  }

  /** Creates a snake (at a safe spot unless x/y are given) and registers it. */
  spawnSnake(o = {}) {
    const at = o.x == null ? this.safeSpot() : { x: o.x, y: o.y };
    const s = new Snake({ ...o, x: at.x, y: at.y, angle: o.angle ?? this.rng() * TAU });
    s.slot = this.freeSlots.length ? this.freeSlots.pop() : this.slots.length;
    this.slots[s.slot] = s;
    s.born = this.time;
    this.snakes.push(s);
    return s;
  }

  step(dt = 1 / WORLD.tickRate) {
    this.time += dt;
    this.tick++;
    for (const b of this.bots) b.update(dt);
    for (const s of this.snakes) s.update(dt);
    this.dropBoostFood();
    this.eatFood(dt);
    this.rebuildGrid();
    const dead = findCollisions(this);
    if (dead.length) {
      for (const [victim, killer] of dead) this.kill(victim, killer);
      this.snakes = this.snakes.filter((s) => s.alive);
      this.rebuildGrid();
    }
    if (this.naturalFood) this.food.refill();
    this.food.rebuild();
    if (this.tick % 60 === 0) {
      this.food.rebuildCoarse();
      this.deaths = this.deaths.filter((d) => this.time - d.t < WORLD.deathMemory);
    }
    if (this.tick % Math.round(WORLD.hotspotEvery * WORLD.tickRate) === 0) this.scanHotspots();
  }

  /** Every body segment into the grid, encoded as one number (see collision.js). */
  rebuildGrid() {
    const g = this.segGrid;
    g.clear();
    for (const s of this.snakes) {
      const base = s.slot * SEG;
      for (let i = 0; i < s.n; i++) g.insert(s.bx[i], s.by[i], base + i);
    }
  }

  dropBoostFood() {
    for (const s of this.snakes) {
      if (s.boostBank >= 1.2) {
        const i = s.n - 1;
        this.food.add(s.bx[i] + this.rng.range(-4, 4), s.by[i] + this.rng.range(-4, 4), s.boostBank, s.skin.hue);
        s.boostBank = 0;
      }
    }
  }

  /** Heads eat pellets they touch and pull in pellets just out of reach. */
  eatFood(dt) {
    const grid = this.food.grid;
    for (const s of this.snakes) {
      const reach = s.radius + SNAKE.eatReach, pull = reach + SNAKE.suction;
      grid.query(s.x, s.y, pull, (f) => {
        if (!f.alive) return false;
        const dx = s.x - f.x, dy = s.y - f.y, d = Math.hypot(dx, dy);
        if (d < reach) s.grow(this.food.eat(f));
        else if (d < pull) { const m = Math.min(1, (260 * dt) / d); f.x += dx * m; f.y += dy * m; }
        return false;
      });
    }
  }

  /** A dead snake turns into a trail of pellets worth most of its mass. */
  kill(victim, killer) {
    if (!victim.alive) return;
    victim.alive = false;
    const total = victim.mass * SNAKE.deathDropShare, n = victim.n, r = victim.radius;
    const count = clamp(Math.round(victim.mass / 3), 6, 300), each = total / count;
    for (let k = 0; k < count; k++) {
      const i = Math.floor((k * (n - 1)) / Math.max(1, count - 1));
      this.food.add(victim.bx[i] + this.rng.range(-r, r), victim.by[i] + this.rng.range(-r, r), each, victim.skin.hue);
    }
    if (killer) killer.kills++;
    const mid = Math.floor(n / 3);
    this.deaths.push({ x: victim.bx[mid], y: victim.by[mid], value: total, t: this.time, victim, killer });
    this.slots[victim.slot] = null;
    this.freeSlots.push(victim.slot);
    if (victim.bot) victim.bot.onDeath(killer);
    if (victim === this.player) this.player = null;
    this.emit({ type: 'death', victim, killer });
  }

  /** Remember where heads are close together: opportunists watch these. */
  scanHotspots() {
    const S = this.snakes, now = this.time;
    for (let i = 0; i < S.length; i++) {
      for (let j = i + 1; j < S.length; j++) {
        const a = S[i], b = S[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 280) continue;
        const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
        const heat = ((a.mass + b.mass) / 2) * (a.boosting || b.boosting ? 1.5 : 1);
        const h = this.hotspots.find((q) => Math.hypot(q.x - x, q.y - y) < 300);
        if (h) Object.assign(h, { x: (h.x + x) / 2, y: (h.y + y) / 2, intensity: Math.max(h.intensity * 0.8, heat), t: now, a, b });
        else this.hotspots.push({ x, y, intensity: heat, t: now, a, b });
      }
    }
    this.hotspots = this.hotspots.filter((h) => now - h.t < 3);
  }

  /** The longest snakes, biggest first. */
  leaders(k = 10) {
    return [...this.snakes].sort((a, b) => b.mass - a.mass).slice(0, k);
  }
}
