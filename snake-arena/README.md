# Snake Arena: AI bots for a Slither-style game

A browser snake arena where you play against 10 to 50 AI snakes, or watch them play each other. The bots hunt, cut each other off, coil around smaller snakes, flee from bigger ones, race to fresh food piles and boost only with a reason. Plain JavaScript modules, no dependencies, no build step.

## Run it

```bash
cd snake-arena
python3 -m http.server 8080        # or: npm start
# open http://localhost:8080
```

(Opening `index.html` straight from disk won't work: browsers only load JavaScript modules over http.)

**Controls:** steer with the mouse (or drag on a touch screen). Hold the mouse button, Space or the ⚡ button to boost. **B** turns on the debug view, **P** pauses, **Esc** opens the menu. In *Watch the bots* mode, click any snake to follow it, or press **F** to cycle through the leaders. The difficulty can be changed mid-game from the bottom bar.

## Test it

```bash
node sim/scenarios.js                          # 14 behaviour checks (exit code 1 on failure)
node sim/headless.js                           # 24 bots, 3 minutes of game time, stats per personality
node sim/headless.js --bots 50 --difficulty hard --seconds 120
node sim/headless.js --check                   # adds 8 random wanderers and asserts the AI clearly beats them
npm run check                                  # both of the checks above
```

The simulator runs the same game code as the browser, only without drawing, about 12 to 17 times faster than real time.

Sample run (`node sim/headless.js --check --seconds 240 --bots 30`):

```
personality    avg life  avg peak  best    kills  k/life  eaten  wall  time spent in each state
aggressive     82s       572       1253    47     2.04    15     0     hunt 39%, forage 28%, scavenge 12%, flee 12%, escape 6%, encircle 1%
defensive      159s      1646      3823    42     3.50    4      0     forage 71%, flee 18%, scavenge 9%, escape 1%
balanced       78s       797       1509    24     1.14    15     0     forage 33%, flee 30%, scavenge 21%, hunt 9%, escape 5%, lurk 2%
opportunistic  87s       966       1686    25     1.32    12     1     scavenge 37%, forage 27%, flee 22%, lurk 10%, escape 3%, hunt 1%
wanderer       14s       197       378     12     0.10    109    0     wander 100%

check passed: AI bots live 6.6x longer and grow 5.1x bigger than random wanderers
```

The personalities play differently: aggressive bots spend the most time hunting and die youngest, defensive bots mostly forage and grow the biggest, and opportunists spend over a third of their time scavenging death sites or lurking near fights.

The scenario tests stage one situation each:

| Check | Result |
| --- | --- |
| Driving at the arena edge | turns away (24 of 24 runs, all personalities, Normal and Hard) |
| A long body across its path | steers around it (24 of 24) |
| A food cluster off to one side | eats all of it within 5 s |
| A smaller snake driving straight | aggressive bots hunt it and kill it by cutting it off (6 of 6) |
| A big snake charging across its path | cautious bots flee and survive (9 of 9) |
| Being coiled with one gap | notices (trapped = 1.0), finds the gap direction exactly, switches to escape |
| Turning | never faster than the turn rate: no instant U-turns |
| Decision rate | about 10 full decisions per bot per second at 60 fps (Normal), not every frame |
| Boosting | 99.9% or more of boost time is while chasing, fleeing, escaping or racing for food |
| Scale | 50 Hard bots: about 3 ms per tick (a 60 fps frame has 16.7 ms) |

## The AI architecture

### The loop

```
every tick (60 per second)                    every few ticks ("thinkEvery", per difficulty)
┌───────────────────────────────┐             ┌──────────────────────────────────────────────────┐
│ BotBrain.update               │  timer up,  │ BotBrain.think                                   │
│  • hold the chosen heading    │  or reflex: │  1. PERCEIVE  threats, prey, food, death sites,  │
│    (+ a small personal wiggle │  something  │               fights, encirclement, the edge     │
│    while calmly foraging)     │  right in   │  2. CHOOSE    a utility score per state, weighted│
│  • reflex probe straight      ├────────────▶│               by personality, with hysteresis    │
│    ahead (Normal and Hard)    │  front      │  3. PLAN      goals to steer toward / away from  │
└──────────────┬────────────────┘             │  4. STEER     context steering with look-ahead,  │
               │ wantAngle, wantBoost         │               then the boost decision            │
               ▼                              └──────────────────────────────────────────────────┘
Snake.update: turn toward wantAngle by at most turnRate·dt, move, boost costs length
```

The bots and the player drive the same `Snake`: a controller only sets `wantAngle` and `wantBoost`. The snake turns at a limited rate (slower when big or boosting), so every turn is a smooth curve and a 180° turn takes about 0.7 s for a small snake.

Full decisions run every 3 (Hard), 5 (Normal) or 9 (Easy) ticks, plus a random 0 to 2 ticks so the bots spread their thinking across frames. On Normal and Hard, a cheap two-point probe straight ahead runs every tick and triggers an immediate think if something appears in front: a reflex.

### 1. Perception (`src/ai/perception.js`)

The bot only senses what is within its view radius (450, 600 or 760 px by difficulty).

- **Threat level** for every head in view: `closeness^1.2 × intent × closing speed × boosting × size`.
  - *Intent* is how much their head points at us, or at the spot just in front of us (the cut-off move).
  - *Size* is their size divided by our personality's `fleeRatio`, so a defensive bot fears a snake its own size about as much as an aggressive bot fears one 2.4 times bigger.
- **Prey** are snakes up to `preyRatio` times our size. They rank higher when close, not facing us, near the arena edge, and not boosting.
- **Food** is scored per grid cell, not per pellet:
  - The score is a cell's total value divided by the time to get there, including the time spent turning. Bots therefore prefer rich clusters such as death trails.
  - Cells crowded by other bodies count for less, more so for cautious bots.
  - Food inside the bot's own turning circle is skipped, because chasing it would only make the bot orbit it.
  - The previous target gets a 25% bonus, so the bot doesn't flip between two targets.
- **Smell:** when no food is in view, a coarse map of food per 600 px block gives the bot somewhere promising to head for, so it never just wanders.
- **Events:**
  - Recent deaths (their food piles) and how many snakes are already near each one.
  - Hotspots, where two heads are close (a fight).
- **Encirclement:** the space around the head is split into 16 sectors, and a sector counts as blocked when another body or the edge is in it. If most sectors are blocked, the bot is being coiled, and the widest run of open sectors is the way out.

### 2. Choosing a state (`BotBrain.utilities`)

Every state gets a score of roughly 0 to 1.6:

| State | Score grows with | What it does |
| --- | --- | --- |
| forage | greed × food score (always at least 0.22) | eat the best food, or follow the smell |
| hunt | aggression × prey vulnerability | cut in front of a smaller snake |
| encircle | aggression × encircle trait, only with a long body, a victim under 45% of our size within 320 px, and us beside or ahead of it | coil around it and tighten |
| flee | top threat × caution | run along the sum of "away from each threat" vectors |
| escape | how trapped we are (beats everything) | race for the widest gap, boosting |
| scavenge | death-site value ÷ travel time × opportunism, less if contested and we're cautious | rush to the food pile |
| lurk | opportunism × fight intensity, 220 to 1500 px away | circle the fight at 380 px, ready to pounce |

The current state's score is multiplied by 1.2 (hysteresis), and a new state must last 0.5 s unless it is *flee* or *escape*. Bots therefore commit to a plan instead of dithering. A chase that goes nowhere for 6 seconds is dropped, and that victim is ignored for 6 more.

### 3. Planning (`BotBrain.plan`)

Each state becomes a list of goals (directions to steer toward, with a weight and a sharpness) and avoids (directions to steer away from):

- **Hunt:**
  - Predict where the victim's head will be when we can get there, iterating three times.
  - Aim about 70 to 250 px past that point (further for more aggressive bots), crossing 40 px to the far side of its path, so our body ends up across it.
  - The steering system is told this snake is the prey, so its future path is not treated as a wall: cutting across it is the point.
- **Encircle:**
  - Aim at a point 0.75 rad further around a circle centred just ahead of the victim's head.
  - The circle starts at about 60% of our body length around and shrinks every decision.
  - Boost while we are still abeam of or behind the victim.
- **Flee:** move along the threat-weighted escape vector, still grabbing food on the way.
- **Every state:**
  - Threats push a little: 0.6× their level normally, 1.6× while fleeing, scaled by caution.
  - Near the arena edge, a goal toward the centre is added.

### 4. Steering with collision prediction (`src/ai/steering.js`)

This is **context steering**. The bot considers 16, 24 or 32 headings evenly around itself, and builds two maps:

- **Danger, from 0 to 1, per heading.** The bot simulates driving toward that heading for 0.7, 1.0 or 1.3 seconds (by difficulty). It turns only as fast as the snake really can, and checks a sample every 0.07 s against:
  - other bodies (through the spatial grid), plus a personal safety margin: 4 px for aggressive bots, 16 px for defensive ones
  - the arena edge
  - where other heads will be at that moment
  - the stretch each other head is about to drive over, which will soon be its body (skipped for the prey we're hunting)

  A hit right away scores 1; a hit near the horizon scores close to 0.
- **Interest per heading:** how well it lines up with the goals, minus how much it points at avoids, plus a little momentum.

**Survival comes first.** Only headings within a small tolerance of the safest heading are allowed. The tolerance is wider for risk-takers, which is why aggressive bots cut closer. Among the allowed headings, the most interesting one wins, refined between neighbouring rays for a smooth aim. Aim noise is then added by difficulty, and reduced when things are tight.

On Easy, each decision has an 8% chance of being a **blunder** that ignores danger. Easy bots also react later and see less.

### 5. Boosting (`BotBrain.decideBoost`)

Boosting always needs a reason:

- **Hunt:** we are facing the intercept point, the victim is close (closer for less boost-happy bots), we are big enough to spend length, and a roll against `boostiness` succeeds.
- **Encircle:** to get around the victim.
- **Flee:** the top threat is high and still closing.
- **Escape:** always, to get through the gap before it closes.
- **Scavenge:** the pile is big, close and contested, and a roll against `boostiness` succeeds.

A bot never boosts into a heading with danger, except to escape a coil. Once started, a boost lasts at least 0.35 s so it doesn't flicker.

### Personalities (`src/ai/personalities.js`)

The same code runs every bot; only these weights differ. Each bot's traits are randomized by up to ±15%. Each also gets its own circling direction, wiggle speed and colours, so no two bots play alike.

| | aggression | caution | greed | opportunism | boostiness | risk | attacks snakes up to | fully scared of |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 🔥 Aggressive | 0.95 | 0.30 | 0.55 | 0.20 | 0.85 | 0.70 | 1.15× its size | 2.4× its size |
| 🛡️ Defensive | 0.12 | 0.95 | 0.80 | 0.25 | 0.30 | 0.12 | 0.35× | 0.85× |
| ⚖️ Balanced | 0.55 | 0.60 | 0.70 | 0.40 | 0.55 | 0.40 | 0.75× | 1.4× |
| 🦊 Opportunistic | 0.35 | 0.70 | 0.60 | 0.95 | 0.60 | 0.35 | 0.5× | 1.15× |

Snake colours follow the personality: aggressive bots are reds and oranges, defensive bots blues and teals, balanced bots greens and opportunists purples. The debug view adds the personality icon to each name.

### Difficulty (`src/config.js`)

| | thinks every | headings | look-ahead | view | aim noise | reflex | blunders |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Easy | 9 ticks | 16 | 0.7 s | 450 px | 0.22 rad | no | 8% of decisions |
| Normal | 5 ticks | 24 | 1.0 s | 600 px | 0.08 rad | yes | 1.5% |
| Hard | 3 ticks | 32 | 1.3 s | 760 px | 0.02 rad | yes | none |

Difficulty changes how well bots think, never how fast their snakes move.

## Debug mode

Press **B** (or 🧠 Debug). For every bot on screen:

- **Look-ahead rays:** one short ray per heading it considered, green when clear and red when it would hit something soon.
- **Chosen heading:** a white line.
- **Target:** a line coloured by what it is: yellow food, grey dashed smell, red prey, pink coil point, cyan flee, white escape gap, orange death site, purple lurk point.
- **Threats:** red lines from dangerous heads, thicker when scarier.
- **Label:** its current state (⚡ while boosting) and threat level.

The side panel shows the followed bot (or, while playing, the bot nearest you): its personality traits and how much it wants each state right now. The console exposes `snakeArena.game` (try `snakeArena.game.setDifficulty('hard')`) and `snakeArena.fastForward(seconds)`.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | The page, menus and HUD |
| `src/main.js` | Browser entry: menus, mouse/touch/keyboard input, the fixed-step loop, the leaderboard and the debug inspector |
| `src/config.js` | Every tuning number: world, snake physics, difficulty levels |
| `src/game.js` | The world and one fixed tick: think, move, eat, collide, turn the dead into food, respawn, track fights |
| `src/snake.js` | Movement, smooth turning, boosting, and a body that follows the exact path of the head |
| `src/food.js` | Pellets, respawning, the food grid and the coarse smell map |
| `src/spatial.js` | Uniform spatial grid, so collision and vision checks only look at nearby things |
| `src/collision.js` | Head-versus-body and arena-edge collisions; `bodyAt` is shared with the AI |
| `src/bot.js` | A bot seat: name, personality, brain, respawning and stats |
| `src/ai/perception.js` | What the bot knows: threats, prey, food, events, encirclement |
| `src/ai/brain.js` | Utility-based state choice, planning, intercept and coil maths, boost decisions |
| `src/ai/steering.js` | Context steering with arc-simulated collision prediction |
| `src/ai/personalities.js` | The four personalities, randomization and names |
| `src/ai/wander.js` | A random control group for the simulator |
| `src/render/renderer.js` | Canvas drawing: arena, glowing food, snakes, names, the debug overlay, the minimap |
| `sim/headless.js`, `sim/scenarios.js` | The simulator and the behaviour tests |

To add a bot from code: `game.addBot('aggressive')`. To add a new personality, add an entry to `PERSONALITIES` with the same traits. The brain needs no changes.

## How the game works

- The arena is a circle with a radius of 3,000 px; touching its edge is fatal. About 2,400 natural pellets are kept on the map.
- A snake's body follows the exact trail of its head and is re-sampled each tick, so a coil holds its shape.
- Snakes never hit themselves. A head touching any other snake's body or head dies, and both die in a head-on crash.
- A dead snake leaves 75% of its length as food along its body.
- Boosting doubles speed and costs 7 length per second; 60% of that is dropped behind as pellets.
- The simulation runs at a fixed 60 ticks per second; the browser draws the latest tick with a smoothly easing camera that zooms out as the followed snake grows.
- Every tick rebuilds a spatial grid of all body segments and all pellets. Clearing it touches only the cells used last time, so 50 snakes cost about 3 ms per tick.

## Ideas to improve the AI further

1. **Learn the weights.** Personalities are a dozen numbers, a good fit for an evolutionary search: run `sim/headless.js` tournaments, keep the winners, and mutate them. A learned "expert" preset could go on Hard.
2. **Model the opponent's mind.** Bots currently predict other heads as straight lines. Using each snake's own steering (or recent turning) as the forecast would make cut-offs and dodges much sharper.
3. **Teamwork.** Two aggressive bots could share a target: one herds it while the other cuts it off. A simple shared "hunt board" in the game would let them coordinate.
4. **Better coils.** Coil only when the body can close the loop in time, and judge that from the prey's speed and turn rate. Fill gaps by watching the encirclement sectors from the hunter's side.
5. **Memory.** Remember who attacked us and hold a grudge, or avoid an area where we nearly died.
6. **Smarter boosting.** Weigh the length spent against the expected gain, for example the size of the food pile multiplied by the chance of getting there first.
7. **More human feel.** Give each bot a "mood" that drifts over a life (cautious when big, bold when small), and occasional sightseeing loops, so watching them is even more lifelike.
8. **Server play.** `game.js` has no browser code, so the same file can run on a Node server for real multiplayer, with bots filling empty seats.
