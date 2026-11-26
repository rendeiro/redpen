// Runs in the page (one copy per frame). Keeps the list of marks and draws
// them on an overlay that follows the text. The page's own DOM is not changed.
(() => {
  if (globalThis.__redpen) return;
  const D = globalThis.RedpenDraw;
  const SVG = 'http://www.w3.org/2000/svg';
  const TYPES = ['underline', 'circle', 'blackout'];
  const PAD = 2; // extra black around blacked-out text

  const marks = []; // { type, range, seed, at, boxes }
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
        const c = clip(rect, node.parentElement);
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

  function stroke(d, height) {
    return el('path', {
      d,
      fill: 'none',
      stroke: D.RED,
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

    const state = JSON.stringify(marks.map((m) => [m.type, m.seed, m.boxes.map((b) => [b.left, b.top, b.right, b.bottom])]));
    if (state === drawn) return;
    drawn = state;

    const nodes = [];
    // Black first, so red marks stay visible on top of it.
    for (const m of marks) {
      if (m.type !== 'blackout') continue;
      for (const b of m.boxes) {
        nodes.push(
          el('rect', {
            x: b.left - PAD,
            y: b.top - PAD,
            width: b.right - b.left + PAD * 2,
            height: b.bottom - b.top + PAD * 2,
            rx: 1.5,
            fill: '#000',
          })
        );
      }
    }
    for (const m of marks) {
      if (m.type === 'underline') {
        m.boxes.forEach((b, i) => nodes.push(stroke(D.underlinePath(b, m.seed + i), b.bottom - b.top)));
      } else if (m.type === 'circle' && m.boxes.length) {
        const lineHeight = Math.max(...m.boxes.map((b) => b.bottom - b.top));
        nodes.push(stroke(D.circlePath(D.union(m.boxes), m.seed), lineHeight));
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
      const reach = m.type === 'blackout' ? PAD : 6;
      if (boxes.some((b) => x >= b.left - reach && x <= b.right + reach && y >= b.top - reach && y <= b.bottom + reach)) return i;
    }
    return -1;
  }

  // Alt+click removes a mark. Alt+Shift+click changes its type.
  function onPointer(e) {
    if (!e.altKey || e.button !== 0 || !marks.length) return;
    const i = markAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== 'click') return;
    if (e.shiftKey) marks[i].type = TYPES[(TYPES.indexOf(marks[i].type) + 1) % TYPES.length];
    else marks.splice(i, 1);
    refresh();
  }
  for (const type of ['mousedown', 'mouseup', 'click']) addEventListener(type, onPointer, true);

  function run(cmd) {
    if (TYPES.includes(cmd)) {
      const range = selectionRange();
      if (!range) return { ok: false, reason: 'no-selection' };
      marks.push({ type: cmd, range, seed: (Math.random() * 0x7fffffff) | 0, at: Date.now(), boxes: [] });
      getSelection().removeAllRanges();
    } else if (cmd === 'undo') {
      if (!marks.length) return { ok: false, reason: 'nothing-to-undo' };
      marks.pop();
    } else if (cmd === 'clear') {
      marks.length = 0;
    } else if (cmd === 'probe') {
      const active = document.activeElement;
      return {
        selection: !!selectionRange(),
        focused: document.hasFocus() && !(active && /^I?FRAME$/.test(active.tagName)),
        last: marks.length ? marks[marks.length - 1].at : 0,
      };
    } else {
      return { ok: false, reason: 'unknown-command' };
    }
    refresh();
    return { ok: true, count: marks.length };
  }

  globalThis.__redpen = { run, marks, overlay: () => svg };
})();
