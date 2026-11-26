// Runs in the page (one copy per frame). Keeps the list of marks and draws
// them on an overlay that follows the text. The page's own DOM is not changed.
(() => {
  if (globalThis.__redpen) return;
  const D = globalThis.RedpenDraw;
  const SVG = 'http://www.w3.org/2000/svg';
  const TYPES = ['underline', 'circle', 'highlight', 'blackout'];
  const PAD = 2; // extra cover around blacked-out or highlighted text

  const marks = []; // { type, color, range, seed, at, boxes }
  let tool = null; // the mark every new selection gets, or null when off
  const colors = { underline: '#e5261f', circle: '#e5261f', highlight: '#ffe600', blackout: '#000' };
  let host = null;
  let svg = null;
  let drawn = '';
  let frame = 0;
  let looping = false;
  let lastModal = null;

  function ensureOverlay() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-redpen', '');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
      'all: initial !important; position: fixed !important; inset: 0 !important;' +
      'width: 100vw !important; height: 100vh !important; margin: 0 !important;' +
      'padding: 0 !important; border: 0 !important; background: transparent !important;' +
      'overflow: visible !important; pointer-events: none !important; z-index: 2147483647 !important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    svg = document.createElementNS(SVG, 'svg');
    svg.style.cssText = 'position: fixed; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none;';
    shadow.append(svg);
    document.documentElement.append(host);
    raise();
    drawn = '';
  }

  // The top layer puts the overlay above modal dialogs and fullscreen elements.
  function raise() {
    try {
      host.popover = 'manual';
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } catch {}
  }

  // Open shadow roots, so a selection inside a web component can be read.
  function shadowRoots() {
    const roots = [];
    const walk = (node) => {
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          walk(el.shadowRoot);
        }
      }
    };
    walk(document);
    return roots;
  }

  function selectionRange() {
    const sel = getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let range = null;
    if (sel.getComposedRanges) {
      try {
        const s = sel.getComposedRanges({ shadowRoots: shadowRoots() })[0];
        if (s) {
          range = new Range();
          range.setStart(s.startContainer, s.startOffset);
          range.setEnd(s.endContainer, s.endOffset);
        }
      } catch {}
    }
    if (!range || range.collapsed) range = sel.getRangeAt(0).cloneRange();
    return range.collapsed || !range.toString().trim() ? null : range;
  }

  // Ancestors that can cut the text off (scrolling panels and the like).
  const clipCache = new WeakMap();
  function clippers(el) {
    if (clipCache.has(el)) return clipCache.get(el);
    const list = [];
    const html = getComputedStyle(document.documentElement);
    // With no overflow set on <html>, the body's overflow applies to the window, not the body box.
    const bodyScrollsWindow = html.overflowX === 'visible' && html.overflowY === 'visible';
    for (let e = el; e && e !== document.documentElement; e = e.parentElement || (e.getRootNode().host ?? null)) {
      if (e === document.body && bodyScrollsWindow) continue;
      const cs = getComputedStyle(e);
      if (cs.display !== 'inline' && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) list.push(e);
    }
    clipCache.set(el, list);
    return list;
  }

  function clip(rect, el) {
    let r = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    for (const c of clippers(el)) {
      const b = c.getBoundingClientRect();
      const inner = {
        left: b.left + c.clientLeft,
        top: b.top + c.clientTop,
        right: b.left + c.clientLeft + c.clientWidth,
        bottom: b.top + c.clientTop + c.clientHeight,
      };
      r = D.intersect(r, inner);
      if (!r) return null;
    }
    return r;
  }

  // The sticky or fixed element (a pinned header, say) that covers the text of
  // `el` at a point, or null. Only solid ones count: when unsure the mark stays,
  // so a blackout never disappears while its text can still be read.
  function coverAt(x, y, el) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || el.contains(hit)) return null;
    for (let n = el; n; n = n.parentNode || n.host) if (n === hit) return null;
    let solid = false;
    for (let n = hit; n && n.nodeType === Node.ELEMENT_NODE; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (!solid) solid = /^rgb\(|, 1\)$/.test(cs.backgroundColor);
      if (cs.position === 'fixed' || cs.position === 'sticky') return solid ? n : null;
    }
    return null;
  }

  // The cover's rect, if it really lies over the point (a dialog's backdrop
  // does not) and is as wide as the box; a narrow one would leave the ends readable.
  function coverRect(x, y, el, box) {
    const cover = coverAt(x, y, el);
    if (!cover) return null;
    const r = cover.getBoundingClientRect();
    return r.top <= y && r.bottom >= y && r.left <= box.left && r.right >= box.right ? r : null;
  }

  // Cuts off the part of a box that has slid under a pinned header or footer.
  function uncovered(box, el) {
    const x = (box.left + box.right) / 2;
    let b = box;
    const above = coverRect(x, b.top + 1, el, b);
    if (above) b = { ...b, top: Math.max(b.top, above.bottom) };
    if (b.bottom - b.top <= 0.5) return null;
    const below = coverRect(x, b.bottom - 1, el, b);
    if (below) b = { ...b, bottom: Math.min(b.bottom, below.top) };
    return b.bottom - b.top > 0.5 ? b : null;
  }

  // One box per line of marked text, in viewport pixels. Reads each text node
  // on its own: a range over whole elements would return their full boxes.
  function boxesOf(range) {
    const rects = [];
    const add = (node, start, end) => {
      if (!node.parentElement || end <= start) return;
      const r = new Range();
      r.setStart(node, start);
      r.setEnd(node, end);
      for (const rect of r.getClientRects()) {
        let c = clip(rect, node.parentElement);
        if (c) c = uncovered(c, node.parentElement);
        if (c) rects.push(c);
      }
    };
    const root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) {
      add(root, range.startOffset, range.endOffset);
    } else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!range.intersectsNode(n)) continue;
        add(
          n,
          n === range.startContainer ? range.startOffset : 0,
          n === range.endContainer ? range.endOffset : n.data.length
        );
      }
    }
    return D.mergeByLine(rects);
  }

  function el(name, attrs) {
    const node = document.createElementNS(SVG, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function stroke(d, height, color) {
    return el('path', {
      d,
      fill: 'none',
      stroke: color,
      'stroke-width': D.strokeWidth(height),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
  }

  function render() {
    // A range collapses when the site replaces the text it pointed at.
    for (let i = marks.length - 1; i >= 0; i--) {
      if (marks[i].range.collapsed || !marks[i].range.startContainer.isConnected) marks.splice(i, 1);
    }
    for (const m of marks) m.boxes = boxesOf(m.range);

    const state = JSON.stringify(marks.map((m) => [m.type, m.color, m.seed, m.boxes.map((b) => [b.left, b.top, b.right, b.bottom])]));
    if (state === drawn) return;
    drawn = state;

    const nodes = [];
    const cover = (b, attrs) =>
      el('rect', {
        x: b.left - PAD,
        y: b.top - PAD,
        width: b.right - b.left + PAD * 2,
        height: b.bottom - b.top + PAD * 2,
        ...attrs,
      });
    // Highlighter at the bottom, then solid black, then pen strokes on top.
    for (const m of marks) {
      if (m.type !== 'highlight') continue;
      for (const b of m.boxes) nodes.push(cover(b, { rx: 3, fill: m.color, 'fill-opacity': 0.4, 'data-kind': 'highlight' }));
    }
    for (const m of marks) {
      if (m.type !== 'blackout') continue;
      for (const b of m.boxes) nodes.push(cover(b, { rx: 1.5, fill: '#000', 'data-kind': 'blackout' }));
    }
    for (const m of marks) {
      if (m.type === 'underline') {
        m.boxes.forEach((b, i) => nodes.push(stroke(D.underlinePath(b, m.seed + i), b.bottom - b.top, m.color)));
      } else if (m.type === 'circle' && m.boxes.length) {
        const lineHeight = Math.max(...m.boxes.map((b) => b.bottom - b.top));
        nodes.push(stroke(D.circlePath(D.union(m.boxes), m.seed), lineHeight, m.color));
      }
    }
    svg.replaceChildren(...nodes);
  }

  function loop() {
    if (!marks.length) {
      looping = false;
      refresh();
      return;
    }
    ensureOverlay();
    // A modal opened after the overlay would sit above it; go back on top.
    if (++frame % 10 === 0) {
      const modal = document.querySelector(':modal') || document.fullscreenElement;
      if (modal !== lastModal) {
        lastModal = modal;
        raise();
      }
    }
    render();
    requestAnimationFrame(loop);
  }

  function refresh() {
    if (!marks.length) {
      // Nothing left: take the overlay out of the page again.
      if (host) host.remove();
      host = svg = null;
      drawn = '';
      return;
    }
    ensureOverlay();
    render();
    if (marks.length && !looping) {
      looping = true;
      requestAnimationFrame(loop);
    }
  }

  // Topmost mark under a point, or -1.
  function markAt(x, y) {
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i];
      const boxes = m.type === 'circle' && m.boxes.length ? [D.union(m.boxes)] : m.boxes;
      const reach = m.type === 'blackout' || m.type === 'highlight' ? PAD : 6;
      if (boxes.some((b) => x >= b.left - reach && x <= b.right + reach && y >= b.top - reach && y <= b.bottom + reach)) return i;
    }
    return -1;
  }

  // Alt+click removes a mark.
  function onPointer(e) {
    if (!e.altKey || e.button !== 0 || !marks.length) return;
    const i = markAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== 'click') return;
    marks.splice(i, 1);
    refresh();
  }
  for (const type of ['mousedown', 'mouseup', 'click']) addEventListener(type, onPointer, true);

  // Removes every mark that touches the range. Returns how many went.
  function erase(range) {
    const before = marks.length;
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i].range;
      try {
        // Selection starts before the mark ends, and ends after the mark starts.
        if (range.compareBoundaryPoints(Range.END_TO_START, m) < 0 && range.compareBoundaryPoints(Range.START_TO_END, m) > 0) marks.splice(i, 1);
      } catch {} // ranges in different documents or shadow roots never overlap
    }
    return before - marks.length;
  }

  // Marks the current selection with the armed tool, or clears it of marks.
  function apply() {
    if (!tool) return { ok: false, reason: 'off' };
    const range = selectionRange();
    if (!range) return { ok: false, reason: 'no-selection' };
    if (tool === 'erase') {
      const removed = erase(range);
      getSelection().removeAllRanges();
      refresh();
      return { ok: true, removed, count: marks.length };
    }
    marks.push({ type: tool, color: colors[tool], range, seed: (Math.random() * 0x7fffffff) | 0, at: Date.now(), boxes: [] });
    getSelection().removeAllRanges();
    refresh();
    return { ok: true, count: marks.length };
  }

  // While a tool is armed, finishing a selection with the mouse marks it.
  // The short wait lets the browser settle the selection first.
  addEventListener('mouseup', (e) => {
    if (tool && e.button === 0 && !e.altKey) setTimeout(apply, 0);
  }, true);

  function run(cmd, arg) {
    if (cmd === 'tool') {
      tool = TYPES.includes(arg.tool) || arg.tool === 'erase' ? arg.tool : null;
      for (const k of ['underline', 'circle', 'highlight']) if (arg[k]) colors[k] = arg[k];
      if (tool) apply(); // text already selected when the tool is picked
      return { ok: true, tool };
    }
    if (cmd === 'probe') return { tool, count: marks.length, last: marks.length ? marks[marks.length - 1].at : 0 };
    if (cmd === 'apply') return apply();
    if (cmd === 'undo') {
      if (!marks.length) return { ok: false, reason: 'nothing-to-undo' };
      marks.pop();
    } else if (cmd === 'clear') {
      marks.length = 0;
    } else {
      return { ok: false, reason: 'unknown-command' };
    }
    refresh();
    return { ok: true, count: marks.length };
  }

  globalThis.__redpen = { run, marks, overlay: () => svg };
})();
