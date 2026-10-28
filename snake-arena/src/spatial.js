import { clamp } from './math.js';

/**
 * A uniform grid over the square that holds the circular arena.
 * Rebuilt every tick: clearing only touches cells that were used, so it stays
 * cheap even with tens of thousands of body segments.
 */
export class SpatialGrid {
  constructor(worldRadius, cellSize) {
    this.cell = cellSize;
    this.min = -worldRadius;
    this.n = Math.ceil((2 * worldRadius) / cellSize) + 1;
    this.cells = Array.from({ length: this.n * this.n }, () => []);
    this.used = [];
  }

  cellX(x) { return clamp(Math.floor((x - this.min) / this.cell), 0, this.n - 1); }
  cellY(y) { return clamp(Math.floor((y - this.min) / this.cell), 0, this.n - 1); }
  key(x, y) { return this.cellY(y) * this.n + this.cellX(x); }

  clear() {
    for (const k of this.used) this.cells[k].length = 0;
    this.used.length = 0;
  }

  insert(x, y, item) {
    const k = this.key(x, y), c = this.cells[k];
    if (c.length === 0) this.used.push(k);
    c.push(item);
  }

  /**
   * Calls fn(item) for every item in the cells that overlap the circle (x, y, r).
   * If fn returns true the search stops and query returns true.
   */
  query(x, y, r, fn) {
    const x0 = this.cellX(x - r), x1 = this.cellX(x + r);
    const y0 = this.cellY(y - r), y1 = this.cellY(y + r);
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.n;
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells[row + cx];
        for (let i = 0; i < arr.length; i++) if (fn(arr[i])) return true;
      }
    }
    return false;
  }

  /** Visits each non-empty cell overlapping the circle: fn(items, centerX, centerY). */
  forCells(x, y, r, fn) {
    const x0 = this.cellX(x - r), x1 = this.cellX(x + r);
    const y0 = this.cellY(y - r), y1 = this.cellY(y + r);
    const h = this.cell / 2;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells[cy * this.n + cx];
        if (arr.length) fn(arr, this.min + cx * this.cell + h, this.min + cy * this.cell + h);
      }
    }
  }
}
