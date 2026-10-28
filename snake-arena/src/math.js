// Small math helpers shared by the simulation, the AI and the renderer.

export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Wrap an angle into [-PI, PI). */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Signed shortest turn from angle `from` to angle `to`. */
export const angleDiff = (from, to) => wrapAngle(to - from);

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/** Squared distance from point P to the segment AB. */
export function distToSegment2(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay, len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = clamp(t, 0, 1);
  return dist2(px, py, ax + abx * t, ay + aby * t);
}

/**
 * Seedable random numbers (mulberry32), so a simulation with the same seed
 * plays out the same way. Use this instead of Math.random in game code.
 */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (a, b) => a + (b - a) * rng();
  rng.int = (a, b) => Math.floor(a + (b - a + 1) * rng());
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  /** Roughly normal, mean 0, sd 1 (sum of uniforms). */
  rng.gauss = () => (rng() + rng() + rng() + rng() - 2) * 1.7;
  return rng;
}
