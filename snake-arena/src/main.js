import { Game } from './game.js';
import { WORLD } from './config.js';
import { Renderer } from './render/renderer.js';
import { PERSONALITIES, KINDS } from './ai/personalities.js';

// Browser entry point: menus, input, the frame loop and the HUD.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ren = new Renderer($('cv'));
let game = null, mode = 'demo', paused = false, focus = null, acc = 0, last = performance.now(), hudAt = 0, deadTimer = 0;
const input = { sx: innerWidth / 2 + 100, sy: innerHeight / 2, boost: false, keyBoost: false };

$('kinds').innerHTML = KINDS.map((k) => {
  const p = PERSONALITIES[k];
  return `<li style="--c:hsl(${p.hues[0]},80%,55%)"><b>${p.icon} ${p.label}</b><span>${p.blurb}</span></li>`;
}).join('');

/** A game of bots playing behind the start menu. */
function demo() {
  game = new Game({ seed: 42, difficulty: 'normal', bots: 24 });
  ren.setGame(game);
  mode = 'demo';
  game.on(onEvent);
}

function newGame(kind) {
  clearTimeout(deadTimer);
  const diff = document.querySelector('input[name=diff]:checked').value;
  game = new Game({ seed: (Math.random() * 1e9) | 0, difficulty: diff, bots: +$('nbots').value });
  ren.setGame(game);
  game.on(onEvent);
  mode = kind; paused = false; focus = null;
  if (kind === 'play') game.addPlayer(($('name').value.trim() || 'You').slice(0, 16));
  $('hudDiff').value = diff;
  $('pauseBtn').textContent = '⏸';
  $('menu').hidden = true; $('dead').hidden = true; $('hud').hidden = false;
  $('feed').innerHTML = '';
  const t = target();
  if (t) { ren.cam.x = t.x; ren.cam.y = t.y; }
}

/** Who the camera follows. */
function target() {
  if (!game) return null;
  if (mode === 'play' && game.player) return game.player;
  if (focus && focus.alive) return focus;
  focus = game.leaders(1)[0] || null;
  return focus;
}

function onEvent(ev) {
  if (ev.type !== 'death') return;
  const { victim, killer } = ev;
  if (mode !== 'demo') {
    const line = document.createElement('div');
    line.textContent = killer ? `${killer.name} got ${victim.name}` : `${victim.name} hit the edge`;
    $('feed').prepend(line);
    while ($('feed').children.length > 5) $('feed').lastChild.remove();
    setTimeout(() => line.remove(), 5000);
  }
  if (mode === 'play' && victim.isPlayer) {
    focus = killer && killer.alive ? killer : null;
    $('deadTitle').textContent = killer ? `${killer.name} got you!` : 'You hit the edge!';
    $('deadText').textContent = `Longest you got: ${Math.round(victim.peakMass)}. Snakes you took out: ${victim.kills}.`;
    deadTimer = setTimeout(() => { $('dead').hidden = false; $('again').focus(); }, 1200);
  }
}

/** Turn the mouse/touch position into the player's wanted heading. */
function applyInput() {
  const p = game.player;
  if (mode !== 'play' || !p) return;
  const w = ren.screenToWorld(input.sx, input.sy);
  p.wantAngle = Math.atan2(w.y - p.y, w.x - p.x);
  p.wantBoost = input.boost || input.keyBoost;
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game && !paused) {
    // Fixed-step simulation: the game always advances in 1/60 s ticks.
    const step = 1 / WORLD.tickRate;
    acc += dt;
    let k = 0;
    while (acc >= step && k < 4) { applyInput(); game.step(step); acc -= step; k++; }
    if (k === 4) acc = 0;
  }
  const t = target();
  ren.focus = inspected();
  ren.follow(t, dt);
  ren.draw(now / 1000);
  if (mode !== 'demo') ren.drawMinimap($('mini'), game && game.player);
  if (now - hudAt > 250) { hudAt = now; hud(); }
  requestAnimationFrame(frame);
}

