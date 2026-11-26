// The popup is the only control: it arms a tool on the current tab, after
// which every text selection there is marked. Colours are remembered.

const PENS = ['#e5261f', '#1d6ff2', '#12a150', '#f08c00', '#8b3fd9', '#111111'];
const HIGHLIGHTERS = ['#ffe600', '#7dff6b', '#ff8ad8', '#6bd6ff', '#ffb347'];
const LETTER = { underline: 'U', circle: 'C', highlight: 'H', blackout: 'B', erase: 'X' };
const PALETTE = { underline: PENS, circle: PENS, highlight: HIGHLIGHTERS };

const note = document.getElementById('note');
let tabId;
let state = { tool: null, underline: PENS[0], circle: PENS[0], highlight: HIGHLIGHTERS[0] };

// Runs a command in the page: in every frame, or in the given ones.
async function call(cmd, arg, frameIds) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames: true };
  const out = await chrome.scripting.executeScript({
    target,
    func: (c, a) => globalThis.__redpen.run(c, a),
    args: [cmd, arg ?? null],
  });
  return out.filter((o) => o.result);
}

function draw() {
  for (const b of document.querySelectorAll('.tool')) b.setAttribute('aria-pressed', (b.dataset.tool || null) === state.tool);
  for (const [key, colors] of Object.entries(PALETTE)) {
    const box = document.getElementById(key);
    box.replaceChildren(
      ...colors.map((c) => {
        const b = document.createElement('button');
        b.className = 'swatch';
        b.style.background = c;
        b.title = c;
        b.setAttribute('aria-pressed', state[key] === c);
        b.onclick = () => setColor(key, c);
        return b;
      })
    );
  }
  document.querySelector('.c-underline').setAttribute('stroke', state.underline);
  document.querySelector('.c-circle').setAttribute('stroke', state.circle);
  document.querySelector('.c-highlight').setAttribute('fill', state.highlight);
}

async function badge() {
  const color = state[state.tool] || (state.tool === 'erase' ? '#777777' : '#000000');
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text: LETTER[state.tool] || '' });
}

async function push() {
  await call('tool', state);
  await badge();
}

async function setColor(key, color) {
  state[key] = color;
  await chrome.storage.local.set({ [key]: color });
  draw();
  if (state.tool) await push();
}

for (const b of document.querySelectorAll('.tool')) {
  b.onclick = async () => {
    state.tool = b.dataset.tool || null;
    await push();
    window.close();
  };
}

document.getElementById('undo').onclick = async () => {
  // Each frame keeps its own marks; undo the newest one across them.
  const newest = (await call('probe')).filter((p) => p.result.last).sort((a, b) => b.result.last - a.result.last)[0];
  if (!newest) return void (note.textContent = 'No marks on this page.');
  note.textContent = '';
  await call('undo', null, [newest.frameId]);
};

document.getElementById('clear').onclick = async () => {
  await call('clear');
  note.textContent = '';
};

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;
  Object.assign(state, await chrome.storage.local.get(Object.keys(PALETTE)));
  draw();
  try {
    const files = ['draw.js', 'content.js'];
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files }).catch(() =>
      chrome.scripting.executeScript({ target: { tabId }, files })
    );
    const top = (await call('probe', null, [0]))[0];
    state.tool = top?.result.tool ?? null;
    draw();
  } catch {
    document.body.classList.add('blocked');
    note.textContent = 'Chrome does not allow extensions on this page.';
  }
})();
