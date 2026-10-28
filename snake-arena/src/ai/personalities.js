/**
 * Personality = a set of weights the brain reads when it scores its options.
 * The same decision code runs for every bot; only these numbers differ.
 *
 *  aggression   how much it wants to hunt and trap other snakes
 *  caution      how strongly threats and crowds push it away
 *  greed        how much it values food
 *  opportunism  how much it watches fights and races to fresh death sites
 *  boostiness   how willing it is to spend length on speed
 *  risk         how much danger it accepts to get what it wants (0..1)
 *  preyRatio    attacks snakes up to this size relative to its own (1.2 = even a bit bigger ones)
 *  fleeRatio    a snake this many times its size is "fully scary"
 *  encircle     how much it likes the coil-around-them kill
 *  margin       extra clearance (px) it keeps from other bodies
 *  lead         how far ahead of a victim it aims when cutting it off
 */
export const PERSONALITIES = {
  aggressive: {
    label: 'Aggressive', icon: '🔥', hues: [0, 14, 28], blurb: 'Hunts other snakes and takes risks.',
    aggression: 0.95, caution: 0.3, greed: 0.55, opportunism: 0.2, boostiness: 0.85, risk: 0.7,
    preyRatio: 1.15, fleeRatio: 2.4, encircle: 0.8, margin: 4, lead: 1.2,
  },
  defensive: {
    label: 'Defensive', icon: '🛡️', hues: [190, 205, 172], blurb: 'Plays safe and grows steadily.',
    aggression: 0.12, caution: 0.95, greed: 0.8, opportunism: 0.25, boostiness: 0.3, risk: 0.12,
    preyRatio: 0.35, fleeRatio: 0.85, encircle: 0.25, margin: 16, lead: 0.8,
  },
  balanced: {
    label: 'Balanced', icon: '⚖️', hues: [105, 130, 88], blurb: 'Hunts when it is safe, eats otherwise.',
    aggression: 0.55, caution: 0.6, greed: 0.7, opportunism: 0.4, boostiness: 0.55, risk: 0.4,
    preyRatio: 0.75, fleeRatio: 1.4, encircle: 0.5, margin: 9, lead: 1,
  },
  opportunistic: {
    label: 'Opportunistic', icon: '🦊', hues: [275, 292, 310], blurb: 'Lurks near fights, then steals the food.',
    aggression: 0.35, caution: 0.7, greed: 0.6, opportunism: 0.95, boostiness: 0.6, risk: 0.35,
    preyRatio: 0.5, fleeRatio: 1.15, encircle: 0.3, margin: 11, lead: 1,
  },
  // Not a real opponent: a control group for the simulator that just meanders.
  wanderer: {
    label: 'Wanderer', icon: '🌀', hues: [45], blurb: 'Control group: wanders at random.',
    aggression: 0, caution: 0, greed: 0, opportunism: 0, boostiness: 0, risk: 1,
    preyRatio: 0, fleeRatio: 99, encircle: 0, margin: 0, lead: 1,
  },
};

/** The four kinds that play in normal games. */
export const KINDS = ['aggressive', 'defensive', 'balanced', 'opportunistic'];

const TRAITS = ['aggression', 'caution', 'greed', 'opportunism', 'boostiness', 'risk', 'preyRatio', 'fleeRatio', 'encircle', 'margin', 'lead'];
const UNIT = new Set(['aggression', 'caution', 'greed', 'opportunism', 'boostiness', 'risk', 'encircle']);

/**
 * A copy of the preset with every trait nudged by up to ±15%, plus a few
 * quirks (which way it likes to circle, how much it wiggles, its colors),
 * so no two bots play exactly alike.
 */
export function makePersonality(kind, rng) {
  const base = PERSONALITIES[kind];
  const p = { kind, label: base.label, icon: base.icon };
  for (const k of TRAITS) {
    const v = base[k] * (1 + rng.range(-0.15, 0.15));
    p[k] = UNIT.has(k) ? Math.min(1, Math.max(0, v)) : v;
  }
  p.circleDir = rng() < 0.5 ? 1 : -1;
  p.wobble = rng.range(0.6, 1.4);
  const hue = (rng.pick(base.hues) + rng.int(-6, 6) + 360) % 360;
  p.skin = { hue, hue2: (hue + rng.pick([22, -22, 40])) % 360, kind };
  return p;
}

const NAMES = ['Viper', 'Noodle', 'Sir Hiss', 'Zigzag', 'Mamba', 'Slinky', 'Pretzel', 'Comet', 'Wiggles', 'Nova', 'Sprout', 'Bolt',
  'Ziggy', 'Pickle', 'Cobra Kai', 'Danger Noodle', 'Twister', 'Ribbon', 'Echo', 'Fang', 'Jellybean', 'Rocket', 'Squiggle', 'Blaze',
  'Pebble', 'Lasso', 'Tango', 'Gizmo', 'Marble', 'Sparky', 'Waffles', 'Orbit', 'Pixel', 'Taffy', 'Rascal', 'Ninja', 'Zephyr',
  'Biscuit', 'Glimmer', 'Turbo', 'Mochi', 'Scribble', 'Nugget', 'Kraken', 'Mango', 'Shadow', 'Basil', 'Quasar', 'Dizzy', 'Jinx',
  'Sapphire', 'Pudding', 'Hydra', 'Cricket', 'Doodle', 'Maverick', 'Sherbet', 'Raptor', 'Lumen', 'Boomer'];

/** A name not already used in this game (falls back to adding a number). */
export function pickName(rng, used) {
  for (let i = 0; i < 20; i++) {
    const n = rng.pick(NAMES);
    if (!used.has(n)) { used.add(n); return n; }
  }
  const n = rng.pick(NAMES) + ' ' + rng.int(2, 99);
  used.add(n);
  return n;
}
