import { isExtension, pageKey, webUrl } from './history.js';

export const PARK_DRAG_TYPE = 'application/x-parked-card';
const STORAGE_PREFIX = 'parkedPage:';

export function normalizeParkedPage(value) {
  if (!value || !webUrl(value.url)) return null;
  const finite = (number, fallback) => typeof number === 'number' && Number.isFinite(number) ? number : fallback;
  return {
    id: pageKey(value.url),
    url: value.url,
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 512) : webUrl(value.url).host,
    ...(typeof value.logo === 'string' && /^[a-z]+$/.test(value.logo) ? { logo: value.logo } : {}),
    side: value.side === 'right' ? 'right' : 'left',
    x: Math.max(0, Math.min(1, finite(value.x, .5))),
    y: Math.max(18, Math.min(100000, finite(value.y, 24))),
    ...(typeof value.yRatio === 'number' && Number.isFinite(value.yRatio) ? { yRatio: Math.max(0, Math.min(1, value.yRatio)) } : {}),
    manual: value.manual === true,
    savedAt: Math.max(0, finite(value.savedAt, 0)),
  };
}

export function noteTilt(id) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return (Math.abs(hash) % 9) - 4;
}

function recordsFromStorage(storage) {
  return Object.entries(storage)
    .filter(([key]) => key.startsWith(STORAGE_PREFIX))
    .map(([, value]) => normalizeParkedPage(value))
    .filter(Boolean)
    .sort((a, b) => a.savedAt - b.savedAt || a.id.localeCompare(b.id));
}

export async function readParkedPages() {
  if (isExtension()) return recordsFromStorage(await chrome.storage.local.get(null));
  const storage = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    try { storage[key] = JSON.parse(localStorage.getItem(key)); } catch { /* Skip damaged records. */ }
  }
  return recordsFromStorage(storage);
}

export async function saveParkedPage(value) {
  const page = normalizeParkedPage(value);
  if (!page) throw new Error('Invalid parked page URL');
  const key = `${STORAGE_PREFIX}${page.id}`;
  // One key per page prevents another new-tab page's preferences from losing pins.
  if (isExtension()) await chrome.storage.local.set({ [key]: page });
  else localStorage.setItem(key, JSON.stringify(page));
  return page;
}

export async function deleteParkedPage(id) {
  const key = `${STORAGE_PREFIX}${id}`;
  if (isExtension()) await chrome.storage.local.remove(key);
  else localStorage.removeItem(key);
}

export function subscribeParkedPages(onChange) {
  if (isExtension()) {
    const listener = (changes, area) => {
      if (area === 'local' && Object.keys(changes).some(key => key.startsWith(STORAGE_PREFIX))) onChange();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  const listener = event => { if (!event.key || event.key.startsWith(STORAGE_PREFIX)) onChange(); };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
