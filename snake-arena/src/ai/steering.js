import { WORLD, SNAKE } from '../config.js';
import { TAU, angleDiff, clamp, dist2, distToSegment2, wrapAngle } from '../math.js';
import { bodyAt } from '../collision.js';

/**
 * STEERING: "context steering" with collision prediction.
 *
 * The bot considers K headings spread evenly around itself (K = difficulty's
 * `rays`). For each one it builds two numbers:
 *
 *   danger    0..1  Simulates driving toward that heading for `horizon`
 *                   seconds, turning no faster than the snake really can,
 *                   and checks every sample point against other bodies,
 *                   the arena edge and where other heads will be. Hitting
 *                   something immediately = 1, near the horizon = ~0.
 *   interest  any   How well that heading serves the current goals (food,
 *                   an intercept point, an escape direction...) minus how
 *                   much it points at things to avoid.
 *
 * Survival first: only headings whose danger is within a small tolerance of
 * the safest heading are allowed, and among those the most interesting one
 * wins. Risk-takers get a bigger tolerance, so they cut closer.
 *
 * opts: { rays, horizon, margin, risk, goals:[{angle,w,sharp}], avoid:[{angle,w}],
 *         momentum, prey (snake we are allowed to cut in front of), ignoreDanger }
 */
export function steer(me, game, opts) {
  const K = opts.rays, step = TAU / K;
  const dirs = new Array(K), danger = new Array(K), interest = new Array(K);
  const heads = nearbyHeads(me, game, opts);
  for (let j = 0; j < K; j++) {
    const a = wrapAngle(me.angle + j * step); // j = 0 is straight ahead
    dirs[j] = a;
    danger[j] = opts.ignoreDanger ? 0 : castArc(me, game, a, opts, heads);
    let v = opts.momentum * Math.max(0, Math.cos(j * step));
    for (const g of opts.goals) {
      const c = Math.cos(angleDiff(a, g.angle));
      if (c > 0) v += g.w * Math.pow(c, g.sharp || 2);
    }
    for (const g of opts.avoid) {
      const c = Math.cos(angleDiff(a, g.angle));
      if (c > 0) v -= g.w * c * c;
    }
    interest[j] = v;
  }

  let minDanger = 1;
  for (let j = 0; j < K; j++) if (danger[j] < minDanger) minDanger = danger[j];
  const tol = 0.06 + opts.risk * 0.14;
  const score = (j) => (danger[j] > minDanger + tol ? -Infinity : interest[j] - danger[j] * 0.8);
  let best = 0, bestV = -Infinity;
  for (let j = 0; j < K; j++) {
    const v = score(j);
    if (v > bestV) { bestV = v; best = j; }
  }
  // Refine between neighbouring rays (parabola through three scores) for smoother aim.
  let angle = dirs[best];
  const l = score((best + K - 1) % K), r = score((best + 1) % K);
  if (Number.isFinite(l) && Number.isFinite(r)) {
    const den = l - 2 * bestV + r;
    if (den < 0) angle = wrapAngle(angle + clamp((0.5 * (l - r)) / den, -0.5, 0.5) * step);
  }
  return { angle, best, dirs, danger, interest, minDanger, ahead: danger[0] };
}

/** Other heads near enough to matter within the look-ahead, with their velocity. */
function nearbyHeads(me, game, opts) {
  const out = [], reach = (Math.max(me.speed, SNAKE.baseSpeed) + SNAKE.boostSpeed) * opts.horizon + 80;
  for (const o of game.snakes) {
    if (o === me) continue;
    if (Math.abs(o.x - me.x) > reach || Math.abs(o.y - me.y) > reach) continue;
    out.push({
      x: o.x, y: o.y, r: o.radius,
      vx: Math.cos(o.angle) * o.speed, vy: Math.sin(o.angle) * o.speed,
      // The stretch a head is about to drive over will soon be its body.
      // We ignore that for our prey, because cutting across it is the point.
      swept: o !== opts.prey,
    });
  }
  return out;
}

/** Danger of heading toward `theta`: 1 = blocked right away, 0 = clear to the horizon. */
function castArc(me, game, theta, opts, heads) {
  const T = opts.horizon, dt = 0.07, R = WORLD.radius;
  const sp = Math.max(me.speed, SNAKE.baseSpeed), tr = me.turnRate, pad = me.radius + opts.margin;
  const edge2 = (R - pad) * (R - pad);
  let x = me.x, y = me.y, a = me.angle;
  for (let t = dt; t <= T + 1e-9; t += dt) {
    const m = tr * dt;
    a += clamp(angleDiff(a, theta), -m, m);
    x += Math.cos(a) * sp * dt;
    y += Math.sin(a) * sp * dt;
    const k = 1 - (t - dt) / T;
    if (x * x + y * y > edge2) return k;
    if (bodyAt(game, x, y, pad, me)) return k;
    for (const h of heads) {
      const hx = h.x + h.vx * t, hy = h.y + h.vy * t, rr = pad + h.r + 6;
      if (dist2(x, y, hx, hy) < rr * rr) return k;
      if (h.swept && distToSegment2(x, y, h.x, h.y, hx, hy) < (pad + h.r) * (pad + h.r)) return k;
    }
  }
  return 0;
}

/** Cheap per-frame check: is something right in front of us? */
export function blockedAhead(me, game, seconds = [0.12, 0.25]) {
  const R = WORLD.radius, c = Math.cos(me.angle), s = Math.sin(me.angle), pad = me.radius + 4;
  for (const t of seconds) {
    const x = me.x + c * me.speed * t, y = me.y + s * me.speed * t;
    if (x * x + y * y > (R - pad) ** 2 || bodyAt(game, x, y, pad, me)) return true;
  }
  return false;
}
