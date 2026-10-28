import { WORLD } from '../config.js';
import { wrapAngle } from '../math.js';

/**
 * Control group for the simulator: meanders at random (turning back from the
 * arena edge so it isn't just a wall test) and never looks at food or snakes.
 * Comparing real bots with these shows the AI is doing real work.
 */
export class WanderBrain {
  constructor(bot, game) { this.bot = bot; this.game = game; this.reset(); }
  reset() { this.debug = null; this.next = 0; this.angle = this.bot.snake ? this.bot.snake.angle : 0; }
  update() {
    const s = this.bot.snake, g = this.game;
    if (g.time >= this.next) {
      this.angle = wrapAngle(this.angle + g.rng.range(-1.2, 1.2));
      this.next = g.time + g.rng.range(0.4, 1.6);
    }
    if (Math.hypot(s.x, s.y) > WORLD.radius - 350) this.angle = Math.atan2(-s.y, -s.x);
    s.wantAngle = this.angle;
    s.wantBoost = false;
  }
}
