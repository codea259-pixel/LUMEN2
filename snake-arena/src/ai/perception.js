import { WORLD, SNAKE } from '../config.js';
import { TAU, angleDiff, clamp } from '../math.js';
import { SEG } from '../collision.js';

/**
 * PERCEPTION: turns the raw world into the handful of facts a decision needs.
 * Everything here is limited to what the bot can "see" (its view radius,
 * which depends on difficulty), apart from the coarse food smell.
 *
 * Returns:
 *  threats     every snake head in view, with a 0..1+ threat level
 *  topThreat   the scariest one (threat = its level)
 *  prey        smaller snakes worth attacking, best first (vuln = how open they are)
 *  food        the best food target (value-weighted center of a rich cell)
 *  foodAlt     the runner-up, used as a weak secondary goal
 *  smell       when no food is in view: a promising far-away area
 *  death       the most attractive recent death site (fresh food)
 *  hotspot     the nearest fight between other snakes
 *  trapped     0..1, how much of the space around us is walled off by bodies
 *  gapAngle    the direction of the widest opening when trapped
 *  wall        0..1, closeness to the arena edge; centerAngle points inward
 */
export function perceive(me, game, P, D, mem) {
  const S = {
    view: D.view, threats: [], topThreat: null, threat: 0, prey: [],
    food: null, foodScore: 0, foodAlt: null, smell: null, death: null, hotspot: null,
    trapped: 0, gapAngle: me.angle, wall: 0, centerAngle: Math.atan2(-me.y, -me.x),
  };
  senseSnakes(me, game, P, S, mem);
  senseTrap(me, game, S);
  senseFood(me, game, P, S, mem);
  senseEvents(me, game, P, S);
  S.wall = clamp((Math.hypot(me.x, me.y) - (WORLD.radius - 700)) / 600, 0, 1);
  return S;
}

/** Threat and prey assessment for every snake head within view. */
function senseSnakes(me, game, P, S, mem) {
  const mvx = Math.cos(me.angle) * me.speed, mvy = Math.sin(me.angle) * me.speed;
  for (const o of game.snakes) {
    if (o === me) continue;
    const dx = me.x - o.x, dy = me.y - o.y, d = Math.hypot(dx, dy);
    if (d > S.view) continue;
    const ratio = o.mass / me.mass;
    // Is its head pointed at me, or at the spot just in front of me (a cut-off)?
    const aim = Math.cos(angleDiff(o.angle, Math.atan2(dy, dx)));
    const ahead = Math.min(d, 220);
    const ax = me.x + Math.cos(me.angle) * ahead, ay = me.y + Math.sin(me.angle) * ahead;
    const aimAhead = Math.cos(angleDiff(o.angle, Math.atan2(ay - o.y, ax - o.x)));
    const intent = Math.max(0, aim, aimAhead);
    // Closing speed: how fast the gap between our heads is shrinking.
    const ux = dx / (d || 1), uy = dy / (d || 1);
    const closing = (Math.cos(o.angle) * o.speed - mvx) * ux + (Math.sin(o.angle) * o.speed - mvy) * uy;
    const prox = 1 - d / S.view;
    const level = Math.pow(prox, 1.2)
      * (0.35 + 0.65 * intent)
      * (1 + clamp(closing / 300, -0.5, 0.8))
      * (o.boosting ? 1.25 : 1)
      * clamp(ratio / P.fleeRatio, 0.2, 1.6);
    const info = { s: o, x: o.x, y: o.y, d, ratio, intent, closing, level };
    S.threats.push(info);
    if (level > S.threat) { S.threat = level; S.topThreat = info; }
    // Prey: smaller snakes, best when close, not facing us, near the edge, or not boosting away.
    if (ratio <= P.preyRatio && o.mass >= 10 && !(mem.ignore && mem.ignore.has(o.id))) {
      const edge = clamp((Math.hypot(o.x, o.y) - (WORLD.radius - 600)) / 600, 0, 1);
      const vuln = prox * (1 - 0.6 * Math.max(0, aim)) * (1 + 0.5 * edge)
        * (1 + 0.5 * (P.preyRatio - ratio)) * (o.boosting ? 0.85 : 1);
      S.prey.push({ s: o, d, ratio, vuln });
    }
  }
  S.prey.sort((a, b) => b.vuln - a.vuln);
}

/**
 * Encirclement check: split the circle around our head into 16 sectors and mark
 * the ones blocked by another body (or the arena edge). If most are blocked we
 * are being coiled, and the widest open run of sectors is the way out.
 */
