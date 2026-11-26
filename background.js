// Turns a shortcut, a right-click menu choice or a popup button into a command
// for the page. The page script is injected only then, never ahead of time.

const MENU = [
  ['underline', 'Underline in red', ['selection']],
  ['circle', 'Circle in red', ['selection']],
  ['blackout', 'Black out', ['selection']],
  ['undo', 'Undo last mark', ['selection', 'page']],
  ['clear', 'Clear all marks', ['selection', 'page']],
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title, contexts] of MENU) chrome.contextMenus.create({ id, title, contexts });
  });
});

// Runs one command in the given frames and returns [{ frameId, result }].
async function call(tabId, frameIds, cmd) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames: true };
  const out = await chrome.scripting.executeScript({
    target,
    func: (c) => globalThis.__redpen.run(c),
    args: [cmd],
  });
  return out.filter((o) => o.result);
}

async function dispatch(tabId, cmd, frameId) {
  const frames = frameId != null ? [frameId] : null;
  const target = frames ? { tabId, frameIds: frames } : { tabId, allFrames: true };
  try {
    await chrome.scripting.executeScript({ target, files: ['draw.js', 'content.js'] });
  } catch {
    return { ok: false, reason: 'blocked' };
  }

  if (cmd === 'clear') {
    await call(tabId, null, cmd);
    return { ok: true };
  }
  if (frames) return (await call(tabId, frames, cmd))[0]?.result ?? { ok: false, reason: 'blocked' };

  // No frame given (shortcut or popup): find the frame the command is meant for.
  const probes = await call(tabId, null, 'probe');
  let pick;
  if (cmd === 'undo') {
    pick = probes.filter((p) => p.result.last).sort((a, b) => b.result.last - a.result.last)[0];
    if (!pick) return { ok: false, reason: 'nothing-to-undo' };
  } else {
    const selected = probes.filter((p) => p.result.selection);
    pick = selected.find((p) => p.result.focused) || selected[0];
    if (!pick) return { ok: false, reason: 'no-selection' };
  }
  return (await call(tabId, [pick.frameId], cmd))[0]?.result ?? { ok: false, reason: 'blocked' };
}

// A short "!" on the icon when a shortcut or menu choice could not do anything.
async function flag(tabId, result) {
  if (result.ok) return;
  await chrome.action.setBadgeBackgroundColor({ color: '#e5261f' });
  await chrome.action.setBadgeText({ tabId, text: '!' });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 1500);
}

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (tab?.id != null) flag(tab.id, await dispatch(tab.id, cmd));
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (tab?.id == null) return;
  const inFrame = info.selectionText ? info.frameId : undefined;
  flag(tab.id, await dispatch(tab.id, info.menuItemId, inFrame));
});

// The popup asks here, so all three ways in share the same code.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  dispatch(msg.tabId, msg.cmd).then(reply);
  return true;
});
