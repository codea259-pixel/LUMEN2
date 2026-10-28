import { SNAKE } from '../config.js';
import { TAU, angleDiff, clamp, wrapAngle } from '../math.js';
import { perceive } from './perception.js';
import { steer, blockedAhead } from './steering.js';

/**
 * The bot's decision maker. Each decision ("think") runs four steps:
 *
 *   1. PERCEIVE  what's around me? (perception.js)
 *   2. CHOOSE    score every state with a utility function weighted by the
 *                personality, and switch to the best one (with hysteresis so
 *                it doesn't flicker between two close options)
 *   3. PLAN      turn that state into goals: directions to go toward and
 *                directions to stay away from
 *   4. STEER     context steering picks the safest good heading (steering.js),
 *                then decide whether to boost
 *
 * States:
 *   forage    eat the best food nearby (or follow the food smell)
 *   hunt      cut in front of a smaller snake so it crashes into us
 *   encircle  coil around a much smaller snake and tighten the circle
 *   flee      get away from a dangerous snake
 *   escape    we are being coiled: race for the widest gap
 *   scavenge  rush to a fresh death site and eat the remains
 *   lurk      circle at a safe distance from a fight, waiting for a death
 *
 * A full think runs only every few frames (difficulty's `thinkEvery`, plus a
 * random offset so the bots don't all think on the same frame). In between,
 * the snake keeps the chosen heading. On Normal and Hard, a cheap probe
 * straight ahead runs every frame and forces an early think if something
 * appears in front of us: a reflex.
 */
export class BotBrain {
  constructor(bot, game) {
    this.bot = bot;
    this.game = game;
    this.p = bot.personality;
    this.reset();
  }

  reset() {
    const r = this.game.rng, s = this.bot.snake;
    this.state = 'forage';
    this.stateAt = this.game.time;
    this.timer = r.int(0, 8);
    this.angle = s ? s.angle : 0;
    this.boost = false;
    this.boostUntil = 0;
    this.food = null;       // memory for target stickiness (written by perception)
    this.coilR = 0;
    this.chase = null;      // { id, since } for the snake we are hunting
    this.ignore = new Map(); // snake id -> time until which we leave it alone
    this.lastReflex = -1;
    this.wobblePhase = r() * TAU;
    this.debug = null;
  }

  /** Called every tick. */
  update() {
    const s = this.bot.snake, g = this.game, D = g.diff;
    let think = --this.timer <= 0;
    if (!think && D.emergency && g.time - this.lastReflex > 0.05 && blockedAhead(s, g)) {
      this.lastReflex = g.time;
      think = true;
    }
    if (think) {
      this.think();
      this.timer = D.thinkEvery + g.rng.int(0, 2);
    }
    // A small, personal wiggle while calmly foraging makes the bots look alive.
    const calm = this.state === 'forage' && this.debug && this.debug.minDanger < 0.05;
    s.wantAngle = calm ? this.angle + Math.sin(g.time * 2.3 * this.p.wobble + this.wobblePhase) * 0.06 : this.angle;
    s.wantBoost = this.boost;
  }

  think() {
    const s = this.bot.snake, g = this.game, P = this.p, D = g.diff, rng = g.rng;
    const S = perceive(s, g, P, D, this);
    this.trackChase(S);

    // 2. CHOOSE: utility scores with hysteresis and a short minimum commitment.
    const u = this.utilities(s, S);
    let next = this.state, bestU = (u[this.state] || 0) * 1.2;
    for (const k in u) if (u[k] > bestU) { bestU = u[k]; next = k; }
    const urgent = next === 'flee' || next === 'escape';
    if (next !== this.state && !urgent && g.time - this.stateAt < 0.5 && (u[this.state] || 0) > 0.1) next = this.state;
    if (next !== this.state) {
      this.state = next;
      this.stateAt = g.time;
      this.coilR = 0;
    }

    // 3. PLAN
    const plan = this.plan(s, S);

    // 4. STEER (an Easy bot sometimes blunders and ignores danger entirely)
    const blunder = D.mistake > 0 && rng.chance(D.mistake);
    const st = steer(s, g, {
      rays: D.rays, horizon: D.horizon, margin: P.margin, risk: P.risk,
      goals: plan.goals, avoid: plan.avoid, momentum: 0.12, prey: plan.prey && plan.prey.s, ignoreDanger: blunder,
    });
    // Aim noise is smaller when the situation is tight, so mistakes stay believable.
    this.angle = wrapAngle(st.angle + rng.gauss() * D.aimNoise * (st.minDanger > 0.3 ? 0.3 : 1));
    this.boost = this.decideBoost(s, S, plan, st);

    this.debug = {
      state: this.state, u, threat: S.threat, trapped: S.trapped, view: S.view, blunder,
      target: plan.target ? { x: plan.target.x, y: plan.target.y, kind: plan.kind } : null,
      threats: S.threats.filter((t) => t.level > 0.15).sort((a, b) => b.level - a.level).slice(0, 4)
        .map((t) => ({ x: t.x, y: t.y, level: t.level, name: t.s.name })),
      dirs: st.dirs, danger: st.danger, best: st.best, angle: this.angle, minDanger: st.minDanger, boost: this.boost,
    };
  }

