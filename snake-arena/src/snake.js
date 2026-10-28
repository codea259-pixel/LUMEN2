import { SNAKE, radiusFor, lengthFor } from './config.js';
import { clamp, wrapAngle, angleDiff } from './math.js';

let nextId = 1;

/**
 * A snake is a head that moves forward continuously, plus a body that follows
 * the exact path the head took. The path is kept as a "trail" of head
 * positions; each tick the body is re-sampled from it at an even spacing.
 * That makes a coiling snake's body hold the circle it drew, which is what
 * lets one snake trap another.
 *
 * Whoever controls the snake (a human or a bot brain) only sets two things:
 *   wantAngle  the direction it would like to face
 *   wantBoost  whether it would like to go fast
 * The snake turns toward wantAngle no faster than its turn rate, so a
 * 180-degree turn always takes time and draws a curve.
 */
export class Snake {
  constructor({ x, y, angle, mass = SNAKE.startMass, name = 'Snake', skin = null, isPlayer = false }) {
    this.id = nextId++;
    this.slot = -1;              // index in game.slots, used by the spatial grid
    this.name = name;
    this.skin = skin;            // { hue, hue2 } for the renderer
    this.isPlayer = isPlayer;
    this.x = x; this.y = y;
    this.angle = angle;
    this.wantAngle = angle;
    this.wantBoost = false;
    this.boosting = false;
    this.speed = SNAKE.baseSpeed;
    this.mass = mass;
    this.peakMass = mass;
    this.boostBank = 0;          // mass waiting to be dropped as pellets
    this.alive = true;
    this.kills = 0;
    this.born = 0;
    this.bot = null;             // set for AI snakes
    // trail: flat [x, y, x, y, ...], oldest first; t0 = first point still needed
    this.trail = [];
    this.t0 = 0;
    // body points, head first
    this.bx = [];
    this.by = [];
    this.n = 0;
    // Lay the starting body out in a straight line behind the head.
    const L = this.length, step = 4;
    for (let d = L; d > 0; d -= step) this.trail.push(x - Math.cos(angle) * d, y - Math.sin(angle) * d);
    this.trail.push(x, y);
    this.resample();
  }

  get radius() { return radiusFor(this.mass); }
  get length() { return lengthFor(this.mass); }
  get spacing() { return this.radius * 0.5; }

  /** Max turning speed in rad/s: big snakes and boosting snakes turn wider. */
  get turnRate() {
    const f = Math.max(SNAKE.minTurnFactor, 1 - this.mass / 6000);
    return SNAKE.baseTurn * f * (this.boosting ? SNAKE.boostTurnFactor : 1);
  }

  /** Radius of the tightest circle the snake can drive. */
  get turnRadius() { return this.speed / this.turnRate; }

  update(dt) {
    // Smooth turning: rotate toward the wanted angle, limited by the turn rate.
    const maxTurn = this.turnRate * dt;
    this.angle = wrapAngle(this.angle + clamp(angleDiff(this.angle, this.wantAngle), -maxTurn, maxTurn));

    // Boosting costs mass; part of it is left behind as a trail of pellets.
    this.boosting = this.wantBoost && this.mass > SNAKE.minBoostMass;
    const target = this.boosting ? SNAKE.boostSpeed : SNAKE.baseSpeed;
    this.speed += clamp(target - this.speed, -SNAKE.accel * dt, SNAKE.accel * dt);
    if (this.boosting) {
      const loss = SNAKE.boostDrain * dt;
      this.mass -= loss;
      this.boostBank += loss * SNAKE.boostDropShare;
    }

    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    this.trail.push(this.x, this.y);
    this.resample();
  }

  grow(value) {
    this.mass += value;
    if (this.mass > this.peakMass) this.peakMass = this.mass;
  }

  /** Walk the trail back from the head, placing a body point every `spacing` px. */
  resample() {
    const sp = this.spacing, tr = this.trail;
    const maxN = Math.min(SNAKE.maxSegments, Math.floor(this.length / sp) + 1);
    let px = this.x, py = this.y, left = sp, n = 1, i = tr.length - 2;
    this.bx[0] = px; this.by[0] = py;
    for (; i >= this.t0 && n < maxN; i -= 2) {
      const qx = tr[i], qy = tr[i + 1];
      let d = Math.hypot(qx - px, qy - py);
      while (d >= left && n < maxN) {
        const t = left / d;
        px += (qx - px) * t; py += (qy - py) * t;
        this.bx[n] = px; this.by[n] = py; n++;
        d -= left; left = sp;
      }
      left -= d; px = qx; py = qy;
    }
    this.n = n;
    // Trail points older than the tail are no longer needed. (A growing snake
    // therefore lengthens as it moves, from the tail, like the real game.)
    if (n >= maxN && i > this.t0) this.t0 = i;
    if (this.t0 > 6000) { tr.splice(0, this.t0); this.t0 = 0; }
  }
}
