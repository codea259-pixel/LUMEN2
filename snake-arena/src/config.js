// All tuning numbers in one place. Distances are in world pixels, times in seconds.

export const WORLD = {
  radius: 3000,        // the arena is a circle; touching its edge is fatal
  cellSize: 100,       // spatial grid cell size (must be >= the widest snake)
  foodTarget: 2400,    // natural pellets kept on the map
  tickRate: 60,        // fixed simulation steps per second
  hotspotEvery: 0.25,  // seconds between "where are snakes fighting?" scans
  deathMemory: 8,      // seconds a death site stays interesting to scavengers
};

export const SNAKE = {
  startMass: 20,
  baseSpeed: 165,
  boostSpeed: 330,
  accel: 900,              // px/s² when changing between cruise and boost
  baseTurn: 4.4,           // rad/s for a small snake
  minTurnFactor: 0.45,     // the biggest snakes turn at 45% of that
  boostTurnFactor: 0.85,   // boosting makes turning slightly wider
  minBoostMass: 24,        // cannot boost below this
  boostDrain: 7,           // mass lost per second of boosting...
  boostDropShare: 0.6,     // ...and this share of it is dropped as pellets behind you
  eatReach: 16,            // pellets this far past the head's edge get eaten
  suction: 46,             // pellets inside this extra range drift toward the head
  deathDropShare: 0.75,    // share of a dead snake's mass left as food
  maxSegments: 4000,
};

/** Body radius grows with the square root of mass, so big snakes are long more than fat. */
export const radiusFor = (mass) => Math.min(30, 8 + Math.sqrt(mass) * 0.45);
/** Body length in pixels. */
export const lengthFor = (mass) => 60 + mass * 2;

/**
 * Difficulty changes how well a bot thinks, not how fast its snake moves:
 *  thinkEvery  frames between full decisions (reaction time)
 *  rays        directions sampled by the steering system
 *  horizon     seconds of look-ahead for collision prediction
 *  view        how far the bot can see
 *  aimNoise    random error (radians) added to each decision
 *  emergency   re-think instantly when something appears right ahead
 *  mistake     chance per decision to ignore danger completely (a blunder)
 */
export const DIFFICULTY = {
  easy:   { thinkEvery: 9, rays: 16, horizon: 0.7, view: 450, aimNoise: 0.22, emergency: false, mistake: 0.08 },
  normal: { thinkEvery: 5, rays: 24, horizon: 1.0, view: 600, aimNoise: 0.08, emergency: true,  mistake: 0.015 },
  hard:   { thinkEvery: 3, rays: 32, horizon: 1.3, view: 760, aimNoise: 0.02, emergency: true,  mistake: 0 },
};