  /**
   * Real players give up on a chase that is going nowhere. After 6 seconds on
   * the same victim we leave it alone for a while (perception skips it).
   */
  trackChase(S) {
    const g = this.game, pr = S.prey[0], hunting = this.state === 'hunt' || this.state === 'encircle';
    for (const [id, until] of this.ignore) if (g.time > until) this.ignore.delete(id);
    if (!hunting || !pr) { this.chase = null; return; }
    if (!this.chase || this.chase.id !== pr.s.id) this.chase = { id: pr.s.id, since: g.time };
    else if (g.time - this.chase.since > 6) {
      this.ignore.set(pr.s.id, g.time + 6);
      this.chase = null;
      S.prey.shift();
    }
  }

  /** How much each state is worth right now (roughly 0..1.6). */
  utilities(s, S) {
    const P = this.p, u = {};
    u.forage = 0.22 + 0.55 * P.greed * clamp(S.foodScore / 10, 0, 1.2);
    const pr = S.prey[0], canHunt = pr && s.mass >= 28 && S.trapped < 0.3;
    u.hunt = canHunt ? 1.25 * P.aggression * clamp(pr.vuln * 1.6, 0, 1) : 0;
    // Coiling needs a long body, a much smaller victim close by, and us beside or
    // ahead of it (from behind, a moving snake just drags the circle along).
    const beside = pr && Math.abs(angleDiff(pr.s.angle, Math.atan2(s.y - pr.s.y, s.x - pr.s.x))) < 1.9;
    u.encircle = canHunt && beside && pr.ratio < 0.45 && s.length > TAU * 110 && pr.d < 320
      ? 1.8 * P.aggression * (0.4 + 0.6 * P.encircle) * clamp(pr.vuln * 2, 0, 1) : 0;
    u.flee = S.topThreat ? clamp(S.threat * (0.6 + P.caution) * 1.4, 0, 1.6) : 0;
    u.escape = S.trapped > 0 ? 0.9 + S.trapped : 0;
    u.scavenge = S.death
      ? clamp(S.death.score / 12, 0, 1.2) * (0.35 + 0.9 * P.opportunism) * (1 - 0.4 * Math.min(1, S.death.contested * P.caution * 0.5))
      : 0;
    u.lurk = S.hotspot && !S.death && S.hotspot.d > 220 && S.hotspot.d < 1500
      ? P.opportunism * 0.75 * clamp(S.hotspot.intensity / 150, 0, 1) : 0;
    return u;
  }

  /** Goals (attract) and avoids (repel) for the current state. */
  plan(s, S) {
    const P = this.p, goals = [], avoid = [], plan = { goals, avoid, target: null, kind: '', prey: null };
    const toward = (x, y) => Math.atan2(y - s.y, x - s.x);
    const hunting = this.state === 'hunt' || this.state === 'encircle';
    // Threats push every state away a little; cautious bots and fleeing bots more.
    for (const t of S.threats) {
      if (t.level < 0.15 || (hunting && S.prey[0] && t.s === S.prey[0].s)) continue;
      avoid.push({ angle: toward(t.x, t.y), w: t.level * (0.3 + P.caution) * (this.state === 'flee' ? 1.6 : 0.6) });
    }
    if (S.wall > 0) goals.push({ angle: S.centerAngle, w: S.wall * 1.2, sharp: 1 });
    const food = (w) => { if (S.food) goals.push({ angle: toward(S.food.x, S.food.y), w, sharp: 2 }); };

    switch (this.state) {
      case 'hunt': {
        const pr = S.prey[0], T = this.intercept(s, pr.s);
        goals.push({ angle: toward(T.x, T.y), w: 1.4, sharp: 4 });
        food(0.15);
        Object.assign(plan, { target: T, kind: 'prey', prey: pr });
        break;
      }
      case 'encircle': {
        const pr = S.prey[0], T = this.orbit(s, pr.s);
        goals.push({ angle: toward(T.x, T.y), w: 1.6, sharp: 4 });
        Object.assign(plan, { target: T, kind: 'coil', prey: pr });
        break;
      }
      case 'flee': {
        // Run along the sum of "away from each threat" vectors, weighted by threat level.
        let ex = 0, ey = 0;
        for (const t of S.threats) { ex += ((s.x - t.x) / (t.d || 1)) * t.level; ey += ((s.y - t.y) / (t.d || 1)) * t.level; }
        const a = Math.atan2(ey, ex);
        goals.push({ angle: a, w: 1.3, sharp: 1.5 });
        food(0.25);
        Object.assign(plan, { target: { x: s.x + Math.cos(a) * 220, y: s.y + Math.sin(a) * 220 }, kind: 'flee' });
        break;
      }
      case 'escape':
        goals.push({ angle: S.gapAngle, w: 2, sharp: 3 });
        Object.assign(plan, { target: { x: s.x + Math.cos(S.gapAngle) * 200, y: s.y + Math.sin(S.gapAngle) * 200 }, kind: 'gap' });
        break;
      case 'scavenge':
        goals.push({ angle: toward(S.death.x, S.death.y), w: 1.2, sharp: 3 });
        if (S.death.d < 260) food(0.8);
        Object.assign(plan, { target: S.death, kind: 'death' });
        break;
      case 'lurk': {
        // Orbit the fight at a safe distance, ready to pounce on the remains.
        const h = S.hotspot, keep = 380, phi = Math.atan2(s.y - h.y, s.x - h.x) + P.circleDir * 0.5;
        const T = { x: h.x + Math.cos(phi) * keep, y: h.y + Math.sin(phi) * keep };
        goals.push({ angle: toward(T.x, T.y), w: 1, sharp: 2 });
        food(0.5);
        Object.assign(plan, { target: T, kind: 'lurk' });
        break;
      }
      default:
        if (S.food) {
          food(1);
          if (S.foodAlt) goals.push({ angle: toward(S.foodAlt.x, S.foodAlt.y), w: 0.3, sharp: 2 });
          Object.assign(plan, { target: S.food, kind: 'food' });
        } else if (S.smell) {
          goals.push({ angle: toward(S.smell.x, S.smell.y), w: 0.8, sharp: 1 });
          Object.assign(plan, { target: S.smell, kind: 'smell' });
        }
    }
    return plan;
  }

