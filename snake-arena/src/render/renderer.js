import { WORLD } from '../config.js';
import { TAU, clamp } from '../math.js';
import { PERSONALITIES } from '../ai/personalities.js';

const TARGET_COLORS = {
  food: '#fde047', smell: '#94a3b8', prey: '#f87171', coil: '#fb7185', flee: '#67e8f9',
  gap: '#ffffff', death: '#fb923c', lurk: '#c084fc',
};

/**
 * Draws a Game onto a canvas. Reads game state only; never changes it.
 * The camera eases after a snake and zooms out as that snake grows.
 */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = null;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.debug = false;
    this.focus = null;
    this.glow = new Map();
    this.bg = null;
  }

  setGame(game) { this.game = game; }

  /** Ease the camera toward a snake (or the arena centre). */
  follow(snake, dt) {
    const c = this.cam, k = 1 - Math.exp(-dt * 6);
    const tx = snake ? snake.x : 0, ty = snake ? snake.y : 0;
    c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
    const fit = clamp(Math.min(this.canvas.clientWidth, this.canvas.clientHeight) / 900, 0.5, 1.25);
    const grow = snake ? clamp(1.15 - Math.log10(Math.max(20, snake.mass) / 20) * 0.28, 0.5, 1.15) : 0.55;
    c.zoom += (fit * grow - c.zoom) * k;
  }

  screenToWorld(sx, sy) {
    const c = this.cam;
    return { x: c.x + (sx - this.canvas.clientWidth / 2) / c.zoom, y: c.y + (sy - this.canvas.clientHeight / 2) / c.zoom };
  }

  draw(time) {
    const cv = this.canvas, x = this.ctx, g = this.game, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const z = this.cam.zoom * dpr;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#0a0d17';
    x.fillRect(0, 0, cv.width, cv.height);
    if (!g) return;
    x.setTransform(z, 0, 0, z, cv.width / 2 - this.cam.x * z, cv.height / 2 - this.cam.y * z);
    const vw = w / this.cam.zoom / 2, vh = h / this.cam.zoom / 2;
    const V = { x0: this.cam.x - vw, x1: this.cam.x + vw, y0: this.cam.y - vh, y1: this.cam.y + vh };
    this.view = V;

    this.drawArena(V);
    this.drawFood(V, time);
    const order = [...g.snakes].sort((a, b) => a.mass - b.mass);
    for (const s of order) if (this.visible(s, V)) this.drawSnake(s);
    if (this.debug) for (const s of g.snakes) if (s.bot && this.visible(s, V)) this.drawDebug(s, s === this.focus);
    for (const s of order) if (this.visible(s, V)) this.drawName(s);
  }

  /** Rough cull: is any part of this snake near the screen? */
  visible(s, V) {
    const m = 60 + s.radius;
    for (let i = 0; i < s.n; i += 8) {
      if (s.bx[i] > V.x0 - m && s.bx[i] < V.x1 + m && s.by[i] > V.y0 - m && s.by[i] < V.y1 + m) return true;
    }
    return false;
  }

  drawArena(V) {
    const x = this.ctx, R = WORLD.radius;
    if (!this.bg) this.bg = x.createPattern(hexTile(), 'repeat');
    x.save();
    x.beginPath(); x.arc(0, 0, R, 0, TAU); x.clip();
    x.fillStyle = this.bg; x.fillRect(V.x0, V.y0, V.x1 - V.x0, V.y1 - V.y0);
    x.restore();
    // Outside the arena: dim red
    x.beginPath(); x.rect(V.x0, V.y0, V.x1 - V.x0, V.y1 - V.y0); x.arc(0, 0, R, 0, TAU);
    x.fillStyle = 'rgba(90, 10, 25, 0.55)'; x.fill('evenodd');
    x.beginPath(); x.arc(0, 0, R, 0, TAU);
    x.lineWidth = 10; x.strokeStyle = 'rgba(255, 70, 90, 0.55)'; x.stroke();
  }

  drawFood(V, time) {
    const x = this.ctx, grid = this.game.food.grid, cx = (V.x0 + V.x1) / 2, cy = (V.y0 + V.y1) / 2;
    const r = Math.max(V.x1 - V.x0, V.y1 - V.y0) / 2 + 40;
    x.globalCompositeOperation = 'lighter';
    grid.forCells(cx, cy, r, (arr) => {
      for (const f of arr) {
        if (!f.alive) continue;
        const pulse = 1 + 0.15 * Math.sin(time * 3 + f.phase), size = (7 + Math.sqrt(f.value) * 5) * pulse;
        x.drawImage(this.sprite(f.hue), f.x - size, f.y - size, size * 2, size * 2);
      }
    });
    x.globalCompositeOperation = 'source-over';
  }

  /** A soft glowing dot, cached per hue. */
  sprite(hue) {
    const key = Math.round(hue / 15) * 15;
    let c = this.glow.get(key);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 48;
      const x = c.getContext('2d'), gr = x.createRadialGradient(24, 24, 0, 24, 24, 24);
      gr.addColorStop(0, `hsla(${key}, 100%, 82%, 1)`);
      gr.addColorStop(0.25, `hsla(${key}, 100%, 62%, 0.9)`);
      gr.addColorStop(1, `hsla(${key}, 100%, 50%, 0)`);
      x.fillStyle = gr; x.fillRect(0, 0, 48, 48);
      this.glow.set(key, c);
    }
    return c;
  }

  /** Body as one thick stroked path (fast), stripes via a dashed stroke, then head and eyes. */
  drawSnake(s) {
    const x = this.ctx, n = s.n, r = s.radius, { hue, hue2 } = s.skin;
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(s.bx[0], s.by[0]);
    for (let i = 1; i < n; i++) x.lineTo(s.bx[i], s.by[i]);
    if (s.boosting) { x.strokeStyle = `hsla(${hue}, 100%, 65%, 0.28)`; x.lineWidth = r * 2 + 16; x.stroke(); }
    x.strokeStyle = `hsl(${hue}, 60%, 18%)`; x.lineWidth = r * 2 + 3; x.stroke();
    x.strokeStyle = `hsl(${hue}, 78%, 50%)`; x.lineWidth = r * 2; x.stroke();
    x.setLineDash([r * 0.8, r * 1.7]);
    x.strokeStyle = `hsl(${hue2}, 85%, 63%)`; x.lineWidth = r * 1.55; x.stroke();
    x.setLineDash([]);
    x.strokeStyle = 'rgba(255, 255, 255, 0.13)'; x.lineWidth = r * 0.5; x.stroke();
    if (s.isPlayer) { x.strokeStyle = 'rgba(255, 255, 255, 0.5)'; x.lineWidth = 2 / this.cam.zoom; x.beginPath(); x.arc(s.x, s.y, r * 1.5, 0, TAU); x.stroke(); }
    // Head
    x.fillStyle = `hsl(${hue}, 80%, 55%)`;
    x.beginPath(); x.arc(s.x, s.y, r * 1.08, 0, TAU); x.fill();
    const fx = Math.cos(s.angle), fy = Math.sin(s.angle), nx = -fy, ny = fx;
    const lx = Math.cos(s.wantAngle), ly = Math.sin(s.wantAngle);
    for (const side of [-1, 1]) {
      const ex = s.x + fx * r * 0.35 + nx * side * r * 0.5, ey = s.y + fy * r * 0.35 + ny * side * r * 0.5;
      x.fillStyle = '#fff'; x.beginPath(); x.arc(ex, ey, r * 0.38, 0, TAU); x.fill();
      x.fillStyle = '#111827'; x.beginPath(); x.arc(ex + lx * r * 0.15, ey + ly * r * 0.15, r * 0.2, 0, TAU); x.fill();
    }
  }

  drawName(s) {
    const x = this.ctx, z = this.cam.zoom, k = s.bot ? PERSONALITIES[s.bot.kind] : null;
    x.font = `600 ${13 / z}px system-ui, sans-serif`;
    x.textAlign = 'center';
    x.fillStyle = s.isPlayer ? '#fde68a' : 'rgba(255, 255, 255, 0.82)';
    const label = (k && this.debug ? k.icon + ' ' : '') + s.name;
    x.fillText(label, s.x, s.y - s.radius - 12 / z);
  }

  /**
   * Debug view of a bot's mind: the danger of every heading it considered
   * (green = clear, red = blocked soon), the heading it chose (white), its
   * target (coloured by what it is), lines to threats (red, thicker = scarier),
   * its view radius, and its current state.
   */
  drawDebug(s, focused) {
    const d = s.bot.brain.debug, x = this.ctx, z = this.cam.zoom;
    if (!d) return;
    const lw = 1.4 / z;
    x.lineWidth = lw;
    if (d.dirs) {
      for (let j = 0; j < d.dirs.length; j++) {
        const dg = d.danger[j], len = 30 + (1 - dg) * 70;
        x.strokeStyle = `hsla(${120 * (1 - dg)}, 90%, 55%, ${focused ? 0.8 : 0.45})`;
        x.beginPath(); x.moveTo(s.x, s.y); x.lineTo(s.x + Math.cos(d.dirs[j]) * len, s.y + Math.sin(d.dirs[j]) * len); x.stroke();
      }
    }
    x.strokeStyle = '#fff'; x.lineWidth = 3 / z;
    x.beginPath(); x.moveTo(s.x, s.y); x.lineTo(s.x + Math.cos(d.angle) * 130, s.y + Math.sin(d.angle) * 130); x.stroke();
    x.lineWidth = lw;
    if (focused) {
      x.setLineDash([8 / z, 8 / z]); x.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      x.beginPath(); x.arc(s.x, s.y, d.view, 0, TAU); x.stroke(); x.setLineDash([]);
    }
    if (d.target) {
      x.strokeStyle = TARGET_COLORS[d.target.kind] || '#fff';
      x.setLineDash(d.target.kind === 'smell' ? [10 / z, 8 / z] : []);
      x.beginPath(); x.moveTo(s.x, s.y); x.lineTo(d.target.x, d.target.y); x.stroke(); x.setLineDash([]);
      x.beginPath(); x.arc(d.target.x, d.target.y, 7 / z, 0, TAU); x.stroke();
    }
    for (const t of d.threats) {
      x.strokeStyle = `rgba(255, 60, 60, ${clamp(t.level, 0.2, 0.9)})`; x.lineWidth = (1 + t.level * 4) / z;
      x.beginPath(); x.moveTo(t.x, t.y); x.lineTo(s.x, s.y); x.stroke();
    }
    x.font = `700 ${11 / z}px ui-monospace, monospace`; x.textAlign = 'center';
    x.fillStyle = d.blunder ? '#f87171' : '#e2e8f0';
    x.fillText(`${d.state.toUpperCase()}${d.boost ? ' ⚡' : ''}  threat ${d.threat.toFixed(2)}`, s.x, s.y - s.radius - 28 / z);
  }

  /** The small round map in the corner. */
  drawMinimap(mini, player) {
    const x = mini.getContext('2d'), W = mini.width, R = W / 2 - 4, k = R / WORLD.radius, g = this.game;
    x.clearRect(0, 0, W, W);
    x.fillStyle = 'rgba(15, 23, 42, 0.75)'; x.beginPath(); x.arc(W / 2, W / 2, R, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(255, 70, 90, 0.6)'; x.lineWidth = 2; x.stroke();
    if (!g) return;
    for (const s of g.snakes) {
      x.fillStyle = s === player ? '#fde68a' : `hsla(${s.skin.hue}, 80%, 60%, 0.85)`;
      const r = s === player ? 3.5 : clamp(Math.sqrt(s.mass) / 9, 1.2, 4);
      x.beginPath(); x.arc(W / 2 + s.x * k, W / 2 + s.y * k, r, 0, TAU); x.fill();
    }
    const V = this.view;
    if (V) {
      x.strokeStyle = 'rgba(255, 255, 255, 0.35)'; x.lineWidth = 1;
      x.strokeRect(W / 2 + V.x0 * k, W / 2 + V.y0 * k, (V.x1 - V.x0) * k, (V.y1 - V.y0) * k);
    }
  }
}

/** One tile of the hexagon floor pattern. */
function hexTile() {
  const s = 34, w = s * Math.sqrt(3), c = document.createElement('canvas');
  c.width = Math.round(w); c.height = Math.round(s * 3);
  const x = c.getContext('2d');
  x.fillStyle = '#121a2e'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#1c2742'; x.lineWidth = 2;
  const hex = (cx, cy) => {
    x.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; x.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s); }
    x.closePath(); x.stroke();
  };
  for (const [cx, cy] of [[0, 0], [w, 0], [w / 2, s * 1.5], [0, s * 3], [w, s * 3]]) hex(cx, cy);
  return c;
}
