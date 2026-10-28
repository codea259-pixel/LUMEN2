import { BotBrain } from './ai/brain.js';
import { WanderBrain } from './ai/wander.js';
import { makePersonality, pickName } from './ai/personalities.js';

/**
 * A bot is a seat in the game: a name, a personality and a brain that
 * survive between lives. When its snake dies, it waits a moment and respawns
 * somewhere safe. It also keeps the stats the simulator reports.
 */
export class Bot {
  constructor(game, kind, spawnAt = null) {
    this.game = game;
    this.kind = kind;
    this.name = pickName(game.rng, game.names);
    this.personality = makePersonality(kind, game.rng);
    this.snake = null;
    this.respawnAt = 0;
    this.stats = { lives: 0, aliveTime: 0, peak: 0, kills: 0, wall: 0, eaten: 0 };
    this.brain = kind === 'wanderer' ? new WanderBrain(this, game) : new BotBrain(this, game);
    this.spawn(spawnAt);
  }

  spawn(at = null) {
    this.snake = this.game.spawnSnake({ name: this.name, skin: this.personality.skin, ...(at || {}) });
    this.snake.bot = this;
    this.stats.lives++;
    this.brain.reset();
  }

  update(dt) {
    if (!this.snake) {
      if (this.game.time >= this.respawnAt) this.spawn();
      return;
    }
    this.stats.aliveTime += dt;
    this.brain.update(dt);
  }

  onDeath(killer) {
    const s = this.snake, st = this.stats;
    st.peak = Math.max(st.peak, s.peakMass);
    st.kills += s.kills;
    if (killer) st.eaten++; else st.wall++;
    this.snake = null;
    this.respawnAt = this.game.time + this.game.rng.range(1.5, 3.5);
  }
}