  /**
   * Where to aim to cut a snake off: predict where its head will be by the
   * time we get there, then aim a bit past that point, crossing to the far
   * side of its path so our body ends up across it.
   */
  intercept(s, o) {
    const sp = Math.max(s.speed, SNAKE.baseSpeed);
    let px = o.x, py = o.y;
    for (let k = 0; k < 3; k++) {
      const t = Math.hypot(px - s.x, py - s.y) / sp;
      px = o.x + Math.cos(o.angle) * o.speed * t;
      py = o.y + Math.sin(o.angle) * o.speed * t;
    }
    const fx = Math.cos(o.angle), fy = Math.sin(o.angle), nx = -fy, ny = fx;
    const side = Math.sign((s.x - o.x) * nx + (s.y - o.y) * ny) || 1;
    const ahead = (70 + 110 * this.p.aggression) * this.p.lead;
    return { x: px + fx * ahead - nx * side * 40, y: py + fy * ahead - ny * side * 40 };
  }

  /** A point a little further around a shrinking circle centred on the victim's head. */
  orbit(s, o) {
    if (!this.coilR) this.coilR = clamp(s.length / TAU * 0.6, 90, 320);
    this.coilR = Math.max(s.turnRadius * 1.3 + o.radius, this.coilR * 0.985);
    const cx = o.x + Math.cos(o.angle) * o.speed * 0.6, cy = o.y + Math.sin(o.angle) * o.speed * 0.6;
    const phi = Math.atan2(s.y - cy, s.x - cx) + this.p.circleDir * 0.75;
    return { x: cx + Math.cos(phi) * this.coilR, y: cy + Math.sin(phi) * this.coilR };
  }

  /** Boost only with a reason: closing on prey, running from danger, escaping a coil, or racing for food. */
  decideBoost(s, S, plan, st) {
    const P = this.p, g = this.game, rng = g.rng;
    if (s.mass < SNAKE.minBoostMass + 8) return false;
    const clear = st.danger[st.best] < 0.2;
    let want = false;
    switch (this.state) {
      case 'hunt': {
        const pr = plan.prey, T = plan.target;
        const facing = Math.abs(angleDiff(s.angle, Math.atan2(T.y - s.y, T.x - s.x))) < 0.5;
        want = facing && pr.d < 160 + 320 * P.boostiness && s.mass > pr.s.mass * 0.6 + 30 && rng() < 0.4 + 0.6 * P.boostiness;
        break;
      }
      case 'encircle': {
        // Speed up to get around the victim while we are still abeam or behind it.
        const o = plan.prey.s, rel = Math.abs(angleDiff(o.angle, Math.atan2(s.y - o.y, s.x - o.x)));
        want = rel > 0.9 && s.mass > SNAKE.minBoostMass + 40 && rng() < 0.5 + 0.5 * P.boostiness;
        break;
      }
      case 'flee': want = S.threat > 0.75 - 0.35 * P.boostiness && S.topThreat && S.topThreat.closing > -20; break;
      case 'escape': want = S.trapped > 0.4; break;
      case 'scavenge': want = S.death.d < 700 && S.death.contested > 0 && S.death.value > 30 && rng() < P.boostiness; break;
    }
    // Never boost into danger, except to dash through a closing gap.
    if (want && !clear && this.state !== 'escape') want = false;
    if (want) this.boostUntil = g.time + 0.35;
    // Once started, keep going for a moment so the boost doesn't flicker.
    return want || (this.boost && g.time < this.boostUntil && clear);
  }
}
