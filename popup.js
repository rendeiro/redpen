const REASONS = {
  'no-selection': 'Select some text on the page first.',
  'nothing-to-undo': 'No marks on this page.',
  blocked: 'Chrome does not allow extensions on this page.',
};
const note = document.getElementById('note');

// Show the shortcuts as they are set now, since they can be changed in Chrome.
chrome.commands.getAll((commands) => {
  for (const c of commands) {
    const kbd = document.querySelector(`[data-cmd="${c.name}"] kbd`);
    if (kbd) kbd.textContent = c.shortcut || '';
  }
});

for (const button of document.querySelectorAll('button')) {
  button.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.runtime.sendMessage({ tabId: tab.id, cmd: button.dataset.cmd });
    if (result?.ok) window.close();
    else note.textContent = REASONS[result?.reason] || 'That did not work here.';
  });
}
