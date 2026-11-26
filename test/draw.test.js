// Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../draw.js');

const box = (left, top, right, bottom) => ({ left, top, right, bottom });

test('mergeByLine joins words on one line', () => {
  const out = D.mergeByLine([box(10, 100, 50, 118), box(54, 101, 90, 117), box(92, 100, 130, 118)]);
  assert.deepEqual(out, [box(10, 100, 130, 118)]);
});

test('mergeByLine keeps separate lines apart', () => {
  const out = D.mergeByLine([box(200, 100, 400, 118), box(10, 122, 90, 140)]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], box(200, 100, 400, 118));
  assert.deepEqual(out[1], box(10, 122, 90, 140));
});

test('mergeByLine does not bridge far-apart columns', () => {
  const out = D.mergeByLine([box(10, 100, 90, 118), box(500, 100, 580, 118)]);
  assert.equal(out.length, 2);
});

test('mergeByLine drops empty rects', () => {
  assert.deepEqual(D.mergeByLine([box(10, 100, 10, 118), box(10, 100, 40, 100)]), []);
});

test('intersect clips, and returns null when nothing is left', () => {
  assert.deepEqual(D.intersect(box(0, 0, 100, 20), box(50, 5, 200, 200)), box(50, 5, 100, 20));
  assert.equal(D.intersect(box(0, 0, 100, 20), box(0, 30, 100, 60)), null);
});

test('union covers all boxes', () => {
  assert.deepEqual(D.union([box(10, 100, 50, 118), box(5, 120, 30, 140)]), box(5, 100, 50, 140));
  assert.equal(D.union([]), null);
});

test('paths are stable for a seed and differ between seeds', () => {
  const b = box(100, 200, 260, 220);
  for (const fn of [D.underlinePath, D.circlePath]) {
    assert.equal(fn(b, 7), fn(b, 7));
    assert.notEqual(fn(b, 7), fn(b, 8));
    assert.match(fn(b, 7), /^M[-\d. ]+(C[-\d. ]+)+$/);
  }
});

const numbers = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number);
const xy = (d) => {
  const n = numbers(d);
  return { xs: n.filter((_, i) => i % 2 === 0), ys: n.filter((_, i) => i % 2 === 1) };
};

test('underline sits just below the box and spans it', () => {
  const b = box(100, 200, 260, 220);
  for (let seed = 1; seed <= 50; seed++) {
    const { xs, ys } = xy(D.underlinePath(b, seed));
    assert.ok(Math.min(...ys) >= b.bottom - 1, 'never crosses into the text');
    assert.ok(Math.max(...ys) <= b.bottom + 12, 'stays close to the text');
    assert.ok(Math.min(...xs) <= b.left && Math.max(...xs) >= b.right, 'covers the full width');
    assert.ok(Math.min(...xs) >= b.left - 14 && Math.max(...xs) <= b.right + 14, 'does not run far past');
  }
});

test('circle encloses the box', () => {
  const b = box(100, 200, 260, 220);
  for (let seed = 1; seed <= 50; seed++) {
    const { xs, ys } = xy(D.circlePath(b, seed));
    assert.ok(Math.min(...xs) < b.left && Math.max(...xs) > b.right);
    assert.ok(Math.min(...ys) < b.top && Math.max(...ys) > b.bottom);
  }
});

test('stroke width scales with text size within limits', () => {
  assert.equal(D.strokeWidth(10), 2);
  assert.equal(D.strokeWidth(30), 3);
  assert.equal(D.strokeWidth(200), 4.5);
});
