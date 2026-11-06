import { isExtension } from './history.js';

export async function snapshotSettings() {
  if (!isExtension()) return { supported: false, enabled: false };
  const [{ snapshotEnabled }, granted] = await Promise.all([
    chrome.storage.local.get('snapshotEnabled'),
    chrome.permissions.contains({ origins: ['<all_urls>'] }),
  ]);
  return { supported: true, enabled: Boolean(snapshotEnabled && granted) };
}

export async function enableSnapshots() {
  if (!isExtension()) return false;
  // Request only from the user's click, never at extension startup.
  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
  if (!granted) return false;
  await chrome.storage.local.set({ snapshotEnabled: true });
  chrome.runtime.sendMessage({ type: 'snapshot-enabled' }).catch(() => {});
  return true;
}

export async function disableSnapshots() {
  if (isExtension()) await chrome.storage.local.set({ snapshotEnabled: false });
}

export const loadSnapshot = url => globalThis.PageSnapshots?.get(url) ?? Promise.resolve(null);
export const clearSnapshots = () => globalThis.PageSnapshots?.clear() ?? Promise.resolve();
