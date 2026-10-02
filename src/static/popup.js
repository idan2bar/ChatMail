const KEY = 'chatmail:enabled';
const toggle = document.getElementById('toggle');
const box = document.getElementById('reload-box');

const PENDING = 'chatmail:refreshPending';

chrome.storage.local.get([KEY, PENDING]).then((r) => {
  toggle.checked = r[KEY] !== false;
  box.style.display = r[PENDING] ? 'block' : 'none';
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ [KEY]: toggle.checked, [PENDING]: true });
  box.style.display = 'block';
});

document.getElementById('reload').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  tabs.forEach((t) => chrome.tabs.reload(t.id));
  chrome.storage.local.set({ [PENDING]: false });
  box.style.display = 'none';
});