const BINS = 16, bins = new Uint8Array(BINS);
function senseTrap(me, game, S) {
  const rT = clamp(me.turnRadius * 3 + 120, 170, 330), rT2 = rT * rT;
  bins.fill(0);
  game.segGrid.query(me.x, me.y, rT, (e) => {
    const o = game.slots[(e / SEG) | 0];
    if (!o || o === me) return false;
    const i = e % SEG, dx = o.bx[i] - me.x, dy = o.by[i] - me.y;
    if (dx * dx + dy * dy > rT2) return false;
    bins[Math.floor(((Math.atan2(dy, dx) + Math.PI) / TAU) * BINS) % BINS] = 1;
    return false;
  });
  const lim = (WORLD.radius - 20) ** 2;
  for (let b = 0; b < BINS; b++) {
    const a = ((b + 0.5) / BINS) * TAU - Math.PI, x = me.x + Math.cos(a) * rT, y = me.y + Math.sin(a) * rT;
    if (x * x + y * y > lim) bins[b] = 1;
  }
  let blocked = 0;
  for (let b = 0; b < BINS; b++) blocked += bins[b];
  S.trapped = clamp((blocked / BINS - 0.5) / 0.35, 0, 1);
  if (S.trapped > 0 && blocked < BINS) {
    // Longest circular run of open sectors.
    let best = 0, bestStart = 0, run = 0, start = 0;
    for (let k = 0; k < BINS * 2; k++) {
      const b = k % BINS;
      if (!bins[b]) { if (!run) start = k; run++; if (run > best && run <= BINS) { best = run; bestStart = start; } }
      else run = 0;
    }
    S.gapAngle = ((bestStart + best / 2) / BINS) * TAU - Math.PI;
  }
}

/**
 * Food search. Rather than chase single pellets, score each grid cell in view
 * by its total value against the time to get there (distance plus the time
 * spent turning), so bots go for rich clusters like death trails. Cells near
 * other snakes count for less (more so for cautious bots), food inside our
 * own turning circle is skipped (we'd only orbit it), and the previous
 * target gets a small bonus so the bot doesn't flip-flop.
 */
function senseFood(me, game, P, S, mem) {
  const spd = Math.max(me.speed, SNAKE.baseSpeed), turn = me.turnRate, tR = spd / turn;
  const seg = game.segGrid, edge2 = (WORLD.radius - 140) ** 2, view = S.view;
  let best = null, bestS = 0, alt = null, altS = 0;
  game.food.grid.forCells(me.x, me.y, view, (arr) => {
    let v = 0, sx = 0, sy = 0;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (f.alive) { v += f.value; sx += f.x * f.value; sy += f.y * f.value; }
    }
    if (!v) return;
    const tx = sx / v, ty = sy / v, dx = tx - me.x, dy = ty - me.y, d = Math.hypot(dx, dy);
    if (d > view) return;
    const ang = Math.abs(angleDiff(me.angle, Math.atan2(dy, dx)));
    if (ang > 1.1 && d < tR * 1.9) return;
    let score = Math.pow(v, 0.85) / (d / spd + ang / turn + 0.3);
    // Crowding: other bodies in that cell, weighted by how big they are compared with us.
    const cell = seg.cells[seg.key(tx, ty)];
    let crowd = 0;
    for (let i = 0; i < cell.length; i++) {
      const o = game.slots[(cell[i] / SEG) | 0];
      if (o && o !== me) crowd += Math.min(2, o.mass / me.mass) / 6;
    }
    score /= 1 + P.caution * crowd;
    if (tx * tx + ty * ty > edge2) score *= 0.25;
    if (mem.food && Math.abs(mem.food.x - tx) < 70 && Math.abs(mem.food.y - ty) < 70) score *= 1.25;
    if (score > bestS) { alt = best; altS = bestS; best = { x: tx, y: ty, value: v }; bestS = score; }
    else if (score > altS) { alt = { x: tx, y: ty, value: v }; altS = score; }
  });
  S.food = best; S.foodScore = bestS; S.foodAlt = alt;
  mem.food = best;
  if (!best) {
    // Nothing in view: follow the "smell" of the coarse food map.
    const F = game.food, n = F.coarseN, s = F.coarseSize, min = -WORLD.radius;
    let bs = 0;
    for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
      const x = min + (cx + 0.5) * s, y = min + (cy + 0.5) * s;
      if (x * x + y * y > (WORLD.radius - 300) ** 2) continue;
      const sc = F.coarse[cy * n + cx] / (1 + Math.hypot(x - me.x, y - me.y) / 900);
      if (sc > bs) { bs = sc; S.smell = { x, y }; }
    }
  }
}

/** Fresh death sites (food piles) and ongoing fights between other snakes. */
function senseEvents(me, game, P, S) {
  const spd = Math.max(me.speed, SNAKE.baseSpeed), range = S.view * (1.6 + 1.4 * P.opportunism);
  let best = 0;
  for (const d of game.deaths) {
    if (d.victim === me) continue;
    const dist = Math.hypot(d.x - me.x, d.y - me.y);
    if (dist > range) continue;
    const fresh = 1 - (game.time - d.t) / WORLD.deathMemory;
    const score = (d.value * fresh) / (dist / spd + 1.5);
    if (score > best) {
      let contested = 0;
      for (const o of game.snakes) if (o !== me && Math.hypot(o.x - d.x, o.y - d.y) < 320) contested++;
      best = score; S.death = { x: d.x, y: d.y, value: d.value * fresh, d: dist, score, contested };
    }
  }
  let near = Infinity;
  for (const h of game.hotspots) {
    if (h.a === me || h.b === me) continue;
    const dist = Math.hypot(h.x - me.x, h.y - me.y);
    if (dist < near && dist < range) { near = dist; S.hotspot = { x: h.x, y: h.y, intensity: h.intensity, d: dist }; }
  }
}
