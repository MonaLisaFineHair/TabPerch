importScripts('snapshots.js');

// A new revision invalidates session caches, including after history deletion.
function invalidateHistory() {
  chrome.storage.session.set({ historyRevision: crypto.randomUUID() });
}
chrome.history.onVisited.addListener(invalidateHistory);
chrome.history.onVisitRemoved.addListener(invalidateHistory);
const captureTimers = new Map();
let lastCaptureAt = 0;
let activityRevision = 0;
const CAPTURE_INTERVAL = 5000;

async function canCapture() {
  const { snapshotEnabled } = await chrome.storage.local.get('snapshotEnabled');
  return Boolean(snapshotEnabled) && await chrome.permissions.contains({ origins: ['<all_urls>'] });
}

async function compressScreenshot(dataUrl) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  try {
    const ratio = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * ratio)), Math.max(1, Math.round(bitmap.height * ratio)));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: .55 });
  } finally { bitmap.close(); }
}

async function capturePage(tabId, windowId) {
  try {
    if (!await canCapture()) return;
    if (Date.now() - lastCaptureAt < CAPTURE_INTERVAL) return;
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || tab.status !== 'complete' || tab.incognito || !/^https?:\/\//.test(tab.url || '')) return;
    const browserWindow = await chrome.windows.get(windowId);
    if (!browserWindow.focused || browserWindow.state === 'minimized') return;
    const revision = activityRevision;
    lastCaptureAt = Date.now();
    const screenshot = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 65 });
    const current = await chrome.tabs.get(tabId);
    if (revision !== activityRevision || !current.active || current.url !== tab.url) return;
    const blob = await compressScreenshot(screenshot);
    await PageSnapshots.put({ url: tab.url, title: tab.title || '', blob, capturedAt: Date.now() });
  } catch { /* Missing permission, a closed tab or storage failure must not interrupt browsing. */ }
}

function scheduleCapture(tabId, windowId, delay = 1400) {
  clearTimeout(captureTimers.get(windowId));
  const wait = Math.max(delay, CAPTURE_INTERVAL - (Date.now() - lastCaptureAt));
  captureTimers.set(windowId, setTimeout(() => {
    captureTimers.delete(windowId);
    capturePage(tabId, windowId);
  }, wait));
}

chrome.tabs.onActivated.addListener(info => {
  activityRevision++;
  scheduleCapture(info.tabId, info.windowId, 400);
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === 'loading') activityRevision++;
  if (tab.active && (change.status === 'complete' || change.title)) scheduleCapture(tabId, tab.windowId);
});
chrome.action.onClicked.addListener(async tab => {
  if (tab.id != null) await capturePage(tab.id, tab.windowId);
  await chrome.tabs.create({ url: 'index.html' });
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'snapshot-enabled') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(tabs => {
      if (tabs[0]) scheduleCapture(tabs[0].id, tabs[0].windowId);
    }).catch(() => {});
  }
});
chrome.runtime.onStartup.addListener(() => PageSnapshots.prune().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => PageSnapshots.prune().catch(() => {}));
