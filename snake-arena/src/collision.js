import { WORLD } from './config.js';

/**
 * Body segments go into the spatial grid as single numbers: slot * SEG + index.
 * That avoids creating thousands of small objects every tick.
 */
export const SEG = 4096;

/**
 * Returns the first snake (other than `ignore`) whose body overlaps the circle
 * (x, y, rad), or null. Used both for real collisions and by the AI to test
 * points along a path it is considering.
 */
export function bodyAt(game, x, y, rad, ignore) {
  const g = game.segGrid, reach = rad + 32;
  const x0 = g.cellX(x - reach), x1 = g.cellX(x + reach);
  const y0 = g.cellY(y - reach), y1 = g.cellY(y + reach);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const arr = g.cells[cy * g.n + cx];
      for (let k = 0; k < arr.length; k++) {
        const e = arr[k], o = game.slots[(e / SEG) | 0];
        if (!o || o === ignore) continue;
        const i = e % SEG, rr = rad + o.radius, dx = x - o.bx[i], dy = y - o.by[i];
        if (dx * dx + dy * dy < rr * rr) return o;
      }
    }
  }
  return null;
}

/**
 * Finds every snake that dies this tick: its head left the arena, or touched
 * another snake's body (or head). Snakes never collide with themselves.
 * Returns [victim, killer] pairs; killer is null for the arena wall.
 * Collisions are slightly forgiving (85% of the touching distance), like the real game.
 */
export function findCollisions(game) {
  const out = [], R = WORLD.radius;
  for (const s of game.snakes) {
    const r = s.radius;
    if (s.x * s.x + s.y * s.y > (R - r) * (R - r)) { out.push([s, null]); continue; }
    const killer = bodyAt(game, s.x, s.y, r * 0.85 - 2, s);
    if (killer) out.push([s, killer]);
  }
  return out;
}