/** The bot shown in the debug inspector: the one we follow, or the bot nearest to the player. */
function inspected() {
  if (!game) return null;
  if (mode === 'watch') return focus && focus.bot ? focus : null;
  const p = game.player;
  if (!p) return null;
  let best = null, bd = Infinity;
  for (const s of game.snakes) {
    if (!s.bot) continue;
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function hud() {
  if (!game || mode === 'demo') return;
  const p = game.player, all = game.leaders(game.snakes.length);
  if (mode === 'play' && p) {
    $('stats').innerHTML = `<b>${Math.round(p.mass)}</b> length · rank #${all.indexOf(p) + 1} of ${all.length} · ${p.kills} kill${p.kills === 1 ? '' : 's'}${p.boosting ? ' · ⚡' : ''}`;
  } else {
    const f = target();
    $('stats').innerHTML = f ? `👀 Watching <b>${esc(f.name)}</b> ${f.bot ? `(${PERSONALITIES[f.bot.kind].icon} ${PERSONALITIES[f.bot.kind].label})` : ''} · click a snake to follow it` : '👀 Watching';
  }
  $('board').innerHTML = all.slice(0, 10).map((s) => {
    const k = s.bot ? PERSONALITIES[s.bot.kind].icon + ' ' : '';
    const cls = s.isPlayer ? 'me' : s === focus && mode === 'watch' ? 'focus' : '';
    return `<li class="${cls}">${k}${esc(s.name)}<span>${Math.round(s.mass)}</span></li>`;
  }).join('');
  const b = ren.debug ? inspected() : null;
  $('inspect').hidden = !b;
  if (b) $('inspect').innerHTML = inspectHtml(b);
}

/** The debug panel: personality traits and how much the bot wants each option right now. */
function inspectHtml(s) {
  const P = s.bot.personality, d = s.bot.brain.debug || {}, K = PERSONALITIES[s.bot.kind];
  const bar = (n, v, cls = '') => `<div class="trait ${cls}"><span>${n}</span><span class="bar ${cls ? 'st' : ''}"><i style="width:${Math.round(Math.min(1, v) * 100)}%"></i></span><span>${v.toFixed(2)}</span></div>`;
  const traits = ['aggression', 'caution', 'greed', 'opportunism', 'boostiness', 'risk'].map((k) => bar(k, P[k])).join('');
  const util = Object.entries(d.u || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => bar(k, v / 1.6, k === d.state ? 'on' : 'st')).join('');
  return `<h3>${K.icon} ${esc(s.name)}</h3><div>${K.label} · length ${Math.round(s.mass)} · ${s.kills} kills</div>
    <div style="margin:6px 0">Thinking: <b class="on">${(d.state || '').toUpperCase()}</b>${d.boost ? ' ⚡ boosting' : ''} · threat ${(d.threat || 0).toFixed(2)}${d.trapped ? ` · trapped ${d.trapped.toFixed(2)}` : ''}</div>
    <div style="color:var(--mute);margin-top:6px">Personality</div>${traits}<div style="color:var(--mute);margin-top:6px">What it wants right now</div>${util}`;
}

function toggleDebug() {
  ren.debug = !ren.debug;
  $('dbgBtn').setAttribute('aria-pressed', ren.debug);
  hud();
}
function togglePause() {
  if (mode === 'demo') return;
  paused = !paused;
  $('pauseBtn').textContent = paused ? '▶' : '⏸';
  $('pauseBtn').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
}
function showMenu() {
  clearTimeout(deadTimer);
  $('dead').hidden = true; $('hud').hidden = true; $('menu').hidden = false;
  demo();
  $('play').focus();
}

// ---- Input ----
const cv = $('cv');
cv.addEventListener('pointermove', (e) => { input.sx = e.clientX; input.sy = e.clientY; });
cv.addEventListener('pointerdown', (e) => {
  input.sx = e.clientX; input.sy = e.clientY;
  if (mode === 'watch') {
    // Pick the snake whose body is nearest the click.
    const w = ren.screenToWorld(e.clientX, e.clientY);
    let best = null, bd = 60 / ren.cam.zoom;
    for (const s of game.snakes) for (let i = 0; i < s.n; i += 2) {
      const d = Math.hypot(s.bx[i] - w.x, s.by[i] - w.y) - s.radius;
      if (d < bd) { bd = d; best = s; }
    }
    if (best) { focus = best; hud(); }
  } else if (e.pointerType === 'mouse') input.boost = true;
});
addEventListener('pointerup', () => { input.boost = false; });
$('boostBtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); input.boost = true; });
$('boostBtn').addEventListener('pointerup', () => { input.boost = false; });

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { input.keyBoost = true; e.preventDefault(); }
  else if (e.key === 'b' || e.key === 'B') toggleDebug();
  else if (e.key === 'p' || e.key === 'P') togglePause();
  else if (e.key === 'Escape') showMenu();
  else if ((e.key === 'f' || e.key === 'F') && mode === 'watch') {
    const L = game.leaders(10);
    focus = L[(L.indexOf(focus) + 1) % L.length];
    hud();
  }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') input.keyBoost = false; });

// ---- Menus and buttons ----
$('nbots').addEventListener('input', (e) => { $('nbotsOut').textContent = e.target.value; });
$('play').onclick = () => newGame('play');
$('watch').onclick = () => newGame('watch');
$('again').onclick = () => newGame('play');
$('deadWatch').onclick = () => { $('dead').hidden = true; mode = 'watch'; };
$('deadMenu').onclick = showMenu;
$('dbgBtn').onclick = toggleDebug;
$('pauseBtn').onclick = togglePause;
$('menuBtn').onclick = showMenu;
$('hudDiff').onchange = (e) => { game.setDifficulty(e.target.value); };

// Console hook for experiments, e.g. snakeArena.game.setDifficulty('hard') or snakeArena.fastForward(30)
window.snakeArena = {
  get game() { return game; },
  renderer: ren,
  fastForward(seconds) { for (let i = 0; i < seconds * WORLD.tickRate; i++) game.step(); },
};

demo();
requestAnimationFrame(frame);
