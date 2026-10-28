import { WORLD } from './config.js';
import { SpatialGrid } from './spatial.js';
import { TAU } from './math.js';

/** One glowing pellet. `natural` pellets are respawned; dropped ones are not. */
export class Food {
  constructor(x, y, value, hue, natural) {
    this.x = x; this.y = y;
    this.value = value;
    this.hue = hue;
    this.natural = natural;
    this.alive = true;
    this.phase = (x * 0.37 + y * 0.11) % TAU; // for the renderer's pulse
  }
}

/**
 * Every pellet on the map, plus:
 *  - a spatial grid (rebuilt each tick) for eating and for the AI's food search
 *  - a coarse "smell" map of total food per large block, so a bot that sees no
 *    food still heads somewhere promising instead of wandering at random
 */
export class FoodField {
  constructor(rng) {
    this.rng = rng;
    this.items = [];
    this.natural = 0;
    this.grid = new SpatialGrid(WORLD.radius, WORLD.cellSize);
    this.coarseSize = 600;
    this.coarseN = Math.ceil((2 * WORLD.radius) / this.coarseSize);
    this.coarse = new Float32Array(this.coarseN * this.coarseN);
  }

  add(x, y, value, hue, natural = false) {
    const f = new Food(x, y, value, hue, natural);
    this.items.push(f);
    if (natural) this.natural++;
    return f;
  }

  /** A natural pellet at a random spot: mostly small, some medium. */
  spawnNatural() {
    const r = this.rng, a = r() * TAU, d = Math.sqrt(r()) * (WORLD.radius - 40);
    const value = r() < 0.75 ? 1 : r() < 0.8 ? 2 : 3;
    this.add(Math.cos(a) * d, Math.sin(a) * d, value, Math.floor(r() * 12) * 30, true);
  }

  /** Keep the natural pellet count near the target, a few per tick. */
  refill(perTick = 24) {
    for (let i = 0; i < perTick && this.natural < WORLD.foodTarget; i++) this.spawnNatural();
  }

  eat(f) {
    if (!f.alive) return 0;
    f.alive = false;
    if (f.natural) this.natural--;
    return f.value;
  }

  /** Drop eaten pellets and rebuild the grid. Called once per tick. */
  rebuild() {
    let w = 0;
    const items = this.items;
    for (let i = 0; i < items.length; i++) if (items[i].alive) items[w++] = items[i];
    items.length = w;
    this.grid.clear();
    for (const f of items) this.grid.insert(f.x, f.y, f);
  }

  /** Total food value per 600 px block, refreshed about once a second. */
  rebuildCoarse() {
    const c = this.coarse, s = this.coarseSize, n = this.coarseN, min = -WORLD.radius;
    c.fill(0);
    for (const f of this.items) {
      const cx = Math.min(n - 1, Math.max(0, Math.floor((f.x - min) / s)));
      const cy = Math.min(n - 1, Math.max(0, Math.floor((f.y - min) / s)));
      c[cy * n + cx] += f.value;
    }
  }
}
