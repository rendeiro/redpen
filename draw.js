// Pure geometry and path helpers. No DOM here, so node can test them.
// A box is { left, top, right, bottom } in viewport pixels.
(function (root) {
  const RED = '#e5261f';

  // Small seeded random generator (mulberry32). Same seed, same shape.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const visible = (r) => r.right - r.left > 0.5 && r.bottom - r.top > 0.5;

  function intersect(a, b) {
    const r = {
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
    };
    return visible(r) ? r : null;
  }

  function union(boxes) {
    if (!boxes.length) return null;
    return {
      left: Math.min(...boxes.map((b) => b.left)),
      top: Math.min(...boxes.map((b) => b.top)),
      right: Math.max(...boxes.map((b) => b.right)),
      bottom: Math.max(...boxes.map((b) => b.bottom)),
    };
  }

  // Joins the many small rects a selection produces into one box per line.
  // Rects join when they overlap vertically and sit close side by side, so
  // text in two far-apart columns stays as two boxes.
  function mergeByLine(rects) {
    const near = (l, r) => {
      const h = Math.min(l.bottom - l.top, r.bottom - r.top);
      const overlap = Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top);
      const gap = Math.max(l.left, r.left) - Math.min(l.right, r.right);
      return overlap > 0.5 * h && gap < 1.5 * h;
    };
    let lines = rects.filter(visible).map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
    // Repeat until nothing joins: a merge can bring two boxes within reach of a third.
    for (let merged = true; merged; ) {
      merged = false;
      const out = [];
      for (const r of lines) {
        const line = out.find((l) => near(l, r));
        if (line) {
          Object.assign(line, union([line, r]));
          merged = true;
        } else out.push(r);
      }
      lines = out;
    }
    return lines.sort((a, b) => a.top - b.top || a.left - b.left);
  }

  const n1 = (v) => Math.round(v * 10) / 10;

  // Smooth curve through the points (Catmull-Rom, written as cubic Béziers).
  function smooth(pts) {
    let d = `M${n1(pts[0][0])} ${n1(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${n1(c1[0])} ${n1(c1[1])} ${n1(c2[0])} ${n1(c2[1])} ${n1(p2[0])} ${n1(p2[1])}`;
    }
    return d;
  }

  function strokeWidth(height) {
    return Math.min(4.5, Math.max(2, height * 0.1));
  }

  // A marker underline: one stroke left to right, then back again a little lower.
  function underlinePath(box, seed) {
    const r = rng(seed);
    const h = box.bottom - box.top;
    const amp = Math.max(0.5, h * 0.04);
    const y = box.bottom + Math.max(1.5, h * 0.08);
    const tilt = (r() - 0.5) * h * 0.1;
    const pts = [];
    const stroke = (x0, x1, dy) => {
      const n = Math.max(2, Math.round(Math.abs(x1 - x0) / 45));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t;
        const lean = tilt * ((x - box.left) / Math.max(1, box.right - box.left) - 0.5);
        pts.push([x, y + dy + lean + (r() - 0.5) * 2 * amp]);
      }
    };
    const left = box.left - 1 - r() * 3;
    const right = box.right + 1 + r() * 3;
    stroke(left, right, 0);
    stroke(right - 2 - r() * 4, left + (right - left) * (0.05 + r() * 0.2), strokeWidth(h) * 0.9);
    return smooth(pts);
  }

  // A marker loop: a rounded shape that hugs the box, drawn in one go, with
  // the end overshooting the start instead of meeting it.
  function circlePath(box, seed) {
    const r = rng(seed);
    const w = box.right - box.left;
    const h = box.bottom - box.top;
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const rx = w / 2 + Math.max(7, h * 0.45);
    const ry = h / 2 + Math.max(4, h * 0.3);
    const power = 2 / 2.6;
    const steps = 30;
    const start = Math.PI * (0.95 + r() * 0.2);
    const total = Math.PI * 2 + 0.3 + r() * 0.3;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = start + total * t;
      const grow = (1 + 0.06 * t) * (1 + (r() - 0.5) * 0.04);
      const c = Math.cos(a);
      const s = Math.sin(a);
      pts.push([
        cx + rx * grow * Math.sign(c) * Math.pow(Math.abs(c), power),
        cy + ry * grow * Math.sign(s) * Math.pow(Math.abs(s), power),
      ]);
    }
    return smooth(pts);
  }

  const api = { RED, rng, intersect, union, mergeByLine, smooth, strokeWidth, underlinePath, circlePath };
  root.RedpenDraw = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
